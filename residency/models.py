from django.db import models,transaction,IntegrityError
from django.core.validators import MinValueValidator
from django.conf import settings    
from django.utils import timezone
from datetime import timedelta
from decimal import Decimal

REMIND_DAYS_BEFORE=3   # "due soon" reminder, days before the due date
from accounts.utils import generate_join_code
import os
from django.core.exceptions import ValidationError
from PIL import Image

NOTICE_IMAGE_TYPES={".jpg",".jpeg",".png",".gif",".webp"}
MAX_NOTICE_ATTACHMENT=10*1024*1024   # 10 MB

def validate_notice_attachment(file):
    """Accept only real images or real PDFs, checked by content, not just the name."""
    ext=os.path.splitext(file.name)[1].lower()
    if ext != ".pdf" and ext not in NOTICE_IMAGE_TYPES:
        raise ValidationError("Attach an image (JPG, PNG, GIF, WebP) or a PDF.")
    if file.size > MAX_NOTICE_ATTACHMENT:
        raise ValidationError("The file is too big. The limit is 10 MB.")
    file.seek(0)
    try:
        if ext == ".pdf":
            if not file.read(5).startswith(b"%PDF-"):
                raise ValidationError("This file isn't a valid PDF.")
        else:
            try:
                Image.open(file).verify()
            except Exception:
                raise ValidationError("This file isn't a valid image.")
    finally:
        file.seek(0)

class Building(models.Model):
    name=models.CharField()
    description=models.TextField(default="")
    total_floors=models.PositiveIntegerField(
        validators=[MinValueValidator(1)]
    )
    secretary=models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="buildings",
        limit_choices_to={"role": "secretary"}
    )
    join_code=models.CharField(unique=True,editable=False)
    code_active=models.BooleanField(default=True)
    created_at=models.DateTimeField(auto_now_add=True)
    # Residents are warned when this is recent (a swapped QR is the main fraud risk)
    payment_details_changed_at=models.DateTimeField(null=True,blank=True)
    # Last receipt number used; receipts are numbered per building
    receipt_counter=models.PositiveIntegerField(default=0)

    @property
    def code(self):
        """Short letters for receipt numbers and payment remarks, e.g. "HH" for Himalaya Heights."""
        letters="".join(word[0] for word in self.name.split() if word[:1].isalpha()).upper()
        return (letters or "GR")[:3]

    def save(self, *args, **kwargs):
        is_new = self.pk is None

        with transaction.atomic():
            if is_new and not self.join_code:
                self._insert_with_unique_code(*args, **kwargs)
            else:
                super().save(*args, **kwargs)

            if is_new:
                Floor.objects.bulk_create(
                    [Floor(building=self, number=n) for n in range(1, self.total_floors + 1)]
                )

    def _insert_with_unique_code(self, *args, **kwargs):
        # Retry only if the generated code collides with an existing one
        for _ in range(10):
            self.join_code = generate_join_code()
            try:
                with transaction.atomic():
                    super().save(*args, **kwargs)
                return
            except IntegrityError:
                self.join_code = ""
        raise RuntimeError("Could not generate a unique join code.")

    def regenerate_join_code(self):
        # Old code stops working at once; people who already joined stay joined
        for _ in range(10):
            code = generate_join_code()
            if not Building.objects.filter(join_code=code).exists():
                self.join_code = code
                self.save(update_fields=["join_code"])
                return code
        raise RuntimeError("Could not generate a unique join code.")

        
    def __str__(self):
        return self.name

        
class Floor(models.Model):
    building=models.ForeignKey(
        Building,
        on_delete=models.CASCADE,
        related_name="floors"
        )    
    number=models.PositiveIntegerField()

    class Meta:
        ordering=["number"]
        constraints=[
            models.UniqueConstraint(fields=["building","number"],name="unique_floor_number_per_building")
        ]

    def __str__(self):
        return f"{self.building.name},floor{self.number}"

class Unit(models.Model):
    floor=models.ForeignKey(
        Floor,
        on_delete=models.CASCADE,
        related_name="units"
    )
    name=models.CharField(max_length=20)
    area=models.PositiveIntegerField()
    rent=models.PositiveIntegerField()

    class Meta:
        ordering=["floor__number","name"]
        constraints=[
            models.UniqueConstraint(fields=["floor","name"],name="unique_unit_name_per_floor")
        ]

    @property
    def formatted_area(self):
        if self.area:
            return f"{self.area } sq.ft"

    def __str__(self):
        return f"{self.floor.number} {self.name}"


    

class BuildingImage(models.Model):
    building=models.ForeignKey(
        Building,
        on_delete=models.CASCADE,
        related_name="images"
    )
    photo=models.ImageField(upload_to="buildings/")
   

    def __str__(self):
        return f"{self.building.name} images"


    

class UnitImage(models.Model):
    unit=models.ForeignKey(
        Unit,
        on_delete=models.CASCADE,
        related_name="images"
    )
    photo=models.ImageField(upload_to="units/")

    def __str__(self):
        return f"{self.unit.name} photos"

class Notice(models.Model):
    building=models.ForeignKey(
        Building,
        on_delete=models.CASCADE,
        related_name="notices"

    )
    title=models.CharField(max_length=150,default="")
    message=models.TextField()
    # An image or a PDF, e.g. a photo of the damage or the meeting agenda
    attachment=models.FileField(
        upload_to="notices/",
        blank=True,
        validators=[validate_notice_attachment]
    )

    @property
    def attachment_type(self):
        if not self.attachment:
            return None
        return "pdf" if self.attachment.name.lower().endswith(".pdf") else "image"
    posted_by=models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notices_posted"
    )
    created_at=models.DateTimeField(auto_now_add=True)
    updated_at=models.DateTimeField(auto_now=True)

    class Meta:
        ordering=["-created_at"]

    def __str__(self):
        return f"{self.building.name}: {self.title or self.message[:40]}"

    
class ResidentProfile(models.Model):
    # Name, phone and building already live on User; this only adds the unit
    user=models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="resident_profile",
        limit_choices_to={"role":"resident"}
    )
    # Empty until the secretary assigns the resident to a unit
    unit=models.ForeignKey(
        Unit,
        on_delete=models.SET_NULL,
        related_name="residents",
        null=True,
        blank=True
    )
    moved_in=models.DateField(null=True,blank=True)

    def __str__(self):
        return f"{self.user} - {self.unit or 'no unit'}"

class Bill(models.Model):
    class Status(models.TextChoices):
        UNPAID = "unpaid", "Unpaid"
        PAID = "paid", "Paid"

    unit=models.ForeignKey(
        Unit,
        on_delete=models.CASCADE,
        related_name="bills"
        )
    # Store the first day of the month this bill covers, e.g. 2026-10-01
    period=models.DateField()
    due_date=models.DateField()
    status=models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.UNPAID
    )
    paid_at=models.DateTimeField(null=True,blank=True)
    note=models.TextField(blank=True)
    # Empty while the bill is a draft that only the secretary can see
    sent_at=models.DateTimeField(null=True,blank=True)
    # Last time a sent bill's charges, due date or note changed (residents see it as updated)
    changed_at=models.DateTimeField(null=True,blank=True)
    # The residents living in the unit when the bill was sent: they owe it, even after moving out
    billed_residents=models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="bills_received"
    )
    created_by=models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="bills_created",
        limit_choices_to={"role":"secretary"}
    )
    created_at=models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering=["-period"]
        constraints=[
            models.UniqueConstraint(fields=["unit","period"],name="one_bill_per_unit_per_period")
        ]

    @property
    def total(self):
        return self.items.aggregate(total=models.Sum("amount"))["total"] or 0

    @property
    def is_draft(self):
        return self.sent_at is None

    @property
    def days_overdue(self):
        """How many days past the due date an unpaid, sent bill is (0 if it isn't overdue)."""
        if self.is_draft or self.status != self.Status.UNPAID:
            return 0
        return max(0, (timezone.localdate() - self.due_date).days)

    @property
    def is_overdue(self):
        return self.days_overdue > 0

    @property
    def days_until_due(self):
        """Days left before the due date for an unpaid, sent bill (None if paid, a draft or overdue)."""
        if self.is_draft or self.status != self.Status.UNPAID or self.is_overdue:
            return None
        return (self.due_date - timezone.localdate()).days

    def reminder_dates(self, today=None):
        """Days this bill nudges its residents: 3 days before it's due, the day it becomes
        overdue, then every week while it stays unpaid. Only dates up to today."""
        if self.is_draft or self.status != self.Status.UNPAID:
            return []
        today = today or timezone.localdate()
        dates = [self.due_date - timedelta(days=REMIND_DAYS_BEFORE)]
        overdue_day = self.due_date + timedelta(days=1)
        while overdue_day <= today:
            dates.append(overdue_day)
            overdue_day += timedelta(days=7)
        return [d for d in dates if d <= today]

    @property
    def amount_total(self):
        return sum((i.amount for i in self.items.all()), Decimal(0))

    @property
    def amount_paid(self):
        """Confirmed payments only (uses prefetched payments)."""
        return sum((p.amount for p in self.payments.all() if p.status == Payment.Status.CONFIRMED), Decimal(0))

    @property
    def amount_pending(self):
        """Payments residents reported that the secretary hasn't confirmed yet."""
        return sum((p.amount for p in self.payments.all() if p.status == Payment.Status.PENDING), Decimal(0))

    @property
    def balance(self):
        return max(Decimal(0), self.amount_total - self.amount_paid)

    @property
    def remark_code(self):
        """What residents type in the bank app's remarks so the payment is easy to match, e.g. HH-3B-OCT."""
        return f"{self.unit.floor.building.code}-{self.unit.name}-{self.period:%b}".upper()

    def refresh_status(self):
        """Paid once confirmed payments cover the total; unpaid (possibly partly paid) otherwise."""
        payments = list(self.payments.filter(status=Payment.Status.CONFIRMED).order_by("decided_at"))
        paid = sum((p.amount for p in payments), Decimal(0))
        total = BillItem.objects.filter(bill=self).aggregate(t=models.Sum("amount"))["t"] or Decimal(0)
        if total > 0 and paid >= total:
            self.status = self.Status.PAID
            self.paid_at = payments[-1].decided_at if payments else timezone.now()
        else:
            self.status = self.Status.UNPAID
            self.paid_at = None
        self.save(update_fields=["status", "paid_at"])
        if self.status == self.Status.PAID and self.sent_at is None:
            self.send()   # a paid bill is never a draft

    def send(self, when=None):
        """Show the bill to the residents now living in its unit. Does nothing if already sent."""
        if self.sent_at is not None:
            return False
        self.sent_at = when or timezone.now()
        self.save(update_fields=["sent_at"])
        self.billed_residents.set(unit_residents(self.unit))
        return True

    def __str__(self):
        return f"{self.unit} - {self.period:%B %Y}"


def unit_residents(unit):
    """Residents of the building whose unit is this one right now."""
    from django.contrib.auth import get_user_model
    return get_user_model().objects.filter(
        role="resident", resident_profile__unit=unit, building_id=unit.floor.building_id
    )


def attach_to_open_bills(user, unit):
    """A resident moving into a unit takes over its unpaid bills that were sent while
    nobody was recorded there (e.g. residents who join the app after billing started)."""
    for bill in Bill.objects.filter(unit=unit, sent_at__isnull=False, status=Bill.Status.UNPAID,
                                    billed_residents__isnull=True):
        bill.billed_residents.add(user)


class BillItem(models.Model):
    bill=models.ForeignKey(
        Bill,
        on_delete=models.CASCADE,
        related_name="items"
    )
    title=models.CharField(max_length=100)
    amount=models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(0)]
    )

    class Meta:
        ordering=["id"]   # the order they were added, so rent stays first

    def __str__(self):
        return f"{self.title}: {self.amount}"


class Complaint(models.Model):
    class Status(models.TextChoices):
        # A complaint is open until the secretary replies; replying resolves it
        OPEN = "open", "Open"
        RESOLVED = "resolved", "Resolved"

    building=models.ForeignKey(
        Building,
        on_delete=models.CASCADE,
        related_name="complaints"
    )
    # Empty for problems in common areas (lift, parking, stairs)
    unit=models.ForeignKey(
        Unit,
        on_delete=models.SET_NULL,
        related_name="complaints",
        null=True,
        blank=True
    )
    raised_by=models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="complaints"
    )
    # Still saved so the resident can track their own complaint, but the API
    # must hide raised_by (and unit) from the secretary when this is on
    is_anonymous=models.BooleanField(default=False)
    title=models.CharField(max_length=100)
    description=models.TextField(blank=True)
    photo=models.ImageField(upload_to="complaints/",blank=True)
    status=models.CharField(
        max_length=15,
        choices=Status.choices,
        default=Status.OPEN
    )
    # Secretary's reply, e.g. "Plumber coming on Monday"
    response=models.TextField(blank=True)
    created_at=models.DateTimeField(auto_now_add=True)
    resolved_at=models.DateTimeField(null=True,blank=True)
    # When the secretary last changed the status or reply (drives the resident's unread badge)
    last_update_at=models.DateTimeField(null=True,blank=True)

    class Meta:
        ordering=["-created_at"]

    def __str__(self):
        return f"{self.title} ({self.get_status_display()})"


class EntryLog(models.Model):
    class EntryType(models.TextChoices):
        VISITOR = "visitor", "Visitor"
        WORKER = "worker", "Worker"
        DELIVERY = "delivery", "Delivery"

    building=models.ForeignKey(
        Building,
        on_delete=models.CASCADE,
        related_name="entries"
    )
    entry_type=models.CharField(max_length=10,choices=EntryType.choices)
    name=models.CharField(max_length=100)
    phone=models.CharField(max_length=20,blank=True)
    # Unit being visited; empty for building work in common areas
    unit=models.ForeignKey(
        Unit,
        on_delete=models.SET_NULL,
        related_name="entries",
        null=True,
        blank=True
    )
    purpose=models.CharField(max_length=200,blank=True)
    vehicle_no=models.CharField(max_length=20,blank=True)
    check_in=models.DateTimeField(auto_now_add=True)
    # Empty while the person is still inside
    check_out=models.DateTimeField(null=True,blank=True)
    logged_by=models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="entries_logged",
        limit_choices_to={"role":"guard"}
    )
    # The guard on duty when they left (may differ from the one who let them in)
    checked_out_by=models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="entries_checked_out",
        limit_choices_to={"role":"guard"}
    )

    class Meta:
        ordering=["-check_in"]

    @property
    def is_inside(self):
        return self.check_out is None

    def __str__(self):
        return f"{self.name} ({self.get_entry_type_display()}) {self.check_in:%Y-%m-%d %H:%M}"


class LastSeen(models.Model):
    """When a user last opened a section of the app, e.g. "notices".
    Anything newer than this shows as unread (the red badge in the sidebar)."""
    user=models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="last_seen"
    )
    section=models.CharField(max_length=30)
    seen_at=models.DateTimeField()

    class Meta:
        constraints=[
            models.UniqueConstraint(fields=["user","section"],name="one_last_seen_per_section")
        ]

    def __str__(self):
        return f"{self.user} saw {self.section} at {self.seen_at:%Y-%m-%d %H:%M}"


# ---------- Payments ----------

PAYMENT_KINDS = [
    ("bank", "Bank transfer"),
    ("esewa", "eSewa"),
    ("khalti", "Khalti"),
    ("fonepay", "Fonepay QR"),
    ("cash", "Cash"),
    ("cheque", "Cheque"),
    ("other", "Other"),
]


class PaymentMethod(models.Model):
    """A way to pay the building, set up by the secretary: a QR code and/or account details.
    Shown to the building's residents on their bills."""
    building=models.ForeignKey(Building,on_delete=models.CASCADE,related_name="payment_methods")
    kind=models.CharField(max_length=10,choices=PAYMENT_KINDS[:4])
    label=models.CharField(max_length=60)                  # e.g. "Scan with any bank app"
    account_name=models.CharField(max_length=100)          # whose account the money goes to
    account_number=models.CharField(max_length=40,blank=True)
    bank_name=models.CharField(max_length=80,blank=True)
    branch=models.CharField(max_length=80,blank=True)
    qr=models.ImageField(upload_to="payment-qr/",blank=True)
    is_active=models.BooleanField(default=True)            # removed methods stay for history
    created_at=models.DateTimeField(auto_now_add=True)
    updated_at=models.DateTimeField(auto_now=True)

    class Meta:
        ordering=["created_at"]

    def __str__(self):
        return f"{self.building.name}: {self.label}"


class PaymentDetailsChange(models.Model):
    """Every change to a building's payment details, for the log residents and the secretary can see."""
    building=models.ForeignKey(Building,on_delete=models.CASCADE,related_name="payment_details_changes")
    changed_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.SET_NULL,null=True)
    summary=models.CharField(max_length=200)
    created_at=models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering=["-created_at"]


class Payment(models.Model):
    """Money paid towards a bill. Residents report payments (pending until the secretary checks them);
    the secretary can also record payments directly (confirmed straight away)."""
    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for confirmation"
        CONFIRMED = "confirmed", "Confirmed"
        REJECTED = "rejected", "Rejected"

    bill=models.ForeignKey(Bill,on_delete=models.CASCADE,related_name="payments")
    amount=models.DecimalField(max_digits=10,decimal_places=2,validators=[MinValueValidator(Decimal("0.01"))])
    kind=models.CharField(max_length=10,choices=PAYMENT_KINDS)
    payment_method=models.ForeignKey(PaymentMethod,on_delete=models.SET_NULL,null=True,blank=True,related_name="payments")
    reference=models.CharField(max_length=80,blank=True)   # transaction ID, cheque number...
    paid_on=models.DateField()
    proof=models.ImageField(upload_to="payment-proof/",blank=True)
    note=models.CharField(max_length=200,blank=True)
    status=models.CharField(max_length=10,choices=Status.choices,default=Status.PENDING)
    reject_reason=models.CharField(max_length=200,blank=True)
    submitted_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.SET_NULL,null=True,related_name="payments_submitted")
    decided_by=models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.SET_NULL,null=True,blank=True,related_name="payments_decided")
    decided_at=models.DateTimeField(null=True,blank=True)
    receipt_no=models.CharField(max_length=30,blank=True)  # given when confirmed; kept if later reversed
    created_at=models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering=["-created_at"]

    def __str__(self):
        return f"{self.bill} - Rs. {self.amount} ({self.status})"

    def confirm(self, by):
        """Accept the payment: give it the building's next receipt number and update the bill."""
        with transaction.atomic():
            building = Building.objects.select_for_update().get(pk=self.bill.unit.floor.building_id)
            building.receipt_counter += 1
            building.save(update_fields=["receipt_counter"])
            self.status = self.Status.CONFIRMED
            self.decided_by = by
            self.decided_at = timezone.now()
            self.reject_reason = ""
            self.receipt_no = f"{building.code}-{self.decided_at:%Y}-{building.receipt_counter:04d}"
            self.save(update_fields=["status", "decided_by", "decided_at", "reject_reason", "receipt_no"])
            self.bill.refresh_status()

    def reject(self, by, reason):
        """Turn down a reported payment, or reverse a confirmed one (its receipt becomes cancelled)."""
        with transaction.atomic():
            self.status = self.Status.REJECTED
            self.decided_by = by
            self.decided_at = timezone.now()
            self.reject_reason = reason
            self.save(update_fields=["status", "decided_by", "decided_at", "reject_reason"])
            self.bill.refresh_status()
