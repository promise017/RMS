from django.shortcuts import render
from rest_framework import generics
from rest_framework.views import APIView
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from .models import Notice, Building, BuildingImage, Floor, Unit, UnitImage, Complaint, ResidentProfile, Bill, BillItem
from .serializers import MonthField, BillSerializer, BulkBillSerializer, ResidentBillSerializer, rent_item
from .serializers import SendBillsSerializer, PaymentSerializer, NewPaymentSerializer, PaymentMethodSerializer, PaymentDetailsChangeSerializer
from .models import Payment, PaymentMethod, PaymentDetailsChange
from .models import attach_to_open_bills
from django.db.models import Sum, Count
from decimal import Decimal
from .serializers import ResidentComplaintSerializer, EntrySerializer
from .models import EntryLog, LastSeen, Notice
from accounts.permissions import IsGuardOrSecretaryReadOnly, IsGuard
from django.db.models import Q
from datetime import date as date_cls, timedelta
from rest_framework.exceptions import ValidationError
from django.utils import timezone
from .serializers import (
    NoticeSerializer, BuildingSerializer, JoinBuildingSerializer, MemberSerializer, GuardCreateSerializer,
    UnitSerializer, FloorSerializer, CopyFloorSerializer, SecretaryComplaintSerializer,
    ResidentUnitSerializer, ResidentBuildingSerializer, AssignUnitSerializer,
)
from django.db import transaction
from django.db.models import Prefetch
from accounts.models import User
from accounts.permissions import IsSecretary, IsResidentOrGuard, IsResident
from rest_framework.parsers import FormParser, MultiPartParser

class NoticeView(ListAPIView):
    serializer_class=NoticeSerializer

    def get_queryset(self):
        # Only notices from the building this user belongs to
        building = self.request.user.current_building
        if building is None:
            return Notice.objects.none()
        return Notice.objects.filter(building=building)

class CreateBuildingView(generics.CreateAPIView):
    serializer_class=BuildingSerializer
    permission_classes=[IsSecretary]
    parser_classes=[MultiPartParser, FormParser]

class MyBuildingView(APIView):
    """GET the secretary's building (or null), PATCH to edit it or turn the code on/off."""
    permission_classes=[IsSecretary]

    def get(self, request):
        building = request.user.buildings.first()
        if building is None:
            return Response({"building": None})
        return Response({"building": BuildingSerializer(building, context={"request": request}).data})

    def patch(self, request):
        building = request.user.buildings.first()
        if building is None:
            return Response({"detail": "You have not set up a building yet."}, status=404)
        serializer = BuildingSerializer(
            building, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"building": serializer.data})

class RegenerateCodeView(APIView):
    permission_classes=[IsSecretary]

    def post(self, request):
        building = request.user.buildings.first()
        if building is None:
            return Response({"detail": "You have not set up a building yet."}, status=404)
        building.regenerate_join_code()
        return Response({"building": BuildingSerializer(building, context={"request": request}).data})

class DeleteBuildingImageView(APIView):
    permission_classes=[IsSecretary]

    def delete(self, request, pk):
        # Only photos of the secretary's own building
        image = BuildingImage.objects.filter(pk=pk, building__secretary=request.user).first()
        if image is None:
            return Response({"detail": "Photo not found."}, status=404)
        building = image.building
        image.photo.delete(save=False)   # remove the file from media/ too
        image.delete()
        return Response({"building": BuildingSerializer(building, context={"request": request}).data})

class MembersView(APIView):
    """The secretary's residents and guards."""
    permission_classes=[IsSecretary]

    def get(self, request):
        building = request.user.buildings.first()
        if building is None:
            return Response({"detail": "You have not set up a building yet."}, status=404)
        members = building.members.select_related("resident_profile__unit__floor")
        unpaid = {}
        open_bills = (Bill.objects.filter(status=Bill.Status.UNPAID, sent_at__isnull=False, billed_residents__building=building)
                      .distinct().prefetch_related("items", "payments", "billed_residents"))
        for bill in open_bills:
            for resident in bill.billed_residents.all():
                row = unpaid.setdefault(resident.id, {"count": 0, "total": Decimal(0)})
                row["count"] += 1
                row["total"] += bill.balance
        for row in unpaid.values():
            row["total"] = str(row["total"].quantize(Decimal("0.01")))
        context = {"request": request, "unpaid": unpaid}
        units = Unit.objects.filter(floor__building=building).select_related("floor")
        return Response({
            "residents": MemberSerializer(members.filter(role="resident"), many=True, context=context).data,
            "guards": MemberSerializer(members.filter(role="guard"), many=True, context=context).data,
            "units": [{"id": u.id, "name": u.name, "floor": u.floor.number} for u in units],
        })

class GuardsView(APIView):
    """POST: the secretary creates a guard account in their building."""
    permission_classes=[IsSecretary]

    def post(self, request):
        building = request.user.buildings.first()
        if building is None:
            return Response({"detail": "You have not set up a building yet."}, status=404)
        serializer = GuardCreateSerializer(data=request.data, context={"request": request, "building": building})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=201)

class RemoveGuardView(APIView):
    """DELETE: take a guard out of the building. Their account stays, so they could
    join again with the code - make a new code if that shouldn't happen."""
    permission_classes=[IsSecretary]

    def delete(self, request, pk):
        guard = User.objects.filter(
            pk=pk, role=User.Role.GUARD, building__secretary=request.user
        ).first()
        if guard is None:
            return Response({"detail": "Guard not found."}, status=404)
        guard.building = None
        guard.save(update_fields=["building"])
        return Response(status=204)

def floors_with_units(building):
    units = Unit.objects.prefetch_related("images", "residents")
    return building.floors.prefetch_related(Prefetch("units", queryset=units))

class FloorsView(APIView):
    """Every floor of the secretary's building with its units."""
    permission_classes=[IsSecretary]

    def get(self, request):
        building = request.user.buildings.first()
        if building is None:
            return Response({"detail": "You have not set up a building yet."}, status=404)
        floors = floors_with_units(building)
        return Response({"floors": FloorSerializer(floors, many=True, context={"request": request}).data})

class UnitCreateView(generics.CreateAPIView):
    serializer_class=UnitSerializer
    permission_classes=[IsSecretary]

class UnitDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class=UnitSerializer
    permission_classes=[IsSecretary]

    def get_queryset(self):
        return Unit.objects.filter(floor__building__secretary=self.request.user)

    def destroy(self, request, *args, **kwargs):
        unit = self.get_object()
        # Deleting would also delete its bills and leave residents without a unit
        if unit.residents.exists():
            return Response({"detail": f"{unit.name} has residents living in it. Move them to another unit first."}, status=400)
        if unit.bills.exists():
            return Response({"detail": f"{unit.name} has bills, so it can't be deleted."}, status=400)
        with transaction.atomic():
            for image in unit.images.all():
                image.photo.delete(save=False)
            unit.delete()
        return Response(status=204)

class DeleteUnitImageView(APIView):
    permission_classes=[IsSecretary]

    def delete(self, request, pk):
        image = UnitImage.objects.filter(pk=pk, unit__floor__building__secretary=request.user).first()
        if image is None:
            return Response({"detail": "Photo not found."}, status=404)
        unit = image.unit
        image.photo.delete(save=False)   # remove the file from media/ too
        image.delete()
        return Response(UnitSerializer(unit, context={"request": request}).data)

class CopyFloorView(APIView):
    """Copy a floor's units (name, area, rent) to other floors. Units whose name
    already exists on a target floor are skipped, so it is safe to run twice."""
    permission_classes=[IsSecretary]

    @transaction.atomic
    def post(self, request, pk):
        source = Floor.objects.filter(pk=pk, building__secretary=request.user).first()
        if source is None:
            return Response({"detail": "Floor not found."}, status=404)
        serializer = CopyFloorSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        templates = list(source.units.all())
        if not templates:
            return Response({"detail": f"Floor {source.number} has no units to copy."}, status=400)
        targets = Floor.objects.filter(
            building=source.building, pk__in=serializer.validated_data["to_floors"]
        ).exclude(pk=source.pk)

        created, skipped = [], 0
        for floor in targets:
            taken = {name.lower() for name in floor.units.values_list("name", flat=True)}
            for t in templates:
                if t.name.lower() in taken:
                    skipped += 1
                else:
                    created.append(Unit(floor=floor, name=t.name, area=t.area, rent=t.rent))
        Unit.objects.bulk_create(created)

        floors = floors_with_units(source.building)
        return Response({
            "created": len(created),
            "skipped": skipped,
            "floors": FloorSerializer(floors, many=True, context={"request": request}).data,
        })

class SecretaryComplaintsView(generics.ListAPIView):
    """Complaints in the secretary's building, newest first. ?status=open|resolved"""
    serializer_class=SecretaryComplaintSerializer
    permission_classes=[IsSecretary]
    pagination_class=None

    def get_queryset(self):
        complaints = Complaint.objects.filter(
            building__secretary=self.request.user
        ).select_related("raised_by", "unit__floor")
        status = self.request.query_params.get("status")
        if status in Complaint.Status.values:
            complaints = complaints.filter(status=status)
        return complaints

class SecretaryComplaintDetailView(generics.RetrieveUpdateAPIView):
    """PATCH status and/or response."""
    serializer_class=SecretaryComplaintSerializer
    permission_classes=[IsSecretary]
    http_method_names=["get", "patch", "options", "head"]

    def get_queryset(self):
        return Complaint.objects.filter(building__secretary=self.request.user)

class SecretaryNoticesView(generics.ListCreateAPIView):
    """The secretary's notices, newest first; POST to publish a new one."""
    serializer_class=NoticeSerializer
    permission_classes=[IsSecretary]
    pagination_class=None

    def get_queryset(self):
        return Notice.objects.filter(building__secretary=self.request.user).select_related("posted_by")

    def create(self, request, *args, **kwargs):
        if request.user.buildings.first() is None:
            return Response({"detail": "You have not set up a building yet."}, status=404)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(building=self.request.user.buildings.first(), posted_by=self.request.user)

class SecretaryNoticeDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class=NoticeSerializer
    permission_classes=[IsSecretary]
    http_method_names=["get", "patch", "delete", "options", "head"]

    def get_queryset(self):
        return Notice.objects.filter(building__secretary=self.request.user)

    def perform_destroy(self, notice):
        if notice.attachment:
            notice.attachment.delete(save=False)   # remove the file from media/ too
        notice.delete()

class AssignUnitView(APIView):
    """PATCH {unit: id or null, moved_in?}: put a resident of the building in a unit."""
    permission_classes=[IsSecretary]

    def patch(self, request, pk):
        resident = User.objects.filter(
            pk=pk, role=User.Role.RESIDENT, building__secretary=request.user
        ).first()
        if resident is None:
            return Response({"detail": "Resident not found."}, status=404)
        serializer = AssignUnitSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        unit = serializer.validated_data["unit"]

        profile, _ = ResidentProfile.objects.get_or_create(user=resident)
        if "moved_in" in serializer.validated_data:
            profile.moved_in = serializer.validated_data["moved_in"]
        elif unit is None:
            profile.moved_in = None
        elif unit != profile.unit:
            profile.moved_in = timezone.localdate()   # moving into a new unit today
        profile.unit = unit
        profile.save()
        if unit is not None:
            attach_to_open_bills(resident, unit)
        return Response(MemberSerializer(resident, context={"request": request}).data)

def current_unit(user):
    """The resident's profile and unit, ignoring a unit left over from another building."""
    profile = ResidentProfile.objects.filter(user=user).select_related("unit__floor").first()
    unit = profile.unit if profile else None
    if unit is not None and unit.floor.building_id != user.building_id:
        unit = None
    return profile, unit

class MyUnitView(APIView):
    """GET the resident's building and unit (unit is null until they choose one).
    POST {unit} to choose it - only once; after that only the secretary can change it."""
    permission_classes=[IsResident]

    def get(self, request):
        building = request.user.building
        if building is None:
            return Response({"detail": "You have not joined a building yet."}, status=404)
        profile, unit = current_unit(request.user)
        context = {"request": request}
        return Response({
            "building": ResidentBuildingSerializer(building, context=context).data,
            "unit": ResidentUnitSerializer(unit, context=context).data if unit else None,
            "moved_in": profile.moved_in if profile and unit else None,
        })

    def post(self, request):
        building = request.user.building
        if building is None:
            return Response({"detail": "You have not joined a building yet."}, status=404)
        profile, unit = current_unit(request.user)
        if unit is not None:
            return Response(
                {"detail": "You have already chosen your unit. Ask your secretary if it needs to change."},
                status=400,
            )
        chosen = Unit.objects.filter(pk=request.data.get("unit"), floor__building=building).first()
        if chosen is None:
            return Response({"unit": ["Choose a unit in your building."]}, status=400)

        profile, _ = ResidentProfile.objects.get_or_create(user=request.user)
        profile.unit = chosen
        profile.moved_in = timezone.localdate()
        profile.save()
        attach_to_open_bills(request.user, chosen)
        return self.get(request)

class UnitChoicesView(APIView):
    """Every floor of the resident's building with its unit names, for choosing their unit."""
    permission_classes=[IsResident]

    def get(self, request):
        building = request.user.building
        if building is None:
            return Response({"detail": "You have not joined a building yet."}, status=404)
        floors = building.floors.prefetch_related("units")
        return Response({"floors": [
            {
                "number": floor.number,
                "units": [{"id": u.id, "name": u.name, "area": u.area} for u in floor.units.all()],
            }
            for floor in floors
        ]})

def bills_queryset():
    return Bill.objects.select_related("unit__floor__building").prefetch_related(
        "items", "billed_residents", "unit__residents__user",
        Prefetch("payments", queryset=Payment.objects.select_related("payment_method", "submitted_by", "decided_by").order_by("created_at")),
    )

def parse_month(value):
    """?period=YYYY-MM from the query string, or a 400 error."""
    try:
        return MonthField().to_internal_value(value)
    except ValidationError:
        raise ValidationError({"period": "Use the format YYYY-MM, e.g. 2026-10."})

class SecretaryBillsView(generics.ListCreateAPIView):
    """Bills in the secretary's building.
    Filters: ?period=YYYY-MM  &status=draft|unpaid|paid (unpaid = sent and not paid)
             &overdue=true (sent, unpaid and past the due date, any month)  &unit=<id>  &floor=<number>
    POST creates one unit's bill for a month (a draft unless send=true)."""
    serializer_class=BillSerializer
    permission_classes=[IsSecretary]
    pagination_class=None

    def get_queryset(self):
        bills = bills_queryset().filter(unit__floor__building__secretary=self.request.user)
        params = self.request.query_params
        if params.get("period"):
            bills = bills.filter(period=parse_month(params["period"]))
        status = params.get("status")
        if status == "draft":
            bills = bills.filter(sent_at__isnull=True)
        elif status in Bill.Status.values:
            bills = bills.filter(status=status, sent_at__isnull=False)
        if params.get("overdue") == "true":
            bills = bills.filter(status=Bill.Status.UNPAID, sent_at__isnull=False, due_date__lt=timezone.localdate())
        if params.get("unit", "").isdigit():
            bills = bills.filter(unit_id=params["unit"])
        if params.get("floor", "").isdigit():
            bills = bills.filter(unit__floor__number=params["floor"])
        if status == "unpaid" or params.get("overdue") == "true":
            return bills.order_by("due_date", "unit__floor__number", "unit__name")   # most overdue first
        return bills.order_by("-period", "unit__floor__number", "unit__name")

class SecretaryBillDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH due_date, note, status, or items (replaces every line). Paid bills can't be deleted."""
    serializer_class=BillSerializer
    permission_classes=[IsSecretary]
    http_method_names=["get", "patch", "delete", "options", "head"]

    def get_queryset(self):
        return bills_queryset().filter(unit__floor__building__secretary=self.request.user)

    def destroy(self, request, *args, **kwargs):
        bill = self.get_object()
        if bill.status == Bill.Status.PAID:
            return Response({"detail": "Paid bills can't be deleted. Reverse its payments first if it was a mistake."}, status=400)
        if bill.payments.filter(status=Payment.Status.CONFIRMED).exists():
            return Response({"detail": "This bill has payments recorded. Reverse them before deleting it."}, status=400)
        bill.delete()
        return Response(status=204)

class BulkBillsView(APIView):
    """POST {period, due_date, units?, items?, include_rent?, note?}: create a month's bills for many units.
    Units that already have a bill for that month are skipped, so it is safe to run twice."""
    permission_classes=[IsSecretary]

    @transaction.atomic
    def post(self, request):
        building = request.user.buildings.first()
        if building is None:
            return Response({"detail": "You have not set up a building yet."}, status=404)
        serializer = BulkBillSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        units = Unit.objects.filter(floor__building=building).select_related("floor")
        if "units" in data:
            units = units.filter(pk__in=data["units"])
        units = list(units)
        if not units:
            return Response({"units": ["None of these units are in your building."]}, status=400)

        already = set(Bill.objects.filter(unit__in=units, period=data["period"]).values_list("unit_id", flat=True))
        created, skipped_existing, skipped_empty = [], [], []
        for unit in units:
            if unit.id in already:
                skipped_existing.append(unit)
                continue
            rent = rent_item(unit) if data["include_rent"] else None
            lines = ([rent] if rent else []) + [BillItem(**item) for item in data["items"]]
            if not lines:
                skipped_empty.append(unit)   # no rent and no shared charges: nothing to bill
                continue
            created.append((Bill(unit=unit, period=data["period"], due_date=data["due_date"],
                                 note=data["note"], created_by=request.user), lines))

        bills = Bill.objects.bulk_create([bill for bill, _ in created])
        all_lines = []
        for bill, (_, lines) in zip(bills, created):
            for line in lines:
                line.bill = bill
                all_lines.append(line)
        BillItem.objects.bulk_create(all_lines)
        if data["send"]:
            now = timezone.now()
            for bill in bills:
                bill.send(when=now)

        label = lambda u: {"id": u.id, "name": u.name, "floor": u.floor.number}
        return Response({
            "period": MonthField().to_representation(data["period"]),
            "created": len(bills),
            "sent": data["send"],
            "skipped_existing": [label(u) for u in skipped_existing],
            "skipped_no_charges": [label(u) for u in skipped_empty],
        }, status=201)

class SendBillsView(APIView):
    """POST {ids: [...]} or {period: "YYYY-MM"}: send draft bills to the residents of their units.
    Bills that were already sent are left alone."""
    permission_classes=[IsSecretary]

    @transaction.atomic
    def post(self, request):
        serializer = SendBillsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        drafts = Bill.objects.filter(unit__floor__building__secretary=request.user, sent_at__isnull=True).select_related("unit__floor")
        if serializer.validated_data.get("ids"):
            drafts = drafts.filter(pk__in=serializer.validated_data["ids"])
        if serializer.validated_data.get("period"):
            drafts = drafts.filter(period=serializer.validated_data["period"])
        now = timezone.now()
        sent = sum(1 for bill in drafts if bill.send(when=now))
        return Response({"sent": sent})

class MyBillsView(generics.ListAPIView):
    """Bills sent to this resident, newest first: only the ones they were billed for
    (never an earlier tenant's), including unpaid ones from a unit they've since left."""
    serializer_class=ResidentBillSerializer
    permission_classes=[IsResident]
    pagination_class=None

    def get_queryset(self):
        return (bills_queryset()
                .filter(billed_residents=self.request.user, sent_at__isnull=False)
                .order_by("-period"))

class MyComplaintsView(generics.ListCreateAPIView):
    """The resident's own complaints, newest first, with the secretary's replies.
    POST (multipart for a photo): title, description?, photo?, is_anonymous?.
    The complaint is filed against the resident's current unit automatically."""
    serializer_class=ResidentComplaintSerializer
    permission_classes=[IsResident]
    pagination_class=None

    def get_queryset(self):
        return Complaint.objects.filter(
            raised_by=self.request.user, building=self.request.user.building
        ).select_related("unit__floor")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["unit"] = current_unit(self.request.user)[1]
        return context

    def create(self, request, *args, **kwargs):
        if request.user.building is None:
            return Response({"detail": "Join a building before sending a complaint."}, status=400)
        return super().create(request, *args, **kwargs)

class MyComplaintDetailView(generics.RetrieveDestroyAPIView):
    """GET one of the resident's complaints; DELETE withdraws it while it is still open and unanswered."""
    serializer_class=ResidentComplaintSerializer
    permission_classes=[IsResident]

    def get_queryset(self):
        return Complaint.objects.filter(raised_by=self.request.user).select_related("unit__floor")

    def destroy(self, request, *args, **kwargs):
        complaint = self.get_object()
        if complaint.status != Complaint.Status.OPEN or complaint.response:
            return Response(
                {"detail": "Your secretary is already handling this complaint, so it can't be withdrawn."},
                status=400,
            )
        if complaint.photo:
            complaint.photo.delete(save=False)   # remove the file from media/ too
        complaint.delete()
        return Response(status=204)

MAX_LOG_ROWS = 500

class VisitorsView(generics.ListCreateAPIView):
    """The building's visitor log, newest first.
    GET filters: ?inside=true (still inside, any day) | ?date=YYYY-MM-DD (checked in that day, default today)
                 &type=visitor|worker|delivery &q=<name, phone, vehicle or unit>
    POST (guards only) checks someone in."""
    serializer_class=EntrySerializer
    permission_classes=[IsGuardOrSecretaryReadOnly]
    pagination_class=None

    def get_queryset(self):
        building = self.request.user.current_building
        if building is None:
            return EntryLog.objects.none()
        entries = EntryLog.objects.filter(building=building).select_related("unit__floor", "logged_by", "checked_out_by")
        params = self.request.query_params

        if params.get("inside") == "true":
            entries = entries.filter(check_out__isnull=True)
        else:
            day = timezone.localdate()
            if params.get("date"):
                try:
                    day = date_cls.fromisoformat(params["date"])
                except ValueError:
                    raise ValidationError({"date": "Use the format YYYY-MM-DD."})
            entries = entries.filter(check_in__date=day)

        if params.get("type") in EntryLog.EntryType.values:
            entries = entries.filter(entry_type=params["type"])
        q = params.get("q", "").strip()
        if q:
            entries = entries.filter(
                Q(name__icontains=q) | Q(phone__icontains=q) | Q(vehicle_no__icontains=q) | Q(unit__name__iexact=q)
            )
        return entries.order_by("-check_in")[:MAX_LOG_ROWS]

    def create(self, request, *args, **kwargs):
        if request.user.building is None:
            return Response({"detail": "Join a building before logging visitors."}, status=400)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(building=self.request.user.building, logged_by=self.request.user)

class CheckOutView(APIView):
    """POST: a guard records that someone has left."""
    permission_classes=[IsGuard]

    def post(self, request, pk):
        entry = EntryLog.objects.filter(pk=pk, building_id=request.user.building_id).first()
        if entry is None:
            return Response({"detail": "Entry not found."}, status=404)
        if entry.check_out is not None:
            return Response({"detail": f"{entry.name} was already checked out."}, status=400)
        entry.check_out = timezone.now()
        entry.checked_out_by = request.user
        entry.save(update_fields=["check_out", "checked_out_by"])
        return Response(EntrySerializer(entry, context={"request": request}).data)

class VisitorLookupView(APIView):
    """GET ?phone=...: details from this phone number's latest visit, so the guard doesn't retype them."""
    permission_classes=[IsGuard]

    def get(self, request):
        phone = "".join(request.query_params.get("phone", "").split()).replace("-", "")
        if len(phone) < 7 or not request.user.building_id:
            return Response({"found": False})
        last = (EntryLog.objects.filter(building_id=request.user.building_id, phone=phone)
                .select_related("unit__floor").order_by("-check_in").first())
        if last is None:
            return Response({"found": False})
        return Response({
            "found": True,
            "name": last.name,
            "entry_type": last.entry_type,
            "unit": last.unit_id,
            "purpose": last.purpose,
            "vehicle_no": last.vehicle_no,
            "visits": EntryLog.objects.filter(building_id=request.user.building_id, phone=phone).count(),
        })

class GateUnitsView(APIView):
    """The building's units by floor, for the 'visiting' picker."""
    permission_classes=[IsGuardOrSecretaryReadOnly]

    def get(self, request):
        building = request.user.current_building
        if building is None:
            return Response({"floors": []})
        floors = building.floors.prefetch_related("units")
        return Response({"floors": [
            {"number": f.number, "units": [{"id": u.id, "name": u.name} for u in f.units.all()]}
            for f in floors
        ]})

# The sections that can show an unread badge, per role
BADGE_SECTIONS = {
    "secretary": ["complaints", "payments"],
    "resident": ["notices", "bills", "complaints"],
    "guard": ["notices"],
}

def unread_counts(user):
    """{section: number of new things since the user last opened that section}."""
    sections = BADGE_SECTIONS.get(user.role, [])
    building = user.current_building
    if building is None or not sections:
        return {}
    seen = dict(LastSeen.objects.filter(user=user, section__in=sections).values_list("section", "seen_at"))
    # Never opened a section yet: count from when they joined, not from the beginning of time
    since = lambda section: seen.get(section, user.date_joined)

    counts = {}
    if user.role == "secretary":
        counts["complaints"] = Complaint.objects.filter(building=building, created_at__gt=since("complaints")).count()
        # Not "since last seen": every payment waiting for confirmation counts until it's handled
        counts["payments"] = Payment.objects.filter(bill__unit__floor__building=building, status=Payment.Status.PENDING).count()
    if "notices" in sections:
        counts["notices"] = Notice.objects.filter(building=building, created_at__gt=since("notices")).count()
    if user.role == "resident":
        # New bills sent to them, or sent bills that changed since they last looked
        seen_bills = since("bills")
        mine = Bill.objects.filter(billed_residents=user, sent_at__isnull=False)
        flagged = set(mine.filter(Q(sent_at__gt=seen_bills) | Q(changed_at__gt=seen_bills)).values_list("id", flat=True))
        # Reminders: due soon / became overdue / still overdue a week later, since they last looked
        last_look = timezone.localtime(seen_bills).date()
        for bill in mine.filter(status=Bill.Status.UNPAID):
            if any(day > last_look for day in bill.reminder_dates()):
                flagged.add(bill.id)
        # Their reported payments that the secretary confirmed or rejected since they last looked
        flagged |= set(Payment.objects.filter(bill__in=mine, submitted_by=user, decided_at__gt=seen_bills)
                       .values_list("bill_id", flat=True))
        # Read fresh: the building object hanging off the user may be older than the change
        changed_at = Building.objects.filter(pk=building.pk).values_list("payment_details_changed_at", flat=True).first()
        details_changed = changed_at is not None and changed_at > seen_bills
        counts["bills"] = len(flagged) + (1 if details_changed else 0)
        counts["complaints"] = Complaint.objects.filter(raised_by=user, last_update_at__gt=since("complaints")).count()
    return counts

class BadgesView(APIView):
    """GET: unread counts for the sidebar, e.g. {"notices": 2, "complaints": 0}."""

    def get(self, request):
        return Response(unread_counts(request.user))

class MarkSeenView(APIView):
    """POST: the user opened a section, so everything in it counts as read. Returns the new counts."""

    def post(self, request, section):
        if section not in BADGE_SECTIONS.get(request.user.role, []):
            return Response({"detail": "No such section."}, status=404)
        LastSeen.objects.update_or_create(user=request.user, section=section, defaults={"seen_at": timezone.now()})
        return Response(unread_counts(request.user))

def paid_total(bills):
    """Sum of confirmed payments on these bills, as a 2-decimal string."""
    total = Payment.objects.filter(bill__in=bills, status=Payment.Status.CONFIRMED).aggregate(t=Sum("amount"))["t"] or Decimal(0)
    return str(total.quantize(Decimal("0.01")))

def item_total(bills):
    """Sum of all charge lines on these bills, as a 2-decimal string."""
    total = BillItem.objects.filter(bill__in=bills).aggregate(t=Sum("amount"))["t"] or Decimal(0)
    return str(total.quantize(Decimal("0.01")))

LONG_STAY_HOURS = 12

def most_common_due_date(bills):
    """The due date most of this month's bills share (they're usually billed together)."""
    row = bills.values("due_date").annotate(n=Count("id")).order_by("-n", "due_date").first()
    return row["due_date"] if row else None

def same_point_last_month(sent, month, now):
    """How much of last month's billed money had been paid by the same day of that month,
    so this month's progress can be compared like for like."""
    last = (month - timedelta(days=1)).replace(day=1)
    elapsed = now - timezone.make_aware(timezone.datetime(month.year, month.month, 1))
    month_end = timezone.make_aware(timezone.datetime(month.year, month.month, 1))   # = end of last month
    cutoff = min(timezone.make_aware(timezone.datetime(last.year, last.month, 1)) + elapsed, month_end)
    last_bills = sent.filter(period=last)
    billed = BillItem.objects.filter(bill__in=last_bills).aggregate(t=Sum("amount"))["t"] or Decimal(0)
    if not billed:
        return None
    collected = (Payment.objects.filter(bill__in=last_bills, status=Payment.Status.CONFIRMED, decided_at__lte=cutoff)
                 .aggregate(t=Sum("amount"))["t"] or Decimal(0))
    return {
        "period": MonthField().to_representation(last),
        "billed": str(billed.quantize(Decimal("0.01"))),
        "collected_by_same_day": str(collected.quantize(Decimal("0.01"))),
        "same_day": timezone.localtime(cutoff).date(),
    }

def building_map(building, month, today):
    """Every floor (top first) and unit with what the dashboard map colours by:
    this month's bill, who lives there, what they owe, and open complaints.
    Anonymous complaints are never counted against a unit, which would reveal the sender."""
    units = list(Unit.objects.filter(floor__building=building).select_related("floor").order_by("-floor__number", "name"))

    residents = {}
    for profile in ResidentProfile.objects.filter(unit__in=units).select_related("user").order_by("user__first_name"):
        u = profile.user
        residents.setdefault(profile.unit_id, []).append(
            {"id": u.id, "name": u.full_name or u.username, "phone": u.phone1, "moved_in": profile.moved_in}
        )

    this_month = {}
    for bill in Bill.objects.filter(unit__in=units, period=month).prefetch_related("items"):
        if bill.sent_at is None:
            state = "draft"
        elif bill.status == Bill.Status.PAID:
            state = "paid"
        elif bill.due_date < today:
            state = "overdue"
        else:
            state = "unpaid"
        this_month[bill.unit_id] = {"id": bill.id, "state": state, "total": str(sum((i.amount for i in bill.items.all()), Decimal(0))),
                                    "due_date": bill.due_date}

    owed = {}
    for bill in (Bill.objects.filter(unit__in=units, status=Bill.Status.UNPAID, sent_at__isnull=False)
                 .prefetch_related("items", "payments")):
        row = owed.setdefault(bill.unit_id, {"total": Decimal(0), "overdue": Decimal(0), "bills": 0})
        row["total"] += bill.balance
        row["bills"] += 1
        if bill.due_date < today:
            row["overdue"] += bill.balance

    complaints = {
        row["unit"]: row["n"]
        for row in (Complaint.objects.filter(building=building, unit__in=units, is_anonymous=False)
                    .exclude(status=Complaint.Status.RESOLVED)
                    .values("unit").annotate(n=Count("id")))
    }

    money = lambda d: str((d or Decimal(0)).quantize(Decimal("0.01")))
    floors = []
    for unit in units:
        if not floors or floors[-1]["number"] != unit.floor.number:
            floors.append({"number": unit.floor.number, "units": []})
        o = owed.get(unit.id, {})
        floors[-1]["units"].append({
            "id": unit.id,
            "name": unit.name,
            "area": unit.area,
            "rent": unit.rent,
            "residents": residents.get(unit.id, []),
            "bill": this_month.get(unit.id),   # null when the unit hasn't been billed this month
            "owed": money(o.get("total")),
            "owed_overdue": money(o.get("overdue")),
            "unpaid_bills": o.get("bills", 0),
            "open_complaints": complaints.get(unit.id, 0),
        })
    # Floors without units still show, so the shape of the building is right
    numbers = {f["number"] for f in floors}
    for floor in building.floors.all():
        if floor.number not in numbers:
            floors.append({"number": floor.number, "units": []})
    floors.sort(key=lambda f: -f["number"])
    return {"period": MonthField().to_representation(month), "floors": floors}

class DashboardView(APIView):
    """GET: everything the secretary's overview needs in one request."""
    permission_classes=[IsSecretary]

    def get(self, request):
        building = request.user.buildings.first()
        if building is None:
            return Response({"detail": "You have not set up a building yet."}, status=404)
        today = timezone.localdate()
        month = today.replace(day=1)
        now = timezone.now()

        units = Unit.objects.filter(floor__building=building)
        bills = Bill.objects.filter(unit__floor__building=building)
        sent = bills.filter(sent_at__isnull=False)

        # ---- this month's collection (sent bills only)
        month_bills = bills.filter(period=month)
        month_sent = sent.filter(period=month)
        overdue = sent.filter(status=Bill.Status.UNPAID, due_date__lt=today)
        collection = {
            "period": MonthField().to_representation(month),
            "billed": item_total(month_sent),
            "collected": paid_total(month_sent),
            "outstanding": str((Decimal(item_total(month_sent)) - Decimal(paid_total(month_sent))).quantize(Decimal("0.01"))),
            "sent_bills": month_sent.count(),
            "paid_bills": month_sent.filter(status=Bill.Status.PAID).count(),
            "drafts": month_bills.filter(sent_at__isnull=True).count(),
            "unbilled_units": units.exclude(bills__period=month).count(),
            "overdue_bills": overdue.count(),
            "overdue_total": str((Decimal(item_total(overdue)) - Decimal(paid_total(overdue))).quantize(Decimal("0.01"))),
            "oldest_overdue_days": (today - overdue.order_by("due_date").first().due_date).days if overdue.exists() else 0,
            "due_date": most_common_due_date(month_sent),
            "last_month": same_point_last_month(sent, month, now),
        }

        # ---- complaints
        unresolved = Complaint.objects.filter(building=building).exclude(status=Complaint.Status.RESOLVED)
        oldest = unresolved.order_by("created_at").first()
        recent_resolved = Complaint.objects.filter(
            building=building, status=Complaint.Status.RESOLVED,
            resolved_at__isnull=False, resolved_at__gte=now - timedelta(days=90),
        )
        durations = [(c.resolved_at - c.created_at).total_seconds() / 86400 for c in recent_resolved]
        complaints = {
            "open": unresolved.count(),
            "resolved_last_30_days": Complaint.objects.filter(
                building=building, status=Complaint.Status.RESOLVED, resolved_at__gte=now - timedelta(days=30)
            ).count(),
            "oldest": {"id": oldest.id, "title": oldest.title, "days": (now - oldest.created_at).days} if oldest else None,
            "typical_days_to_resolve": round(sorted(durations)[len(durations) // 2], 1) if durations else None,
        }

        # ---- gate
        inside = EntryLog.objects.filter(building=building, check_out__isnull=True)
        gate = {
            "inside_now": inside.count(),
            "entries_today": EntryLog.objects.filter(building=building, check_in__date=today).count(),
            "long_stays": inside.filter(check_in__lt=now - timedelta(hours=LONG_STAY_HOURS)).count(),
        }

        # ---- occupancy
        occupied = units.filter(residents__isnull=False).distinct()
        vacant = units.exclude(pk__in=occupied).select_related("floor").order_by("floor__number", "name")
        residents = building.members.filter(role=User.Role.RESIDENT)
        occupancy = {
            "units": units.count(),
            "occupied": occupied.count(),
            "vacant": [{"id": u.id, "name": u.name, "floor": u.floor.number} for u in vacant[:30]],
            "vacant_count": vacant.count(),
            "residents_without_unit": residents.exclude(resident_profile__unit__isnull=False).count(),
        }

        notices = building.notices.order_by("-created_at")[:3]
        return Response({
            "map": building_map(building, month, today),
            "building": {
                "id": building.id, "name": building.name, "floors": building.total_floors,
                "residents": residents.count(), "guards": building.members.filter(role=User.Role.GUARD).count(),
            },
            "collection": collection,
            "complaints": complaints,
            "gate": gate,
            "occupancy": occupancy,
            "notices": [{"id": n.id, "title": n.title, "message": n.message[:140], "created_at": n.created_at} for n in notices],
        })

# ---------------------------------------------------------------- Payments

def check_password(request):
    """Changing payment details needs the secretary's password again: a swapped QR would
    send a month of residents' money to someone else."""
    if not request.user.check_password(request.data.get("password", "")):
        raise ValidationError({"password": ["Your password is not correct."]})

def log_payment_change(building, user, summary):
    PaymentDetailsChange.objects.create(building=building, changed_by=user, summary=summary)
    building.payment_details_changed_at = timezone.now()
    building.save(update_fields=["payment_details_changed_at"])

class PaymentMethodsView(APIView):
    """GET the building's payment options (active first); POST adds one (needs `password`)."""
    permission_classes=[IsSecretary]

    def get(self, request):
        building = request.user.buildings.first()
        if building is None:
            return Response({"detail": "You have not set up a building yet."}, status=404)
        methods = building.payment_methods.filter(is_active=True)
        return Response({
            "methods": PaymentMethodSerializer(methods, many=True, context={"request": request}).data,
            "changed_at": building.payment_details_changed_at,
            "log": PaymentDetailsChangeSerializer(building.payment_details_changes.select_related("changed_by")[:20], many=True).data,
        })

    @transaction.atomic
    def post(self, request):
        building = request.user.buildings.first()
        if building is None:
            return Response({"detail": "You have not set up a building yet."}, status=404)
        check_password(request)
        serializer = PaymentMethodSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        method = serializer.save(building=building)
        log_payment_change(building, request.user, f"Added \"{method.label}\" ({method.get_kind_display()}, {method.account_name})")
        return Response(PaymentMethodSerializer(method, context={"request": request}).data, status=201)

class PaymentMethodDetailView(APIView):
    """PATCH or DELETE one payment option; both need `password`. Deleting hides it (kept for history)."""
    permission_classes=[IsSecretary]

    def get_method(self, request, pk):
        return PaymentMethod.objects.filter(pk=pk, building__secretary=request.user, is_active=True).first()

    @transaction.atomic
    def patch(self, request, pk):
        method = self.get_method(request, pk)
        if method is None:
            return Response({"detail": "Payment option not found."}, status=404)
        check_password(request)
        old_qr = method.qr.name if method.qr else ""
        serializer = PaymentMethodSerializer(method, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        method = serializer.save()
        changes = []
        if method.qr and method.qr.name != old_qr:
            changes.append("new QR code")
        if any(f in request.data for f in ("account_name", "account_number", "bank_name", "branch")):
            changes.append("account details")
        if "label" in request.data or "kind" in request.data:
            changes.append("name")
        log_payment_change(method.building, request.user, f"Changed \"{method.label}\": {', '.join(changes) or 'details'}")
        return Response(PaymentMethodSerializer(method, context={"request": request}).data)

    @transaction.atomic
    def delete(self, request, pk):
        method = self.get_method(request, pk)
        if method is None:
            return Response({"detail": "Payment option not found."}, status=404)
        check_password(request)
        method.is_active = False
        method.save(update_fields=["is_active"])
        log_payment_change(method.building, request.user, f"Removed \"{method.label}\"")
        return Response(status=204)

def payments_queryset():
    return Payment.objects.select_related(
        "bill__unit__floor", "payment_method", "submitted_by", "decided_by"
    ).prefetch_related("bill__items")

class SecretaryPaymentsView(generics.ListAPIView):
    """Payments in the secretary's building. ?status=pending|confirmed|rejected (pending = to check)."""
    serializer_class=PaymentSerializer
    permission_classes=[IsSecretary]
    pagination_class=None

    def get_queryset(self):
        payments = payments_queryset().filter(bill__unit__floor__building__secretary=self.request.user)
        status = self.request.query_params.get("status")
        if status in Payment.Status.values:
            payments = payments.filter(status=status)
        return payments.order_by("created_at" if status == "pending" else "-created_at")[:300]

class RecordPaymentView(APIView):
    """POST: the secretary records a payment they received (e.g. cash). Confirmed straight away."""
    permission_classes=[IsSecretary]

    def post(self, request, pk):
        bill = bills_queryset().filter(pk=pk, unit__floor__building__secretary=request.user).first()
        if bill is None:
            return Response({"detail": "Bill not found."}, status=404)
        building = bill.unit.floor.building
        serializer = NewPaymentSerializer(data=request.data, context={"bill": bill, "building": building, "by_resident": False})
        serializer.is_valid(raise_exception=True)
        payment = Payment.objects.create(bill=bill, submitted_by=request.user, **serializer.validated_data)
        payment.confirm(request.user)
        return Response(PaymentSerializer(payments_queryset().get(pk=payment.pk), context={"request": request}).data, status=201)

class DecidePaymentView(APIView):
    """POST .../confirm/ or .../reject/ {reason}: the secretary checks a payment.
    Rejecting a confirmed payment reverses it (its receipt is cancelled)."""
    permission_classes=[IsSecretary]
    action = None

    def post(self, request, pk):
        payment = Payment.objects.filter(pk=pk, bill__unit__floor__building__secretary=request.user).first()
        if payment is None:
            return Response({"detail": "Payment not found."}, status=404)
        if self.action == "confirm":
            if payment.status != Payment.Status.PENDING:
                return Response({"detail": "Only payments waiting for confirmation can be confirmed."}, status=400)
            bill = bills_queryset().get(pk=payment.bill_id)
            if payment.amount > bill.balance:
                return Response({"detail": f"This would pay more than is left on the bill (Rs. {bill.balance:,.2f})."}, status=400)
            payment.confirm(request.user)
        else:
            reason = (request.data.get("reason") or "").strip()
            if not reason:
                return Response({"reason": ["Tell the resident why, e.g. \"No payment with this ID reached the account\"."]}, status=400)
            if payment.status == Payment.Status.REJECTED:
                return Response({"detail": "This payment was already rejected."}, status=400)
            payment.reject(request.user, reason)
        return Response(PaymentSerializer(payments_queryset().get(pk=payment.pk), context={"request": request}).data)

class MyPaymentMethodsView(APIView):
    """GET: how residents can pay their building (active options only)."""
    permission_classes=[IsResident]

    def get(self, request):
        building = request.user.building
        if building is None:
            return Response({"detail": "Join a building first."}, status=404)
        methods = building.payment_methods.filter(is_active=True)
        return Response({
            "methods": PaymentMethodSerializer(methods, many=True, context={"request": request}).data,
            "changed_at": building.payment_details_changed_at,
        })

class ReportPaymentView(APIView):
    """POST (multipart): a resident says "I've paid" on one of their bills. Pending until the secretary confirms."""
    permission_classes=[IsResident]

    def post(self, request, pk):
        bill = bills_queryset().filter(pk=pk, billed_residents=request.user, sent_at__isnull=False).first()
        if bill is None:
            return Response({"detail": "Bill not found."}, status=404)
        if bill.status == Bill.Status.PAID:
            return Response({"detail": "This bill is already paid."}, status=400)
        serializer = NewPaymentSerializer(data=request.data, context={"bill": bill, "building": request.user.building, "by_resident": True})
        serializer.is_valid(raise_exception=True)
        payment = Payment.objects.create(bill=bill, submitted_by=request.user, status=Payment.Status.PENDING, **serializer.validated_data)
        return Response(PaymentSerializer(payments_queryset().get(pk=payment.pk), context={"request": request}).data, status=201)

class ReceiptView(APIView):
    """GET: a payment's receipt, for the secretary or the residents the bill was sent to.
    Reversed payments still show, marked as cancelled."""

    def get(self, request, pk):
        payment = payments_queryset().select_related("bill__unit__floor__building").filter(pk=pk).exclude(receipt_no="").first()
        allowed = payment is not None and (
            (request.user.role == "secretary" and payment.bill.unit.floor.building.secretary_id == request.user.id)
            or (request.user.role == "resident" and payment.bill.billed_residents.filter(pk=request.user.pk).exists())
        )
        if not allowed:
            return Response({"detail": "Receipt not found."}, status=404)
        bill = payment.bill
        building = bill.unit.floor.building
        payers = [person(u) for u in bill.billed_residents.all()] or [person(payment.submitted_by)]
        return Response({
            "receipt_no": payment.receipt_no,
            "cancelled": payment.status == Payment.Status.REJECTED,
            "cancel_reason": payment.reject_reason if payment.status == Payment.Status.REJECTED else "",
            "building": {"name": building.name, "description": building.description.split("\n")[0]},
            "received_from": ", ".join(payers),
            "unit": {"name": bill.unit.name, "floor": bill.unit.floor.number},
            "period": bill.period.strftime("%Y-%m"),
            "items": [{"title": i.title, "amount": str(i.amount)} for i in bill.items.all()],
            "bill_total": str(bill.amount_total),
            "amount": str(payment.amount),
            "paid_on": payment.paid_on,
            "kind": payment.get_kind_display(),
            "reference": payment.reference,
            "received_by": person(payment.decided_by),
            "confirmed_at": payment.decided_at,
            "balance_after": str(bill.balance),
        })

def person(user):
    return (user.full_name or user.username) if user else None

class JoinBuildingView(APIView):
    permission_classes=[IsResidentOrGuard]

    def post(self, request):
        serializer = JoinBuildingSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        building = serializer.building
        request.user.building = building
        request.user.save(update_fields=["building"])
        return Response({"building": {"id": building.id, "name": building.name}})




# Create your views here.
