"""
Fill the database with a complete demo building to see the app "in its final form".

    python manage.py seed_demo            # create (or re-create) the demo building
    python manage.py seed_demo --remove   # delete the demo building, its users and their files

Everything it creates belongs to the building "Himalaya Heights" and to users whose
username starts with "demo_", so it never touches real data. All demo users share
one password, printed at the end.
"""
import io
import random
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.hashers import make_password
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from PIL import Image, ImageDraw

from accounts.models import User
from residency.models import (
    Bill, BillItem, Building, BuildingImage, Complaint, EntryLog, Notice, Payment, PaymentMethod,
    ResidentProfile, Unit, UnitImage,
)

BUILDING_NAME = "Himalaya Heights"
PREFIX = "demo_"
PASSWORD = "Demo-pass-2026"

FIRST = ["Aarav", "Sita", "Ram", "Gita", "Bikash", "Pooja", "Suman", "Rita", "Anil", "Maya", "Prakash", "Sunita",
         "Rajesh", "Nisha", "Kiran", "Asha", "Deepak", "Sarita", "Manoj", "Kabita", "Sanjay", "Laxmi", "Nabin",
         "Anita", "Rohan", "Puja", "Bijay", "Srijana", "Dipesh", "Menuka", "Hari", "Radha", "Sagar", "Bina",
         "Arjun", "Sabina", "Ujjwal", "Rekha", "Niraj", "Kopila", "Tenzing", "Pema"]
LAST = ["Shrestha", "Gurung", "Thapa", "Rai", "Tamang", "Magar", "Karki", "Adhikari", "Sharma", "Joshi",
        "Basnet", "Lama", "KC", "Poudel", "Maharjan", "Bhattarai", "Khadka", "Sherpa", "Pandey", "Dahal"]


# ------------------------------------------------------------------ generated pictures

def jpeg(img, name):
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=84)
    return ContentFile(buf.getvalue(), name=name)


def shade(color, k):
    return tuple(max(0, min(255, int(c * k))) for c in color)


def facade(rng, name):
    """A daytime building facade: sky, a block of floors with windows, a street."""
    w, h = 1200, 800
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    sky_top, sky_bottom = (150, 186, 214), (226, 232, 236)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(sky_top, sky_bottom)))
    # distant hills
    d.polygon([(0, 520), (260, 400), (520, 500), (820, 380), (1200, 470), (1200, 800), (0, 800)], fill=(168, 182, 176))
    wall = rng.choice([(222, 214, 198), (205, 196, 184), (214, 205, 190), (196, 186, 170)])
    x0, x1, top = 300, 900, 140
    d.rectangle([x0, top, x1, 690], fill=wall)
    d.rectangle([x0 - 12, top - 14, x1 + 12, top], fill=shade(wall, 0.72))
    rows, cols = 8, 6
    for r in range(rows):
        for c in range(cols):
            wx = x0 + 34 + c * 92
            wy = top + 26 + r * 64
            lit = rng.random() < 0.18
            glass = (244, 222, 160) if lit else rng.choice([(118, 140, 158), (104, 126, 146), (132, 152, 168)])
            d.rectangle([wx, wy, wx + 56, wy + 36], fill=shade(wall, 0.62))
            d.rectangle([wx + 3, wy + 3, wx + 53, wy + 33], fill=glass)
            if r % 2 == 0:
                d.rectangle([wx - 4, wy + 38, wx + 60, wy + 42], fill=shade(wall, 0.8))   # balcony ledge
    d.rectangle([560, 610, 640, 690], fill=(92, 74, 60))     # entrance
    d.rectangle([0, 690, w, h], fill=(120, 118, 112))       # street
    d.rectangle([0, 686, w, 694], fill=(150, 148, 140))
    for tx in (180, 1010):                                   # trees
        d.rectangle([tx - 6, 600, tx + 6, 690], fill=(98, 76, 56))
        d.ellipse([tx - 60, 500, tx + 60, 620], fill=rng.choice([(96, 132, 88), (84, 120, 80)]))
    return jpeg(img, name)


def room(rng, name):
    """A simple flat-style interior: wall, floor, window with view, furniture."""
    w, h = 1000, 700
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    wall = rng.choice([(236, 228, 214), (224, 230, 226), (232, 222, 210), (226, 224, 232), (240, 234, 222)])
    floor = rng.choice([(176, 136, 98), (160, 122, 88), (190, 160, 128), (150, 140, 130)])
    d.rectangle([0, 0, w, 470], fill=wall)
    for y in range(470, h):
        d.line([(0, y), (w, y)], fill=shade(floor, 0.88 + 0.18 * (y - 470) / (h - 470)))
    for x in range(0, w, 110):                              # floor boards
        d.line([(x, 470), (x - 60, h)], fill=shade(floor, 0.8), width=2)
    wx = rng.choice([120, 520])
    d.rectangle([wx, 90, wx + 330, 330], fill=shade(wall, 0.8))
    for y in range(98, 322):
        t = (y - 98) / 224
        d.line([(wx + 8, y), (wx + 322, y)], fill=(int(150 + 70 * t), int(190 + 40 * t), int(220 + 20 * t)))
    d.polygon([(wx + 8, 300), (wx + 120, 230), (wx + 220, 280), (wx + 322, 220), (wx + 322, 322), (wx + 8, 322)],
              fill=(150, 168, 160))
    d.line([(wx + 165, 98), (wx + 165, 322)], fill=shade(wall, 0.8), width=6)
    sofa = rng.choice([(96, 112, 128), (138, 98, 82), (110, 126, 104), (150, 140, 120)])
    sx = 560 if wx == 120 else 100
    d.rounded_rectangle([sx, 380, sx + 330, 500], radius=18, fill=sofa)
    d.rounded_rectangle([sx + 10, 330, sx + 320, 400], radius=16, fill=shade(sofa, 1.1))
    d.rectangle([sx + 120, 520, sx + 230, 560], fill=shade(floor, 0.6))     # low table
    d.ellipse([sx - 70, 250, sx - 20, 300], fill=(240, 220, 170))            # lamp
    d.rectangle([sx - 47, 300, sx - 43, 480], fill=(90, 90, 90))
    d.ellipse([wx + 380 if wx == 120 else wx - 120, 380, wx + 440 if wx == 120 else wx - 60, 470], fill=(88, 128, 86))  # plant
    return jpeg(img, name)


def leak_photo(rng, name):
    img = room(rng, "tmp.jpg")
    pic = Image.open(io.BytesIO(img.read()))
    d = ImageDraw.Draw(pic)
    d.ellipse([380, 40, 640, 160], fill=(196, 186, 160))     # damp patch on the ceiling
    d.ellipse([430, 60, 600, 140], fill=(172, 160, 132))
    return jpeg(pic, name)


def demo_qr(rng, name):
    """A QR-looking square for the demo payment option. It is not a real, scannable QR."""
    cells, size = 29, 12
    img = Image.new("RGB", (cells * size + 48, cells * size + 48), "white")
    d = ImageDraw.Draw(img)
    for y in range(cells):
        for x in range(cells):
            finder = (x < 7 and y < 7) or (x >= cells - 7 and y < 7) or (x < 7 and y >= cells - 7)
            if finder:
                ring = max(abs(x - (3 if x < 7 else cells - 4)), abs(y - (3 if y < 7 else cells - 4)))
                on = ring != 2 and ring != 4 and ring <= 3
            else:
                on = rng.random() < 0.48
            if on:
                d.rectangle([24 + x * size, 24 + y * size, 24 + (x + 1) * size - 1, 24 + (y + 1) * size - 1], fill=(20, 20, 20))
    return jpeg(img, name)


def agenda_pdf():
    """A one-page 'AGM agenda' PDF (Pillow writes real PDFs)."""
    page = Image.new("RGB", (1240, 1754), "white")
    d = ImageDraw.Draw(page)
    d.rectangle([100, 100, 1140, 200], fill=(31, 90, 74))
    lines = ["Himalaya Heights - Annual General Meeting", "", "1. Welcome and attendance",
             "2. Accounts for the year", "3. Lift replacement proposal", "4. Water tank cleaning schedule",
             "5. Parking rules", "6. Any other business"]
    for i, text in enumerate(lines):
        d.text((120, 260 + i * 60), text, fill=(30, 30, 30))
    buf = io.BytesIO()
    page.save(buf, "PDF")
    return ContentFile(buf.getvalue(), name="agm-agenda.pdf")


# ------------------------------------------------------------------ the command

class Command(BaseCommand):
    help = "Create (or remove with --remove) a complete demo building with residents, bills, complaints and visitors."

    def add_arguments(self, parser):
        parser.add_argument("--remove", action="store_true", help="Delete the demo building, its users and files.")

    def handle(self, *args, **options):
        self.remove()
        if options["remove"]:
            self.stdout.write(self.style.SUCCESS("Demo data removed."))
            return
        rng = random.Random(2026)
        with transaction.atomic():
            self.create(rng)

    # -------------------------------------------------------------- remove

    def remove(self):
        building = Building.objects.filter(name=BUILDING_NAME, secretary__username__startswith=PREFIX).first()
        if building:
            files = [i.photo for i in BuildingImage.objects.filter(building=building)]
            files += [i.photo for i in UnitImage.objects.filter(unit__floor__building=building)]
            files += [c.photo for c in Complaint.objects.filter(building=building) if c.photo]
            files += [n.attachment for n in Notice.objects.filter(building=building) if n.attachment]
            files += [m.qr for m in PaymentMethod.objects.filter(building=building) if m.qr]
            files += [pay.proof for pay in Payment.objects.filter(bill__unit__floor__building=building) if pay.proof]
            for f in files:
                f.delete(save=False)
            building.delete()   # floors, units, bills, complaints, notices, visitors go with it
        User.objects.filter(username__startswith=PREFIX).delete()

    # -------------------------------------------------------------- create

    def create(self, rng):
        now = timezone.now()
        today = timezone.localdate()
        password = make_password(PASSWORD)   # hash once, reuse: much faster than per user

        def user(username, role, first, last, **extra):
            return User.objects.create(username=PREFIX + username, password=password, role=role,
                                       first_name=first, last_name=last, **extra)

        # ---- building
        secretary = user("secretary", "secretary", "Anita", "Shrestha", email="anita@example.com", phone1="9851000000")
        building = Building.objects.create(
            name=BUILDING_NAME, total_floors=8, secretary=secretary,
            description=("Lazimpat, Kathmandu, opposite the Embassy road.\n"
                         "Main gate closes at 11 pm. Basement parking for residents only.\n"
                         "Water tank cleaned every quarter; generator backup for lifts and stairs."),
        )
        for i in range(4):
            BuildingImage.objects.create(building=building, photo=facade(rng, f"himalaya-{i}.jpg"))

        # ---- units: floors 1-7 have A-D, floor 8 has two penthouses
        layouts = {"A": (1250, 38000), "B": (980, 30000), "C": (760, 24000), "D": (760, 24000)}
        units = []
        for floor in building.floors.order_by("number"):
            letters = ["A", "B"] if floor.number == 8 else ["A", "B", "C", "D"]
            for letter in letters:
                area, rent = layouts[letter]
                if floor.number == 8:
                    area, rent = (2100, 65000) if letter == "A" else (1900, 58000)
                rent += (floor.number - 1) * 500   # higher floors a little dearer
                unit = Unit.objects.create(floor=floor, name=f"{floor.number}{letter}", area=area, rent=rent)
                for p in range(rng.choice([2, 3, 3, 4])):
                    UnitImage.objects.create(unit=unit, photo=room(rng, f"unit-{unit.name}-{p}.jpg"))
                units.append(unit)

        # ---- residents: most units occupied, some by families; a few vacant
        vacant = {"2D", "5C", "7B", "8B"}
        names = [(f, l) for f in FIRST for l in LAST]
        rng.shuffle(names)
        residents, occupants = [], {}
        n = 0
        for unit in units:
            if unit.name in vacant:
                continue
            family = rng.choice([1, 1, 2, 2, 3]) if unit.area > 900 else rng.choice([1, 1, 2])
            surname = names[n][1]
            for k in range(family):
                first = names[n][0]
                n += 1
                username = "resident" if unit.name == "3B" and k == 0 else f"{first.lower()}{n}"
                r = user(username, "resident", first, surname, building=building,
                         phone1=f"98{rng.randint(41000000, 69999999)}",
                         email=f"{first.lower()}.{surname.lower()}@example.com" if rng.random() < 0.6 else "")
                months_ago = rng.choice([2, 5, 8, 14, 20, 30])
                ResidentProfile.objects.create(user=r, unit=unit, moved_in=today - timedelta(days=30 * months_ago))
                User.objects.filter(pk=r.pk).update(date_joined=now - timedelta(days=30 * min(months_ago, 7)))
                residents.append(r)
                occupants.setdefault(unit.id, []).append(r)
        for first, last in [("Nabin", "KC"), ("Sujata", "Bhandari")]:   # joined, no unit chosen yet
            residents.append(user(first.lower(), "resident", first, last, building=building, phone1=f"98{rng.randint(41000000, 69999999)}"))

        guards = [
            user("guard", "guard", "Dil", "Bahadur", building=building, phone1="9800000101"),
            user("guard2", "guard", "Krishna", "Tamang", building=building, phone1="9800000102"),
        ]

        # ---- bills: the last 6 months for occupied units
        month = today.replace(day=1)
        periods = [month]
        for _ in range(5):
            periods.insert(0, (periods[0] - timedelta(days=1)).replace(day=1))
        occupied_units = [u for u in units if u.id in occupants]
        paid_bills = []
        for period in periods:
            due = period + timedelta(days=14)
            sent_at = timezone.make_aware(timezone.datetime(period.year, period.month, 3, 10, 0))
            is_current = period == month
            for unit in occupied_units:
                bill = Bill.objects.create(unit=unit, period=period, due_date=due, created_by=secretary)
                lines = [("Rent", unit.rent), ("Maintenance", 2500),
                         ("Electricity", rng.randint(9, 48) * 100 + rng.choice([0, 50]))]
                if rng.random() < 0.35:
                    lines.append(("Water", rng.choice([300, 450, 600])))
                if period.month in (5, 11) and rng.random() < 0.5:
                    lines.append(("Generator fuel share", 800))
                BillItem.objects.bulk_create([BillItem(bill=bill, title=t, amount=Decimal(a)) for t, a in lines])

                # older months: nearly everyone paid; this month: about half so far
                pays = rng.random() < (0.5 if is_current else 0.94 if period == periods[-2] else 0.99)
                paid_at = (timezone.make_aware(timezone.datetime(period.year, period.month, 1, 12, 0))
                           + timedelta(days=rng.randint(5, 20))) if pays else None
                if paid_at and paid_at > now:
                    paid_at = now - timedelta(hours=rng.randint(1, 48))
                Bill.objects.filter(pk=bill.pk).update(
                    sent_at=sent_at, created_at=sent_at,
                    status=Bill.Status.PAID if pays else Bill.Status.UNPAID, paid_at=paid_at,
                )
                bill.billed_residents.set(occupants[unit.id])
                if pays:
                    paid_bills.append((paid_at, bill, sum(Decimal(a) for _, a in lines), occupants[unit.id][0]))
        # ---- payment options and payment records
        fonepay = PaymentMethod.objects.create(
            building=building, kind="fonepay", label="Scan with any bank app", account_name="Himalaya Heights Residents Society",
            qr=demo_qr(rng, "himalaya-fonepay.jpg"),
        )
        PaymentMethod.objects.create(
            building=building, kind="bank", label="Bank transfer", account_name="Himalaya Heights Residents Society",
            account_number="01234567890123", bank_name="NIC Asia Bank", branch="Lazimpat",
        )
        Building.objects.filter(pk=building.pk).update(payment_details_changed_at=now - timedelta(days=40))
        kinds = ["fonepay", "fonepay", "fonepay", "bank", "esewa", "khalti", "cash"]
        counter = 0
        for paid_at, bill, total, payer in sorted(paid_bills, key=lambda row: row[0]):
            counter += 1
            kind = rng.choice(kinds)
            Payment.objects.create(
                bill=bill, amount=total, kind=kind, payment_method=fonepay if kind == "fonepay" else None,
                reference="" if kind == "cash" else f"{rng.randint(10**9, 10**10 - 1)}",
                paid_on=timezone.localtime(paid_at).date() - timedelta(days=rng.randint(0, 2)),
                status=Payment.Status.CONFIRMED, submitted_by=payer, decided_by=secretary, decided_at=paid_at,
                receipt_no=f"{building.code}-{paid_at:%Y}-{counter:04d}",
            )
        Building.objects.filter(pk=building.pk).update(receipt_counter=counter)
        # A few residents have reported payments the secretary hasn't checked yet
        waiting = Bill.objects.filter(unit__floor__building=building, period=month, status=Bill.Status.UNPAID).order_by("unit__name")[:3]
        for i, bill in enumerate(waiting):
            total = sum(item.amount for item in bill.items.all())
            Payment.objects.create(
                bill=bill, amount=total if i != 1 else (total / 2).quantize(Decimal("1")), kind="fonepay", payment_method=fonepay,
                reference=f"{rng.randint(10**9, 10**10 - 1)}", paid_on=today - timedelta(days=i),
                proof=room(rng, f"proof-{bill.id}.jpg") if i == 0 else None,
                note="Paid half now, the rest next week" if i == 1 else "",
                submitted_by=bill.billed_residents.first(), status=Payment.Status.PENDING,
            )

        # Next month started as drafts for a few units, as a secretary mid-way through billing would have
        if today.day > 20:
            next_month = (month + timedelta(days=32)).replace(day=1)
            for unit in occupied_units[:5]:
                draft = Bill.objects.create(unit=unit, period=next_month, due_date=next_month + timedelta(days=14), created_by=secretary)
                BillItem.objects.bulk_create([BillItem(bill=draft, title="Rent", amount=Decimal(unit.rent)),
                                              BillItem(bill=draft, title="Maintenance", amount=Decimal(2500))])

        # ---- complaints
        def complaint(title, description, days_ago, status="open", response="", anonymous=False, photo=False, unit_owner=None):
            owner = unit_owner or rng.choice([r for r in residents if hasattr(r, "resident_profile") and r.resident_profile.unit])
            c = Complaint.objects.create(
                building=building, unit=owner.resident_profile.unit, raised_by=owner, title=title,
                description=description, status=status, response=response, is_anonymous=anonymous,
                photo=leak_photo(rng, f"complaint-{days_ago}.jpg") if photo else None,
            )
            created = now - timedelta(days=days_ago, hours=rng.randint(1, 8))
            updated = created + timedelta(days=rng.randint(0, 2), hours=rng.randint(1, 6)) if (status != "open" or response) else None
            Complaint.objects.filter(pk=c.pk).update(
                created_at=created, last_update_at=updated,
                resolved_at=updated if status == "resolved" else None,
            )

        demo_resident = User.objects.get(username=PREFIX + "resident")
        complaint("Damp patch on bedroom ceiling", "There's a damp patch spreading on the ceiling, probably from the unit above.",
                  2, photo=True, unit_owner=demo_resident)
        complaint("Lift stops between floors 4 and 5", "Happened twice this week in the evening.", 4, "resolved",
                  "Technician booked for Thursday morning. Please use the stairs if it stops again.")
        complaint("Loud music after midnight", "Someone on the sixth floor plays loud music most nights.", 3, anonymous=True)
        complaint("Stairwell light not working on floor 3", "", 9, "resolved", "Replaced the bulbs on floors 3 and 4.")
        complaint("Water pressure very low in mornings", "Kitchen tap barely runs between 6 and 8 am.", 6, "resolved",
                  "Checking the pump timer with the plumber.")
        complaint("Car parked in my basement spot", "A grey Hyundai keeps parking in spot B-12.", 12, "resolved",
                  "Spoke to the owner; it won't happen again.", unit_owner=demo_resident)
        complaint("Garbage not collected on Tuesday", "", 1)
        complaint("Main gate squeaks loudly", "", 20, "resolved", "Hinges oiled.")
        complaint("Internet cable hanging in the corridor", "Near unit 5A, someone could trip.", 5, photo=True)

        # ---- notices
        def notice(title, message, days_ago, attachment=None):
            nt = Notice.objects.create(building=building, posted_by=secretary, title=title, message=message, attachment=attachment)
            stamp = now - timedelta(days=days_ago, hours=rng.randint(1, 6))
            Notice.objects.filter(pk=nt.pk).update(created_at=stamp, updated_at=stamp)

        notice("Water supply off this Saturday", "The overhead tank is being cleaned on Saturday from 10 am to 2 pm. Please store water the night before.", 1)
        notice("Annual general meeting on the 15th", "All owners and tenants are invited to the AGM in the community hall at 5 pm. The agenda is attached.", 6, agenda_pdf())
        notice("New parking stickers", "Collect your vehicle sticker from the guard room by the end of the month. Cars without stickers will not be allowed in after that.", 11,
               facade(rng, "parking-notice.jpg"))
        notice("Lift maintenance", "Both lifts will be serviced on Friday between 9 and 11 am. Please plan accordingly.", 18)
        notice("Dashain greetings", "Wishing all residents a very happy Dashain. The office stays closed from Ghatasthapana to Tika; guards remain on duty.", 32)
        notice("Generator testing", "The generator will be tested for 15 minutes every Sunday at 7 am.", 60)

        # ---- visitors: the last week, with a few people still inside
        people = [("visitor", "Ramesh Kumar", "9841234567", "Guest"), ("visitor", "Sabina Rai", "9862222222", "Family"),
                  ("visitor", "Arjun Thapa", "9851111111", "Friend"), ("delivery", "Daraz", "", "Parcel"),
                  ("delivery", "Foodmandu", "", "Food"), ("delivery", "Pathao", "", "Courier"),
                  ("worker", "Sita Tamang", "9800000001", "Cleaner"), ("worker", "Hari Plumber", "9800000002", "Plumber"),
                  ("worker", "Maya (cook)", "9800000003", "Cook"), ("worker", "Bishnu Electrician", "9800000004", "Electrician")]
        occupied = [u for u in units if u.id in occupants]
        for day in range(7, -1, -1):
            for _ in range(rng.randint(6, 12)):
                kind, name, phone, purpose = rng.choice(people)
                start = timezone.make_aware(timezone.datetime(today.year, today.month, today.day, 7, 0)) - timedelta(days=day)
                check_in = start + timedelta(minutes=rng.randint(0, 13 * 60))
                if check_in > now:
                    continue
                stay = timedelta(minutes=rng.randint(8, 30) if kind == "delivery" else rng.randint(30, 240))
                check_out = check_in + stay if (check_in + stay) < now - timedelta(minutes=5) else None
                e = EntryLog.objects.create(
                    building=building, entry_type=kind, name=name, phone=phone,
                    unit=None if name == "Sita Tamang" else rng.choice(occupied), purpose=purpose,
                    vehicle_no=rng.choice(["", "", "", "BA 2 PA 1234", "BA 5 CHA 777", "GA 1 PA 4521"]) if kind == "visitor" else "",
                    logged_by=guards[day % 2],
                )
                EntryLog.objects.filter(pk=e.pk).update(check_in=check_in, check_out=check_out,
                                                       checked_out_by=guards[day % 2] if check_out else None)
        # someone who was never checked out yesterday
        stuck = EntryLog.objects.create(building=building, entry_type="worker", name="Bishnu Electrician", phone="9800000004",
                                        unit=occupied[3], purpose="Electrician", logged_by=guards[0])
        EntryLog.objects.filter(pk=stuck.pk).update(check_in=now - timedelta(hours=20))

        # ---- summary
        self.stdout.write(self.style.SUCCESS(f"Created {BUILDING_NAME}:"))
        self.stdout.write(f"  {len(units)} units ({len(vacant)} vacant), {len(residents)} residents, {len(guards)} guards")
        self.stdout.write(f"  {Bill.objects.filter(unit__floor__building=building).count()} bills, "
                          f"{Complaint.objects.filter(building=building).count()} complaints, "
                          f"{Notice.objects.filter(building=building).count()} notices, "
                          f"{EntryLog.objects.filter(building=building).count()} visitor entries")
        self.stdout.write("")
        self.stdout.write(f"  Sign in with password {PASSWORD} as:")
        self.stdout.write(f"    {PREFIX}secretary   (secretary)")
        self.stdout.write(f"    {PREFIX}resident    (resident of unit 3B)")
        self.stdout.write(f"    {PREFIX}guard       (guard)")
        self.stdout.write(f"  Join code: {building.join_code}")
