from rest_framework import generics
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView
from .models import User
from .permissions import IsResidentOrGuard, IsSecretary
from .serializers import (
    LoginSerializer, SignupSerializer, ProfileSerializer, ChangePasswordSerializer, ResetPasswordSerializer,
)
from .utils import sign_out_everywhere


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer

class SignupView(generics.CreateAPIView):
    serializer_class = SignupSerializer
    permission_classes = [AllowAny]

class MeView(generics.RetrieveUpdateAPIView):
    """GET or PATCH the logged-in user's own profile."""
    serializer_class = ProfileSerializer
    http_method_names = ["get", "patch", "options", "head"]

    def get_object(self):
        return self.request.user


class ChangePasswordView(APIView):
    """POST {current_password, new_password, confirm_password}: a resident or guard changes
    their own password. Their other devices are signed out; this one gets fresh tokens.
    Secretaries can't use this - their passwords are managed by the developer."""
    permission_classes = [IsResidentOrGuard]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])

        sign_out_everywhere(user)
        refresh = RefreshToken.for_user(user)   # keep this device signed in
        return Response({
            "detail": "Your password was changed.",
            "access": str(refresh.access_token),
            "refresh": str(refresh),
        })


class ResetMemberPasswordView(APIView):
    """POST {new_password, confirm_password}: the secretary sets a new password for a resident
    or guard of their own building, and that person is signed out everywhere."""
    permission_classes = [IsSecretary]

    def post(self, request, pk):
        member = User.objects.filter(
            pk=pk,
            role__in=[User.Role.RESIDENT, User.Role.GUARD],
            building__secretary=request.user,
        ).first()
        if member is None:
            return Response({"detail": "Resident or guard not found in your building."}, status=404)

        serializer = ResetPasswordSerializer(data=request.data, context={"member": member})
        serializer.is_valid(raise_exception=True)
        member.set_password(serializer.validated_data["new_password"])
        member.save(update_fields=["password"])

        sign_out_everywhere(member)
        name = member.full_name or member.username
        return Response({"detail": f"{name}'s password was reset. Give them the new password; they can change it afterwards."})
