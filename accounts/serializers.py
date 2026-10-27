from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from .models import User


def user_data(user):
    """The user info sent to the frontend after login or signup."""
    building = user.current_building
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "email": user.email,
        "role": user.role,
        # null means a resident/guard still has to enter a join code
        "building": {"id": building.id, "name": building.name} if building else None,
    }


class LoginSerializer(TokenObtainPairSerializer):

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = user_data(self.user)
        return data

class SignupSerializer(serializers.ModelSerializer):
    # Only residents and guards can sign up; secretaries are created by the developer.
    role = serializers.ChoiceField(choices=[User.Role.RESIDENT, User.Role.GUARD])
    password = serializers.CharField(write_only=True, validators=[validate_password])
    confirm_password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = [
            "id", "username", "password", "confirm_password",
            "first_name", "last_name", "email", "phone1", "phone2", "role",
        ]

    def validate(self, attrs):
        if attrs["password"] != attrs.pop("confirm_password"):
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)

    def to_representation(self, instance):
        # Same shape as the login response, so the new user is logged in straight away
        refresh = RefreshToken.for_user(instance)
        return {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": user_data(instance),
        }


class ProfileSerializer(serializers.ModelSerializer):
    """The logged-in user's own profile. Username and role can't be changed here."""
    building = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "role", "first_name", "middle_name", "last_name", "full_name",
            "email", "phone1", "phone2", "date_joined", "building",
        ]
        read_only_fields = ["id", "username", "role", "full_name", "date_joined", "building"]

    def get_building(self, user):
        building = user.current_building
        return {"id": building.id, "name": building.name} if building else None

    def validate_first_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter your first name.")
        return value


def check_new_password(password, confirm, user):
    """Shared rules for a new password: both boxes match and Django's strength rules pass."""
    if password != confirm:
        raise serializers.ValidationError({"confirm_password": "The two passwords don't match."})
    try:
        validate_password(password, user=user)
    except DjangoValidationError as error:
        raise serializers.ValidationError({"new_password": list(error.messages)})


class ChangePasswordSerializer(serializers.Serializer):
    """A resident or guard changes their own password. They must know the current one."""
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Your current password is not correct.")
        return value

    def validate(self, attrs):
        if attrs["new_password"] == attrs["current_password"]:
            raise serializers.ValidationError({"new_password": "Choose a password different from your current one."})
        check_new_password(attrs["new_password"], attrs["confirm_password"], self.context["request"].user)
        return attrs


class ResetPasswordSerializer(serializers.Serializer):
    """The secretary sets a new password for a resident or guard (no old password needed)."""
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        check_new_password(attrs["new_password"], attrs["confirm_password"], self.context["member"])
        return attrs
