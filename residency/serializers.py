import os
from rest_framework import serializers
from .models import Notice, Building, BuildingImage, Unit, UnitImage, Floor, Complaint, Bill, BillItem, EntryLog
from .models import REMIND_DAYS_BEFORE, Payment, PaymentMethod, PaymentDetailsChange, PAYMENT_KINDS
import re
from datetime import datetime
from decimal import Decimal
from django.utils import timezone
from django.db import transaction
from django.contrib.auth.password_validation import validate_password
from accounts.models import User

class NoticeSerializer(serializers.ModelSerializer):
    posted_by=serializers.SerializerMethodField()
    attachment_type=serializers.CharField(read_only=True)   # "image", "pdf" or null
    attachment_name=serializers.SerializerMethodField()
    # Send remove_attachment=true when editing to take the file off the notice
    remove_attachment=serializers.BooleanField(write_only=True,required=False,default=False)

    class Meta:
        model=Notice
        fields=[
            "id","title","message","attachment","attachment_type","attachment_name",
            "remove_attachment","posted_by","created_at","updated_at",
        ]
        read_only_fields=["id","created_at","updated_at"]
        extra_kwargs={
            "title": {"allow_blank": False, "required": True},
            "attachment": {"required": False},
        }

    def get_posted_by(self, notice):
        user=notice.posted_by
        return (user.full_name or user.username) if user else None

    def get_attachment_name(self, notice):
        return os.path.basename(notice.attachment.name) if notice.attachment else None

    def validate_title(self, value):
        value=value.strip()
        if not value:
            raise serializers.ValidationError("Enter a title.")
        return value

    def validate_message(self, value):
        value=value.strip()
        if not value:
            raise serializers.ValidationError("Write the notice.")
        return value

    def create(self, validated_data):
        validated_data.pop("remove_attachment", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        remove=validated_data.pop("remove_attachment", False)
        new_file=validated_data.get("attachment")
        # Delete the old file when it is replaced or removed
        if instance.attachment and (remove or new_file):
            instance.attachment.delete(save=False)
        if remove and not new_file:
            validated_data["attachment"]=None
        return super().update(instance, validated_data)

class BuildingImageSerializer(serializers.ModelSerializer):
    class Meta:
        model=BuildingImage
        fields=["id","photo"]

class BuildingSerializer(serializers.ModelSerializer):
    """The secretary's building: create it, edit it, and show it on the dashboard."""
    images=BuildingImageSerializer(many=True,read_only=True)
    # Upload only; saved photos come back in `images`
    photos=serializers.ListField(
        child=serializers.ImageField(), write_only=True, required=False
    )
    stats=serializers.SerializerMethodField()

    class Meta:
        model=Building
        fields=[
            "id","name","description","total_floors","join_code","code_active",
            "created_at","images","photos","stats",
        ]
        read_only_fields=["id","join_code","created_at"]
        extra_kwargs={"description": {"allow_blank": True}}

    def validate(self, attrs):
        if self.instance is None:
            # Each secretary runs one building (see User.current_building)
            if self.context["request"].user.buildings.exists():
                raise serializers.ValidationError("You already have a building. Edit it instead.")
            # Multipart forms turn a missing checkbox into False; new codes always start on
            attrs.pop("code_active", None)
        elif "total_floors" in attrs and attrs["total_floors"] != self.instance.total_floors:
            # Floors are only generated when the building is created
            raise serializers.ValidationError({"total_floors": "The number of floors can't be changed after setup."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        photos = validated_data.pop("photos", [])

        building = Building.objects.create(
            secretary=self.context["request"].user, **validated_data
        )   # floors are auto-created here

        BuildingImage.objects.bulk_create(
            [BuildingImage(building=building, photo=photo) for photo in photos]
        )
        return building

    def update(self, instance, validated_data):
        photos = validated_data.pop("photos", [])
        instance = super().update(instance, validated_data)
        # New photos are added to the existing ones
        BuildingImage.objects.bulk_create(
            [BuildingImage(building=instance, photo=photo) for photo in photos]
        )
        return instance

    def get_stats(self, building):
        members=building.members
        return {
            "floors": building.floors.count(),
            "units": Unit.objects.filter(floor__building=building).count(),
            "residents": members.filter(role="resident").count(),
            "guards": members.filter(role="guard").count(),
            "open_complaints": building.complaints.exclude(status="resolved").count(),
            "notices": building.notices.count(),
            "unpaid_bills": Bill.objects.filter(unit__floor__building=building, status=Bill.Status.UNPAID, sent_at__isnull=False).count(),
            "overdue_bills": Bill.objects.filter(unit__floor__building=building, status=Bill.Status.UNPAID, sent_at__isnull=False,
                                                 due_date__lt=timezone.localdate()).count(),
            "draft_bills": Bill.objects.filter(unit__floor__building=building, sent_at__isnull=True).count(),
        }


class JoinBuildingSerializer(serializers.Serializer):
    code = serializers.CharField()

    def validate_code(self, value):
        # Codes are stored uppercase; forgive lowercase and stray spaces
        code = value.replace(" ", "").strip().upper()
        building = Building.objects.filter(join_code=code).first()
        if building is None:
            raise serializers.ValidationError("No building found with this code.")
        if not building.code_active:
            raise serializers.ValidationError("This code has been turned off. Ask your secretary for a new one.")
        self.building = building
        return code

    def validate(self, attrs):
        if self.context["request"].user.building_id:
            raise serializers.ValidationError("You have already joined a building.")
        return attrs



class MemberSerializer(serializers.ModelSerializer):
    """A resident or guard as listed for the secretary.
    `unpaid` (residents) is what they still owe on bills sent to them; the view passes it
    in context["unpaid"] as {user_id: {"count": n, "total": "..."}}."""
    unit=serializers.SerializerMethodField()
    unpaid=serializers.SerializerMethodField()

    class Meta:
        model=User
        fields=["id","username","full_name","email","phone1","phone2","role","date_joined","unit","unpaid"]

    def get_unpaid(self, user):
        if user.role != "resident":
            return None
        return self.context.get("unpaid", {}).get(user.id, {"count": 0, "total": "0"})

    def get_unit(self, user):
        # Only residents have a profile, and only once the secretary assigns a unit
        profile=getattr(user,"resident_profile",None)
        if profile is None or profile.unit is None:
            return None
        unit=profile.unit
        return {"id": unit.id, "name": unit.name, "floor": unit.floor.number}

class GuardCreateSerializer(serializers.ModelSerializer):
    """The secretary creates a guard's login; the guard is put in the secretary's building."""
    password=serializers.CharField(write_only=True,validators=[validate_password])

    class Meta:
        model=User
        fields=["id","username","password","first_name","last_name","phone1"]
        extra_kwargs={"first_name": {"required": True, "allow_blank": False}}

    def create(self, validated_data):
        return User.objects.create_user(
            role=User.Role.GUARD, building=self.context["building"], **validated_data
        )

    def to_representation(self, instance):
        return MemberSerializer(instance, context=self.context).data

class UnitImageSerializer(serializers.ModelSerializer):
    class Meta:
        model=UnitImage
        fields=["id","photo"]

class UnitSerializer(serializers.ModelSerializer):
    images=UnitImageSerializer(many=True,read_only=True)
    # Upload only; saved photos come back in `images`
    photos=serializers.ListField(
        child=serializers.ImageField(), write_only=True, required=False
    )
    residents=serializers.IntegerField(source="residents.count",read_only=True)

    class Meta:
        model=Unit
        fields=["id","floor","name","area","rent","images","photos","residents"]
        # Duplicate names are checked in validate() with a clearer message
        validators=[]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request=self.context.get("request")
        if request is not None:
            # A secretary can only put units on their own building's floors
            self.fields["floor"].queryset=Floor.objects.filter(building__secretary=request.user)

    def validate_name(self, value):
        value=value.strip()
        if not value:
            raise serializers.ValidationError("Enter the unit's name.")
        return value

    def validate(self, attrs):
        floor=attrs.get("floor", self.instance.floor if self.instance else None)
        name=attrs.get("name", self.instance.name if self.instance else None)
        clash=Unit.objects.filter(floor=floor, name__iexact=name)
        if self.instance:
            clash=clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError({"name": f"Floor {floor.number} already has a unit called {name}."})
        return attrs

    def _add_photos(self, unit, photos):
        UnitImage.objects.bulk_create([UnitImage(unit=unit, photo=photo) for photo in photos])

    @transaction.atomic
    def create(self, validated_data):
        photos=validated_data.pop("photos", [])
        unit=super().create(validated_data)
        self._add_photos(unit, photos)
        return unit

    @transaction.atomic
    def update(self, instance, validated_data):
        photos=validated_data.pop("photos", [])
        unit=super().update(instance, validated_data)
        # New photos are added to the existing ones
        self._add_photos(unit, photos)
        return unit

class FloorSerializer(serializers.ModelSerializer):
    units=UnitSerializer(many=True,read_only=True)

    class Meta:
        model=Floor
        fields=["id","number","units"]

class CopyFloorSerializer(serializers.Serializer):
    to_floors=serializers.ListField(child=serializers.IntegerField(), allow_empty=False)

class SecretaryComplaintSerializer(serializers.ModelSerializer):
    """A complaint as the secretary sees it. The secretary only writes the reply:
    saving a reply resolves the complaint (editing the reply later keeps it resolved).
    For anonymous complaints the sender and their unit are left out entirely."""
    raised_by=serializers.SerializerMethodField()
    unit=serializers.SerializerMethodField()

    class Meta:
        model=Complaint
        fields=[
            "id","title","description","photo","is_anonymous","raised_by","unit",
            "status","response","created_at","resolved_at",
        ]
        read_only_fields=[
            "id","title","description","photo","is_anonymous","status","created_at","resolved_at",
        ]

    def get_raised_by(self, complaint):
        if complaint.is_anonymous:
            return None
        user=complaint.raised_by
        return {"id": user.id, "name": user.full_name or user.username, "phone": user.phone1}

    def get_unit(self, complaint):
        # The unit would give away who sent an anonymous complaint
        if complaint.is_anonymous or complaint.unit is None:
            return None
        return {"id": complaint.unit.id, "name": complaint.unit.name, "floor": complaint.unit.floor.number}

    def validate_response(self, value):
        value=value.strip()
        if not value:
            raise serializers.ValidationError("Write a reply for the resident.")
        return value

    def update(self, instance, validated_data):
        if "response" not in validated_data:
            raise serializers.ValidationError({"response": "Write a reply for the resident."})
        now=timezone.now()
        if instance.status != Complaint.Status.RESOLVED:
            validated_data["status"]=Complaint.Status.RESOLVED
            validated_data["resolved_at"]=now
        if validated_data["response"] != instance.response:
            validated_data["last_update_at"]=now   # the resident sees this as unread
        return super().update(instance, validated_data)


class ResidentUnitSerializer(serializers.ModelSerializer):
    """The unit as its resident sees it (read-only)."""
    floor=serializers.IntegerField(source="floor.number",read_only=True)
    images=UnitImageSerializer(many=True,read_only=True)

    class Meta:
        model=Unit
        fields=["id","name","floor","area","rent","images"]

class ResidentBuildingSerializer(serializers.ModelSerializer):
    """The building as residents see it: no join code, no stats."""
    images=BuildingImageSerializer(many=True,read_only=True)

    class Meta:
        model=Building
        fields=["id","name","description","total_floors","images"]

class AssignUnitSerializer(serializers.Serializer):
    """The secretary puts a resident in a unit (or takes them out with unit=null)."""
    unit=serializers.PrimaryKeyRelatedField(queryset=Unit.objects.none(),allow_null=True)
    moved_in=serializers.DateField(required=False,allow_null=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Only units in the secretary's own building
        self.fields["unit"].queryset=Unit.objects.filter(
            floor__building__secretary=self.context["request"].user
        )


# ---------- Billing ----------

class MonthField(serializers.Field):
    """A billing month written as "YYYY-MM"; stored as the first day of that month."""
    default_error_messages={"invalid": "Use the format YYYY-MM, e.g. 2026-10."}

    def to_internal_value(self, data):
        try:
            return datetime.strptime(str(data), "%Y-%m").date()
        except ValueError:
            self.fail("invalid")

    def to_representation(self, value):
        return value.strftime("%Y-%m")

class BillItemSerializer(serializers.ModelSerializer):
    amount=serializers.DecimalField(max_digits=10,decimal_places=2,min_value=Decimal("0"))

    class Meta:
        model=BillItem
        fields=["title","amount"]

    def validate_title(self, value):
        value=value.strip()
        if not value:
            raise serializers.ValidationError("Enter what this charge is for.")
        return value

MAX_BILL_ITEMS=30

def rent_item(unit):
    """The unit's fixed rent as the first line of a bill, or None if it has no rent."""
    return BillItem(title="Rent", amount=Decimal(unit.rent)) if unit.rent else None

def bill_total(bill):
    # Uses the prefetched items instead of a query per bill
    return sum((item.amount for item in bill.items.all()), Decimal("0"))

def check_due_date(due, period):
    """A due date can't fall before its billing month, or more than 6 months after it starts."""
    if due < period:
        raise serializers.ValidationError({"due_date": f"The due date can't be before {period:%B %Y} starts."})
    month = period.month - 1 + MAX_DUE_MONTHS
    latest = period.replace(year=period.year + month // 12, month=month % 12 + 1)
    if due > latest:
        raise serializers.ValidationError({"due_date": f"The due date can be at most {MAX_DUE_MONTHS} months after the billing month."})

MAX_DUE_MONTHS=6

class BillSerializer(serializers.ModelSerializer):
    """A unit's bill for one month, as the secretary manages it.
    New bills are drafts that residents can't see, unless created with send=true.
    On create the unit's rent is added as the first line unless include_rent is false.
    On edit, sending `items` replaces all lines (rent included, so send it back too)."""
    period=MonthField()
    unit=serializers.PrimaryKeyRelatedField(queryset=Unit.objects.none())
    unit_info=serializers.SerializerMethodField()
    items=BillItemSerializer(many=True,required=False)
    total=serializers.SerializerMethodField()
    include_rent=serializers.BooleanField(write_only=True,required=False,default=True)
    send=serializers.BooleanField(write_only=True,required=False,default=False)
    is_draft=serializers.BooleanField(read_only=True)
    is_overdue=serializers.BooleanField(read_only=True)
    days_overdue=serializers.IntegerField(read_only=True)
    billed_to=serializers.SerializerMethodField()
    residents=serializers.SerializerMethodField()
    amount_paid=serializers.DecimalField(max_digits=12,decimal_places=2,read_only=True)
    amount_pending=serializers.DecimalField(max_digits=12,decimal_places=2,read_only=True)
    balance=serializers.DecimalField(max_digits=12,decimal_places=2,read_only=True)
    remark_code=serializers.CharField(read_only=True)
    payments=serializers.SerializerMethodField()

    class Meta:
        model=Bill
        fields=[
            "id","unit","unit_info","period","due_date","status","paid_at","note",
            "items","total","include_rent","send","is_draft","sent_at","changed_at",
            "is_overdue","days_overdue","billed_to","residents",
            "amount_paid","amount_pending","balance","remark_code","payments","created_at",
        ]
        read_only_fields=["id","paid_at","sent_at","changed_at","created_at"]
        extra_kwargs={"note": {"allow_blank": True, "required": False}}
        # One bill per unit per month is checked in validate() with a clearer message
        validators=[]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request=self.context.get("request")
        if request is not None:
            self.fields["unit"].queryset=Unit.objects.filter(floor__building__secretary=request.user)

    def get_unit_info(self, bill):
        return {"id": bill.unit.id, "name": bill.unit.name, "floor": bill.unit.floor.number}

    def get_total(self, bill):
        return str(bill_total(bill))

    def get_payments(self, bill):
        return PaymentSerializer(bill.payments.all(), many=True, context=self.context).data

    def get_residents(self, bill):
        # Who lives in the unit now (uses the prefetched profiles); drafts aren't billed to anyone yet
        return [p.user.full_name or p.user.username for p in bill.unit.residents.all()]

    def get_billed_to(self, bill):
        # Uses the prefetched residents
        return [{"id": u.id, "name": u.full_name or u.username} for u in bill.billed_residents.all()]

    def validate_items(self, items):
        if len(items) > MAX_BILL_ITEMS:
            raise serializers.ValidationError(f"A bill can have at most {MAX_BILL_ITEMS} lines.")
        return items

    def validate(self, attrs):
        bill=self.instance
        unit=attrs.get("unit", bill.unit if bill else None)
        period=attrs.get("period", bill.period if bill else None)
        due=attrs.get("due_date", bill.due_date if bill else None)
        if "due_date" in attrs or "period" in attrs:
            check_due_date(due, period)

        if bill is not None:
            if "unit" in attrs and attrs["unit"] != bill.unit:
                raise serializers.ValidationError({"unit": "A bill can't be moved to another unit. Delete it and create a new one."})
            stays_paid=attrs.get("status", bill.status) == Bill.Status.PAID
            if bill.status == Bill.Status.PAID and stays_paid and set(attrs) - {"status", "note"}:
                raise serializers.ValidationError("This bill is paid. Mark it unpaid before changing it.")
            if "items" in attrs and not attrs["items"]:
                raise serializers.ValidationError({"items": "A bill needs at least one line."})
        else:
            has_rent=attrs.get("include_rent", True) and unit.rent
            if not attrs.get("items") and not has_rent:
                raise serializers.ValidationError({"items": "Add at least one charge (this unit has no rent set)."})

        clash=Bill.objects.filter(unit=unit, period=period)
        if bill is not None:
            clash=clash.exclude(pk=bill.pk)
        if clash.exists():
            raise serializers.ValidationError(
                {"period": f"Unit {unit.name} already has a bill for {period:%B %Y}."}
            )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        items=validated_data.pop("items", [])
        include_rent=validated_data.pop("include_rent", True)
        send=validated_data.pop("send", False)
        mark_paid=validated_data.pop("status", None) == Bill.Status.PAID
        bill=Bill.objects.create(created_by=self.context["request"].user, **validated_data)
        rent=rent_item(bill.unit) if include_rent else None
        lines=([rent] if rent else []) + [BillItem(**item) for item in items]
        for line in lines:
            line.bill=bill
        BillItem.objects.bulk_create(lines)
        if send:
            bill.send()
        if mark_paid:
            pay_in_full(bill, self.context["request"].user)
        return fresh_bill(bill)

    @transaction.atomic
    def update(self, instance, validated_data):
        items=validated_data.pop("items", None)
        validated_data.pop("include_rent", None)
        send=validated_data.pop("send", False)
        status=validated_data.pop("status", instance.status)
        user=self.context["request"].user

        # Residents already saw this bill: flag what they see as changed
        visible_change=(
            items is not None
            or validated_data.get("due_date", instance.due_date) != instance.due_date
            or validated_data.get("note", instance.note) != instance.note
        )
        if instance.sent_at is not None and visible_change:
            validated_data["changed_at"]=timezone.now()

        bill=super().update(instance, validated_data)
        if items is not None:
            bill.items.all().delete()
            BillItem.objects.bulk_create([BillItem(bill=bill, **item) for item in items])
            if bill.payments.exists():
                bill.refresh_status()   # new charges may now be covered (or not) by what was paid
        if send:
            bill.send()
        # Shortcuts kept for API clients: "paid" records a payment for what's still owed,
        # "unpaid" reverses the bill's confirmed payments
        if status == Bill.Status.PAID and instance.status != Bill.Status.PAID:
            pay_in_full(bill, user)
        elif status == Bill.Status.UNPAID and bill.status == Bill.Status.PAID:
            for payment in bill.payments.filter(status=Payment.Status.CONFIRMED):
                payment.reject(user, "Marked unpaid by the secretary")
        return fresh_bill(bill)

def fresh_bill(bill):
    """The bill reloaded with everything the serializer shows (payments may have changed it)."""
    return (Bill.objects.select_related("unit__floor__building")
            .prefetch_related("items", "billed_residents", "unit__residents__user",
                              "payments__payment_method", "payments__submitted_by", "payments__decided_by")
            .get(pk=bill.pk))

def pay_in_full(bill, user):
    """Record and confirm one payment for whatever is still owed on the bill."""
    bill=Bill.objects.prefetch_related("items","payments").get(pk=bill.pk)
    if bill.balance > 0:
        payment=Payment.objects.create(bill=bill, amount=bill.balance, kind="other",
                                       paid_on=timezone.localdate(), submitted_by=user)
        payment.confirm(user)
    else:
        bill.refresh_status()

class BulkBillSerializer(serializers.Serializer):
    """Bill many units for one month in one go: each unit's rent plus shared charges."""
    period=MonthField()
    due_date=serializers.DateField()
    note=serializers.CharField(required=False,allow_blank=True,default="")
    # Leave out to bill every unit in the building
    units=serializers.ListField(child=serializers.IntegerField(),required=False,allow_empty=False)
    items=BillItemSerializer(many=True,required=False,default=list)
    include_rent=serializers.BooleanField(required=False,default=True)
    # Bills are created as drafts unless send=true
    send=serializers.BooleanField(required=False,default=False)

    def validate_items(self, items):
        if len(items) > MAX_BILL_ITEMS:
            raise serializers.ValidationError(f"A bill can have at most {MAX_BILL_ITEMS} lines.")
        return items

    def validate(self, attrs):
        if not attrs["items"] and not attrs["include_rent"]:
            raise serializers.ValidationError("Add at least one charge, or include rent.")
        check_due_date(attrs["due_date"], attrs["period"])
        return attrs

class SendBillsSerializer(serializers.Serializer):
    """Which drafts to send: specific bills, or every draft of a month."""
    ids=serializers.ListField(child=serializers.IntegerField(),required=False,allow_empty=False)
    period=MonthField(required=False)

    def validate(self, attrs):
        if not attrs.get("ids") and not attrs.get("period"):
            raise serializers.ValidationError("Say which bills to send: ids or period.")
        return attrs

class ResidentBillSerializer(serializers.ModelSerializer):
    """A bill as the resident it was sent to sees it (read-only)."""
    period=MonthField()
    items=BillItemSerializer(many=True,read_only=True)
    total=serializers.SerializerMethodField()
    unit=serializers.SerializerMethodField()
    is_overdue=serializers.BooleanField(read_only=True)
    days_overdue=serializers.IntegerField(read_only=True)
    days_until_due=serializers.IntegerField(read_only=True)
    due_soon=serializers.SerializerMethodField()
    amount_paid=serializers.DecimalField(max_digits=12,decimal_places=2,read_only=True)
    amount_pending=serializers.DecimalField(max_digits=12,decimal_places=2,read_only=True)
    balance=serializers.DecimalField(max_digits=12,decimal_places=2,read_only=True)
    remark_code=serializers.CharField(read_only=True)
    payments=serializers.SerializerMethodField()

    class Meta:
        model=Bill
        fields=[
            "id","period","unit","due_date","status","paid_at","note","items","total",
            "sent_at","changed_at","is_overdue","days_overdue","days_until_due","due_soon",
            "amount_paid","amount_pending","balance","remark_code","payments",
        ]

    def get_payments(self, bill):
        return PaymentSerializer(bill.payments.all(), many=True, context=self.context).data

    def get_due_soon(self, bill):
        days=bill.days_until_due
        return days is not None and days <= REMIND_DAYS_BEFORE

    def get_unit(self, bill):
        return {"id": bill.unit.id, "name": bill.unit.name, "floor": bill.unit.floor.number}

    def get_total(self, bill):
        return str(bill_total(bill))


# ---------- Complaints, resident side ----------

MAX_COMPLAINT_PHOTO=10*1024*1024   # 10 MB

class ResidentComplaintSerializer(serializers.ModelSerializer):
    """A resident's own complaint, with the secretary's status and reply.
    It is filed against the resident's current unit (none if they haven't chosen one).
    Anonymous complaints still show here for the resident who sent them."""
    unit=serializers.SerializerMethodField()

    class Meta:
        model=Complaint
        fields=[
            "id","title","description","photo","is_anonymous","unit",
            "status","response","created_at","resolved_at",
        ]
        read_only_fields=["id","unit","status","response","created_at","resolved_at"]
        extra_kwargs={
            "description": {"allow_blank": True, "required": False},
            "photo": {"required": False},
        }

    def get_unit(self, complaint):
        if complaint.unit is None:
            return None
        return {"id": complaint.unit.id, "name": complaint.unit.name, "floor": complaint.unit.floor.number}

    def validate_title(self, value):
        value=value.strip()
        if not value:
            raise serializers.ValidationError("Say briefly what the problem is.")
        return value

    def validate_description(self, value):
        return value.strip()

    def validate_photo(self, value):
        if value and value.size > MAX_COMPLAINT_PHOTO:
            raise serializers.ValidationError("The photo is too big. The limit is 10 MB.")
        return value

    def create(self, validated_data):
        request=self.context["request"]
        return Complaint.objects.create(
            building=request.user.building,
            raised_by=request.user,
            unit=self.context.get("unit"),
            **validated_data,
        )


# ---------- Visitor log ----------

def short_name(user):
    return (user.full_name or user.username) if user else None

class EntrySerializer(serializers.ModelSerializer):
    """One person coming through the gate. Guards check people in; check-in time is set by the server.
    Only the name is required; phone, unit, purpose and vehicle are optional."""
    unit=serializers.PrimaryKeyRelatedField(queryset=Unit.objects.none(),required=False,allow_null=True)
    unit_info=serializers.SerializerMethodField()
    logged_by=serializers.SerializerMethodField()
    checked_out_by=serializers.SerializerMethodField()
    is_inside=serializers.BooleanField(read_only=True)

    class Meta:
        model=EntryLog
        fields=[
            "id","entry_type","name","phone","unit","unit_info","purpose","vehicle_no",
            "check_in","check_out","is_inside","logged_by","checked_out_by",
        ]
        read_only_fields=["id","check_in","check_out"]
        extra_kwargs={
            "phone": {"required": False, "allow_blank": True},
            "purpose": {"required": False, "allow_blank": True},
            "vehicle_no": {"required": False, "allow_blank": True},
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request=self.context.get("request")
        if request is not None and request.user.building_id:
            # Only units in the guard's own building
            self.fields["unit"].queryset=Unit.objects.filter(floor__building_id=request.user.building_id)

    def get_unit_info(self, entry):
        if entry.unit is None:
            return None
        return {"id": entry.unit.id, "name": entry.unit.name, "floor": entry.unit.floor.number}

    def get_logged_by(self, entry):
        return short_name(entry.logged_by)

    def get_checked_out_by(self, entry):
        return short_name(entry.checked_out_by)

    def validate_name(self, value):
        value=" ".join(value.split())
        if not value:
            raise serializers.ValidationError("Enter their name.")
        return value

    def validate_phone(self, value):
        value=re.sub(r"[\s-]", "", value)
        if value and not re.fullmatch(r"\+?\d{7,15}", value):
            raise serializers.ValidationError("Enter a phone number using digits only, e.g. 9841234567.")
        return value

    def validate_vehicle_no(self, value):
        return " ".join(value.upper().split())

    def validate_purpose(self, value):
        return value.strip()


# ---------- Payments ----------

MAX_PROOF=10*1024*1024     # 10 MB
MAX_QR=5*1024*1024         # 5 MB

def person(user):
    return (user.full_name or user.username) if user else None

class PaymentSerializer(serializers.ModelSerializer):
    """A payment towards a bill, as both the secretary and the resident see it."""
    kind_label=serializers.CharField(source="get_kind_display",read_only=True)
    method_label=serializers.SerializerMethodField()
    submitted_by=serializers.SerializerMethodField()
    decided_by=serializers.SerializerMethodField()
    bill_info=serializers.SerializerMethodField()

    class Meta:
        model=Payment
        fields=[
            "id","bill","bill_info","amount","kind","kind_label","payment_method","method_label",
            "reference","paid_on","proof","note","status","reject_reason",
            "submitted_by","decided_by","decided_at","receipt_no","created_at",
        ]

    def get_method_label(self, p):
        return p.payment_method.label if p.payment_method else None

    def get_submitted_by(self, p):
        return person(p.submitted_by)

    def get_decided_by(self, p):
        return person(p.decided_by)

    def get_bill_info(self, p):
        b=p.bill
        return {"id": b.id, "period": b.period.strftime("%Y-%m"), "unit": b.unit.name, "floor": b.unit.floor.number,
                "total": str(sum((i.amount for i in b.items.all()), Decimal(0)))}

class NewPaymentSerializer(serializers.Serializer):
    """A payment being recorded (secretary) or reported (resident) against a bill.
    context: bill, building, by_resident."""
    amount=serializers.DecimalField(max_digits=10,decimal_places=2,min_value=Decimal("0.01"))
    kind=serializers.ChoiceField(choices=[k for k, _ in PAYMENT_KINDS])
    payment_method=serializers.PrimaryKeyRelatedField(queryset=PaymentMethod.objects.none(),required=False,allow_null=True)
    reference=serializers.CharField(required=False,allow_blank=True,max_length=80,default="")
    paid_on=serializers.DateField()
    proof=serializers.ImageField(required=False,allow_null=True)
    note=serializers.CharField(required=False,allow_blank=True,max_length=200,default="")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        building=self.context.get("building")
        if building is not None:
            self.fields["payment_method"].queryset=PaymentMethod.objects.filter(building=building)

    def validate_reference(self, value):
        return value.strip()

    def validate_paid_on(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError("The payment date can't be in the future.")
        return value

    def validate_proof(self, value):
        if value and value.size > MAX_PROOF:
            raise serializers.ValidationError("The screenshot is too big. The limit is 10 MB.")
        return value

    def validate(self, attrs):
        bill=self.context["bill"]
        by_resident=self.context.get("by_resident", False)
        limit=bill.balance - (bill.amount_pending if by_resident else Decimal(0))
        if limit <= 0:
            raise serializers.ValidationError(
                "Nothing is left to pay on this bill." if not by_resident or bill.balance <= 0
                else "You've already reported payments covering this bill. Wait for your secretary to confirm them."
            )
        if attrs["amount"] > limit:
            raise serializers.ValidationError({"amount": f"That's more than what's left to pay (Rs. {limit:,.2f})."})
        if by_resident and attrs["kind"] not in ("cash", "cheque") and not attrs.get("reference") and not attrs.get("proof"):
            raise serializers.ValidationError({"reference": "Enter the transaction ID, or attach a screenshot of the payment."})
        return attrs

class PaymentMethodSerializer(serializers.ModelSerializer):
    """One of the building's ways to pay: a QR and/or bank details."""
    kind_label=serializers.CharField(source="get_kind_display",read_only=True)

    class Meta:
        model=PaymentMethod
        fields=[
            "id","kind","kind_label","label","account_name","account_number","bank_name","branch",
            "qr","is_active","created_at","updated_at",
        ]
        read_only_fields=["id","is_active","created_at","updated_at"]
        extra_kwargs={
            "account_number": {"required": False, "allow_blank": True},
            "bank_name": {"required": False, "allow_blank": True},
            "branch": {"required": False, "allow_blank": True},
            "qr": {"required": False},
        }

    def validate_label(self, value):
        value=value.strip()
        if not value:
            raise serializers.ValidationError("Give this payment option a short name, e.g. \"Scan with any bank app\".")
        return value

    def validate_account_name(self, value):
        value=value.strip()
        if not value:
            raise serializers.ValidationError("Whose account is it? Residents see this before paying.")
        return value

    def validate_qr(self, value):
        if value and value.size > MAX_QR:
            raise serializers.ValidationError("The QR image is too big. The limit is 5 MB.")
        return value

    def validate(self, attrs):
        qr=attrs.get("qr", self.instance.qr if self.instance else None)
        number=attrs.get("account_number", self.instance.account_number if self.instance else "")
        if not qr and not number:
            raise serializers.ValidationError("Add a QR code image, an account number, or both.")
        return attrs

class PaymentDetailsChangeSerializer(serializers.ModelSerializer):
    changed_by=serializers.SerializerMethodField()

    class Meta:
        model=PaymentDetailsChange
        fields=["id","summary","changed_by","created_at"]

    def get_changed_by(self, change):
        return person(change.changed_by)
