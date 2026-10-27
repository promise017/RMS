from datetime import date
from decimal import Decimal

import shutil
import tempfile

from django.test import override_settings
from rest_framework.test import APITestCase

from accounts.models import User
from .models import Bill, Building, ResidentProfile, Unit

BILLS = "/residency/mybuilding/bills/"
BULK = "/residency/mybuilding/bills/bulk/"
MY_BILLS = "/residency/myunit/bills/"
SEND = "/residency/mybuilding/bills/send/"


def bill_url(pk):
    return f"/residency/mybuilding/bills/{pk}/"


# Uploaded files from tests go to a throwaway folder, never the real media/
TEST_MEDIA = tempfile.mkdtemp(prefix="griha-test-media-")


def tearDownModule():
    shutil.rmtree(TEST_MEDIA, ignore_errors=True)


@override_settings(MEDIA_ROOT=TEST_MEDIA)
class BillingTests(APITestCase):
    def setUp(self):
        self.secretary = User.objects.create_user("sec", password="x", role="secretary")
        self.building = Building.objects.create(name="Sunrise", total_floors=2, secretary=self.secretary)
        floor1, floor2 = self.building.floors.all()
        self.unit_a = Unit.objects.create(floor=floor1, name="1A", area=900, rent=15000)
        self.unit_b = Unit.objects.create(floor=floor1, name="1B", area=700, rent=12000)
        self.unit_free = Unit.objects.create(floor=floor2, name="2A", area=500, rent=0)

        # Someone else's building, to check nothing leaks across buildings
        self.other_secretary = User.objects.create_user("sec2", password="x", role="secretary")
        other = Building.objects.create(name="Other", total_floors=1, secretary=self.other_secretary)
        self.other_unit = Unit.objects.create(floor=other.floors.first(), name="X", area=1, rent=5000)

        self.client.force_authenticate(self.secretary)

    def create_bill(self, **data):
        payload = {"unit": self.unit_a.id, "period": "2026-10", "due_date": "2026-10-15"}
        if "period" in data and "due_date" not in data:
            payload["due_date"] = f"{data['period']}-15"   # keep the due date inside the billing month
        payload.update(data)
        return self.client.post(BILLS, payload, format="json")

    # ---------- creating ----------

    def test_rent_is_added_as_first_line(self):
        r = self.create_bill(items=[{"title": "Electricity", "amount": "2340.50"}])
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual([i["title"] for i in r.data["items"]], ["Rent", "Electricity"])
        self.assertEqual(r.data["total"], "17340.50")
        self.assertEqual(r.data["period"], "2026-10")
        self.assertEqual(Bill.objects.get().period, date(2026, 10, 1))
        self.assertEqual(Bill.objects.get().created_by, self.secretary)

    def test_rent_can_be_left_out(self):
        r = self.create_bill(include_rent=False, items=[{"title": "Water", "amount": "450"}])
        self.assertEqual([i["title"] for i in r.data["items"]], ["Water"])

    def test_unit_without_rent_needs_a_charge(self):
        r = self.create_bill(unit=self.unit_free.id)
        self.assertEqual(r.status_code, 400)
        self.assertIn("items", r.data)

    def test_one_bill_per_unit_per_month(self):
        self.create_bill()
        r = self.create_bill()
        self.assertEqual(r.status_code, 400)
        self.assertIn("October 2026", str(r.data["period"]))
        self.assertEqual(self.create_bill(period="2026-11").status_code, 201)

    def test_bad_input_is_rejected(self):
        self.assertEqual(self.create_bill(period="October").status_code, 400)
        self.assertEqual(self.create_bill(items=[{"title": "Fine", "amount": "-5"}]).status_code, 400)
        self.assertEqual(self.create_bill(items=[{"title": "  ", "amount": "5"}]).status_code, 400)

    def test_cannot_bill_another_buildings_unit(self):
        r = self.create_bill(unit=self.other_unit.id)
        self.assertEqual(r.status_code, 400)
        self.assertIn("unit", r.data)

    # ---------- editing ----------

    def test_items_are_replaced_on_edit(self):
        bill = self.create_bill(items=[{"title": "Electricity", "amount": "100"}]).data
        r = self.client.patch(bill_url(bill["id"]), {"items": [
            {"title": "Rent", "amount": "15000"}, {"title": "Electricity", "amount": "2500"},
        ]}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["total"], "17500.00")
        self.assertEqual(Bill.objects.get().items.count(), 2)

    def test_mark_paid_and_unpaid(self):
        bill = self.create_bill().data
        r = self.client.patch(bill_url(bill["id"]), {"status": "paid"}, format="json")
        self.assertEqual(r.data["status"], "paid")
        self.assertIsNotNone(r.data["paid_at"])
        r = self.client.patch(bill_url(bill["id"]), {"status": "unpaid"}, format="json")
        self.assertIsNone(r.data["paid_at"])

    def test_paid_bill_is_locked(self):
        bill = self.create_bill().data
        self.client.patch(bill_url(bill["id"]), {"status": "paid"}, format="json")
        r = self.client.patch(bill_url(bill["id"]), {"items": [{"title": "Rent", "amount": "1"}]}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.client.delete(bill_url(bill["id"])).status_code, 400)
        # A note can still be added to a paid bill
        r = self.client.patch(bill_url(bill["id"]), {"note": "Paid in cash"}, format="json")
        self.assertEqual(r.status_code, 200)

    def test_cannot_move_bill_to_another_unit(self):
        bill = self.create_bill().data
        r = self.client.patch(bill_url(bill["id"]), {"unit": self.unit_b.id}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_delete_unpaid_bill(self):
        bill = self.create_bill().data
        self.assertEqual(self.client.delete(bill_url(bill["id"])).status_code, 204)
        self.assertFalse(Bill.objects.exists())

    # ---------- listing ----------

    def test_list_filters(self):
        self.create_bill()
        self.create_bill(unit=self.unit_b.id)
        self.create_bill(period="2026-11")
        self.client.patch(bill_url(Bill.objects.get(unit=self.unit_b).id), {"status": "paid"}, format="json")

        self.assertEqual(len(self.client.get(BILLS).data), 3)
        self.assertEqual(len(self.client.get(BILLS, {"period": "2026-10"}).data), 2)
        # Unpaid means sent and not paid: the two others are still drafts
        self.assertEqual(len(self.client.get(BILLS, {"status": "unpaid"}).data), 0)
        self.assertEqual(len(self.client.get(BILLS, {"status": "draft"}).data), 2)
        self.client.post(SEND, {"period": "2026-10"}, format="json")
        self.assertEqual(len(self.client.get(BILLS, {"status": "unpaid"}).data), 1)
        self.assertEqual(len(self.client.get(BILLS, {"unit": self.unit_a.id}).data), 2)
        self.assertEqual(self.client.get(BILLS, {"period": "bad"}).status_code, 400)

    def test_other_secretary_sees_nothing(self):
        bill = self.create_bill().data
        self.client.force_authenticate(self.other_secretary)
        self.assertEqual(self.client.get(BILLS).data, [])
        self.assertEqual(self.client.get(bill_url(bill["id"])).status_code, 404)
        self.assertEqual(self.client.patch(bill_url(bill["id"]), {"status": "paid"}, format="json").status_code, 404)

    # ---------- bulk ----------

    def test_bulk_bills_every_unit(self):
        r = self.client.post(BULK, {
            "period": "2026-10", "due_date": "2026-10-15",
            "items": [{"title": "Maintenance", "amount": "2000"}],
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["created"], 3)
        a = Bill.objects.get(unit=self.unit_a)
        self.assertEqual([(i.title, i.amount) for i in a.items.all()],
                         [("Rent", Decimal("15000")), ("Maintenance", Decimal("2000"))])
        # The rent-free unit only gets the shared charge
        self.assertEqual(Bill.objects.get(unit=self.unit_free).items.count(), 1)
        self.assertFalse(Bill.objects.filter(unit=self.other_unit).exists())

    def test_bulk_is_safe_to_run_twice(self):
        payload = {"period": "2026-10", "due_date": "2026-10-15"}
        first = self.client.post(BULK, payload, format="json").data
        # Rent only: the rent-free unit has nothing to bill
        self.assertEqual(first["created"], 2)
        self.assertEqual([u["name"] for u in first["skipped_no_charges"]], ["2A"])
        second = self.client.post(BULK, payload, format="json").data
        self.assertEqual(second["created"], 0)
        self.assertEqual(len(second["skipped_existing"]), 2)
        self.assertEqual(Bill.objects.count(), 2)

    def test_bulk_chosen_units_only(self):
        r = self.client.post(BULK, {
            "period": "2026-10", "due_date": "2026-10-15",
            "units": [self.unit_b.id, self.other_unit.id],
        }, format="json")
        self.assertEqual(r.data["created"], 1)
        self.assertEqual(Bill.objects.get().unit, self.unit_b)

    def test_bulk_needs_something_to_bill(self):
        r = self.client.post(BULK, {"period": "2026-10", "due_date": "2026-10-15", "include_rent": False}, format="json")
        self.assertEqual(r.status_code, 400)

    # ---------- residents ----------

    def test_resident_sees_only_bills_sent_to_them(self):
        old_tenant = User.objects.create_user("old", password="x", role="resident", building=self.building)
        ResidentProfile.objects.create(user=old_tenant, unit=self.unit_a)
        self.create_bill(period="2026-09", due_date="2026-09-15", send=True)    # sent while the old tenant lived there
        self.create_bill(unit=self.unit_b.id, period="2026-10", send=True)      # someone else's unit

        # The old tenant moves out and a new one moves in
        old_tenant.resident_profile.unit = None
        old_tenant.resident_profile.save()
        resident = User.objects.create_user("res", password="x", role="resident", building=self.building)
        ResidentProfile.objects.create(user=resident, unit=self.unit_a, moved_in=date(2026, 9, 20))
        self.create_bill(period="2026-10", send=True)
        self.create_bill(period="2026-11", due_date="2026-11-15")               # still a draft

        self.client.force_authenticate(resident)
        r = self.client.get(MY_BILLS)
        self.assertEqual(r.status_code, 200)
        self.assertEqual([b["period"] for b in r.data], ["2026-10"])
        self.assertEqual(r.data[0]["total"], "15000.00")
        self.assertEqual(r.data[0]["unit"]["name"], "1A")

        # The old tenant still sees (and owes) September, even though they left
        self.client.force_authenticate(old_tenant)
        self.assertEqual([b["period"] for b in self.client.get(MY_BILLS).data], ["2026-09"])

    def test_resident_without_unit_has_no_bills(self):
        self.create_bill()
        resident = User.objects.create_user("res", password="x", role="resident", building=self.building)
        self.client.force_authenticate(resident)
        self.assertEqual(self.client.get(MY_BILLS).data, [])

    # ---------- drafts and sending ----------

    def test_new_bills_are_drafts_until_sent(self):
        r = self.create_bill()
        self.assertTrue(r.data["is_draft"])
        self.assertIsNone(r.data["sent_at"])
        resident = User.objects.create_user("res", password="x", role="resident", building=self.building)
        ResidentProfile.objects.create(user=resident, unit=self.unit_a)
        self.client.force_authenticate(resident)
        self.assertEqual(self.client.get(MY_BILLS).data, [])

        self.client.force_authenticate(self.secretary)
        self.assertEqual(self.client.post(SEND, {"ids": [r.data["id"]]}, format="json").data["sent"], 1)
        bill = self.client.get(bill_url(r.data["id"])).data
        self.assertFalse(bill["is_draft"])
        self.assertEqual([p["name"] for p in bill["billed_to"]], ["res"])
        self.assertEqual(self.client.post(SEND, {"ids": [r.data["id"]]}, format="json").data["sent"], 0)   # already sent

    def test_send_a_whole_month_and_bulk_send(self):
        self.client.post(BULK, {"period": "2026-10", "due_date": "2026-10-15"}, format="json")
        self.assertEqual(self.client.post(SEND, {"period": "2026-10"}, format="json").data["sent"], 2)
        r = self.client.post(BULK, {"period": "2026-11", "due_date": "2026-11-15", "send": True}, format="json")
        self.assertTrue(r.data["sent"])
        self.assertEqual(Bill.objects.filter(period=date(2026, 11, 1), sent_at__isnull=True).count(), 0)
        self.assertEqual(self.client.post(SEND, {}, format="json").status_code, 400)

    def test_paying_a_draft_sends_it(self):
        bill = self.create_bill().data
        r = self.client.patch(bill_url(bill["id"]), {"status": "paid"}, format="json")
        self.assertFalse(r.data["is_draft"])

    def test_other_secretary_cannot_send(self):
        bill = self.create_bill().data
        self.client.force_authenticate(self.other_secretary)
        self.assertEqual(self.client.post(SEND, {"ids": [bill["id"]]}, format="json").data["sent"], 0)

    # ---------- overdue ----------

    def test_overdue_bills(self):
        from datetime import timedelta
        from django.utils import timezone
        today = timezone.localdate()
        month = today.replace(day=1)
        past_month = (month - timedelta(days=1)).replace(day=1)
        late_due = past_month + timedelta(days=3)
        late = self.create_bill(period=past_month.strftime("%Y-%m"), due_date=str(late_due), send=True).data
        self.create_bill(unit=self.unit_b.id, period=month.strftime("%Y-%m"), due_date=str(today + timedelta(days=30)), send=True)
        self.create_bill(unit=self.unit_free.id, period=past_month.strftime("%Y-%m"), due_date=str(late_due),
                         items=[{"title": "Water", "amount": "100"}])   # a draft: never overdue

        self.assertTrue(late["is_overdue"])
        self.assertEqual(late["days_overdue"], (today - late_due).days)
        overdue = self.client.get(BILLS, {"overdue": "true"}).data
        self.assertEqual([b["id"] for b in overdue], [late["id"]])
        paid = self.client.patch(bill_url(late["id"]), {"status": "paid"}, format="json").data
        self.assertFalse(paid["is_overdue"])
        self.assertEqual(self.client.get(BILLS, {"overdue": "true"}).data, [])

    def test_due_date_must_fit_the_month(self):
        self.assertIn("due_date", self.create_bill(due_date="2026-09-30").data)       # before October starts
        self.assertIn("due_date", self.create_bill(due_date="2027-06-01").data)       # too far ahead
        self.assertEqual(self.create_bill(due_date="2026-11-10").status_code, 201)     # next month is fine
        r = self.client.post(BULK, {"period": "2026-12", "due_date": "2026-11-01"}, format="json")
        self.assertIn("due_date", r.data)

    # ---------- who was billed ----------

    def test_resident_joining_later_takes_over_unowned_unpaid_bills(self):
        self.create_bill(send=True)               # sent while nobody was recorded in 1A
        resident = User.objects.create_user("late", password="x", role="resident", building=self.building)
        self.client.force_authenticate(resident)
        self.client.post("/residency/myunit/", {"unit": self.unit_a.id}, format="json")
        self.assertEqual(len(self.client.get(MY_BILLS).data), 1)

    def test_people_list_shows_what_residents_owe(self):
        resident = User.objects.create_user("res", password="x", role="resident", building=self.building)
        ResidentProfile.objects.create(user=resident, unit=self.unit_a)
        self.create_bill(send=True, items=[{"title": "Electricity", "amount": "500"}])
        self.create_bill(period="2026-11", due_date="2026-11-15")    # draft: not owed yet
        members = self.client.get("/residency/mybuilding/members/").data
        self.assertEqual(members["residents"][0]["unpaid"], {"count": 1, "total": "15500.00"})

    def test_residents_cannot_use_secretary_endpoints(self):
        resident = User.objects.create_user("res", password="x", role="resident", building=self.building)
        self.client.force_authenticate(resident)
        self.assertEqual(self.client.get(BILLS).status_code, 403)
        self.assertEqual(self.client.post(BULK, {}, format="json").status_code, 403)


MY_COMPLAINTS = "/residency/mycomplaints/"
SEC_COMPLAINTS = "/residency/mybuilding/complaints/"


def image_file(name="leak.png"):
    import io
    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (4, 4)).save(buf, "PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


@override_settings(MEDIA_ROOT=TEST_MEDIA)
class ResidentComplaintTests(APITestCase):
    def setUp(self):
        from .models import Complaint  # noqa: F401  (keeps imports local to this suite)
        self.secretary = User.objects.create_user("sec", password="x", role="secretary")
        self.building = Building.objects.create(name="Sunrise", total_floors=1, secretary=self.secretary)
        self.unit = Unit.objects.create(floor=self.building.floors.first(), name="1A", area=900, rent=1000)
        self.resident = User.objects.create_user("res", password="x", role="resident", first_name="Sita", building=self.building)
        ResidentProfile.objects.create(user=self.resident, unit=self.unit)
        self.neighbour = User.objects.create_user("nei", password="x", role="resident", building=self.building)
        self.client.force_authenticate(self.resident)

    def complain(self, **data):
        payload = {"title": "Tap leaking", "description": "Since Monday"}
        payload.update(data)
        return self.client.post(MY_COMPLAINTS, payload, format="multipart")

    def test_complaint_about_own_unit(self):
        r = self.complain(photo=image_file())
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["unit"]["name"], "1A")
        self.assertEqual(r.data["status"], "open")
        self.assertTrue(r.data["photo"])

    def test_resident_without_unit_can_still_complain(self):
        self.client.force_authenticate(self.neighbour)
        r = self.complain(title="Lift stuck")
        self.assertEqual(r.status_code, 201)
        self.assertIsNone(r.data["unit"])

    def test_blank_title_and_bad_photo_rejected(self):
        self.assertEqual(self.complain(title="  ").status_code, 400)
        from django.core.files.uploadedfile import SimpleUploadedFile
        fake = SimpleUploadedFile("x.png", b"not an image", content_type="image/png")
        self.assertEqual(self.complain(photo=fake).status_code, 400)

    def test_resident_cannot_set_status_or_response(self):
        r = self.complain(status="resolved", response="Fixed it myself")
        self.assertEqual(r.data["status"], "open")
        self.assertEqual(r.data["response"], "")

    def test_resident_sees_the_secretarys_reply(self):
        cid = self.complain().data["id"]
        self.client.force_authenticate(self.secretary)
        self.client.patch(f"{SEC_COMPLAINTS}{cid}/", {"response": "Plumber on Monday"}, format="json")
        self.client.force_authenticate(self.resident)
        r = self.client.get(MY_COMPLAINTS)
        self.assertEqual(r.data[0]["status"], "resolved")
        self.assertEqual(r.data[0]["response"], "Plumber on Monday")

    def test_replying_resolves_the_complaint(self):
        cid = self.complain().data["id"]
        self.client.force_authenticate(self.secretary)
        self.assertIn("response", self.client.patch(f"{SEC_COMPLAINTS}{cid}/", {"response": "   "}, format="json").data)
        self.assertIn("response", self.client.patch(f"{SEC_COMPLAINTS}{cid}/", {}, format="json").data)
        r = self.client.patch(f"{SEC_COMPLAINTS}{cid}/", {"response": "Fixed the tap", "status": "open"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["status"], "resolved")             # the status sent is ignored
        self.assertIsNotNone(r.data["resolved_at"])
        first = r.data["resolved_at"]
        # Editing the reply later keeps it resolved and doesn't move the resolved time
        r = self.client.patch(f"{SEC_COMPLAINTS}{cid}/", {"response": "Fixed the tap and the pipe"}, format="json")
        self.assertEqual((r.data["status"], r.data["resolved_at"]), ("resolved", first))

    def test_anonymous_hidden_from_secretary_but_visible_to_sender(self):
        cid = self.complain(is_anonymous="true").data["id"]
        mine = self.client.get(f"{MY_COMPLAINTS}{cid}/").data
        self.assertTrue(mine["is_anonymous"])
        self.assertEqual(mine["unit"]["name"], "1A")

        self.client.force_authenticate(self.secretary)
        seen = self.client.get(f"{SEC_COMPLAINTS}{cid}/").data
        self.assertIsNone(seen["raised_by"])
        self.assertIsNone(seen["unit"])

    def test_residents_only_see_their_own(self):
        cid = self.complain().data["id"]
        self.client.force_authenticate(self.neighbour)
        self.assertEqual(self.client.get(MY_COMPLAINTS).data, [])
        self.assertEqual(self.client.get(f"{MY_COMPLAINTS}{cid}/").status_code, 404)
        self.assertEqual(self.client.delete(f"{MY_COMPLAINTS}{cid}/").status_code, 404)

    def test_withdraw_only_while_open_and_unanswered(self):
        first = self.complain().data["id"]
        self.assertEqual(self.client.delete(f"{MY_COMPLAINTS}{first}/").status_code, 204)

        second = self.complain().data["id"]
        self.client.force_authenticate(self.secretary)
        self.client.patch(f"{SEC_COMPLAINTS}{second}/", {"response": "Looking into it"}, format="json")
        self.client.force_authenticate(self.resident)
        self.assertEqual(self.client.delete(f"{MY_COMPLAINTS}{second}/").status_code, 400)

    def test_secretary_and_guard_cannot_use_resident_endpoint(self):
        guard = User.objects.create_user("g", password="x", role="guard", building=self.building)
        for user in (self.secretary, guard):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get(MY_COMPLAINTS).status_code, 403)


VISITORS = "/residency/visitors/"


def checkout_url(pk):
    return f"/residency/visitors/{pk}/checkout/"


@override_settings(MEDIA_ROOT=TEST_MEDIA)
class VisitorLogTests(APITestCase):
    def setUp(self):
        self.secretary = User.objects.create_user("sec", password="x", role="secretary")
        self.building = Building.objects.create(name="Sunrise", total_floors=2, secretary=self.secretary)
        self.unit = Unit.objects.create(floor=self.building.floors.first(), name="1A", area=900, rent=1000)
        self.guard = User.objects.create_user("g1", password="x", role="guard", first_name="Dil", building=self.building)
        self.night_guard = User.objects.create_user("g2", password="x", role="guard", first_name="Ram", building=self.building)

        other_sec = User.objects.create_user("sec2", password="x", role="secretary")
        other = Building.objects.create(name="Other", total_floors=1, secretary=other_sec)
        self.other_unit = Unit.objects.create(floor=other.floors.first(), name="X", area=1, rent=1)
        self.other_guard = User.objects.create_user("g3", password="x", role="guard", building=other)
        self.client.force_authenticate(self.guard)

    def check_in(self, **data):
        payload = {"entry_type": "visitor", "name": "Ramesh Kumar", "phone": "9841234567", "unit": self.unit.id}
        payload.update(data)
        return self.client.post(VISITORS, payload, format="json")

    def test_guard_checks_someone_in(self):
        r = self.check_in(vehicle_no=" ba 2 pa  1234 ", purpose="Guest")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(r.data["is_inside"])
        self.assertEqual(r.data["unit_info"]["name"], "1A")
        self.assertEqual(r.data["vehicle_no"], "BA 2 PA 1234")
        self.assertEqual(r.data["logged_by"], "Dil")
        self.assertIsNotNone(r.data["check_in"])

    def test_only_the_name_is_required(self):
        r = self.client.post(VISITORS, {"entry_type": "visitor", "name": "Walk-in Guest"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data["phone"], r.data["unit_info"], r.data["purpose"], r.data["vehicle_no"]), ("", None, "", ""))
        self.assertEqual(self.check_in(entry_type="worker", phone="").status_code, 201)
        self.assertIn("name", self.check_in(name="  ").data)

    def test_phone_rules(self):
        self.assertIn("phone", self.check_in(phone="call me").data)          # optional, but must be a number if given
        self.assertEqual(self.check_in(entry_type="delivery", name="Daraz", phone="").status_code, 201)
        self.assertEqual(self.check_in(phone="984-123 4567").data["phone"], "9841234567")

    def test_unit_is_optional_but_must_be_in_this_building(self):
        self.assertEqual(self.check_in(unit=None).status_code, 201)            # common area / building work
        self.assertEqual(self.check_in(unit=self.other_unit.id).status_code, 400)

    def test_cannot_set_times_or_guard(self):
        r = self.check_in(check_in="2020-01-01T00:00:00Z", check_out="2020-01-01T01:00:00Z", logged_by=self.night_guard.id)
        self.assertTrue(r.data["is_inside"])
        self.assertNotIn("2020", r.data["check_in"])
        self.assertEqual(r.data["logged_by"], "Dil")

    def test_check_out_by_another_guard(self):
        entry = self.check_in().data
        self.client.force_authenticate(self.night_guard)
        r = self.client.post(checkout_url(entry["id"]))
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["is_inside"])
        self.assertEqual(r.data["checked_out_by"], "Ram")
        self.assertEqual(self.client.post(checkout_url(entry["id"])).status_code, 400)   # already out

    def test_inside_and_today_lists(self):
        a = self.check_in(name="Still Inside").data
        b = self.check_in(name="Already Left").data
        self.client.post(checkout_url(b["id"]))
        inside = self.client.get(VISITORS, {"inside": "true"}).data
        self.assertEqual([e["name"] for e in inside], ["Still Inside"])
        today = self.client.get(VISITORS).data
        self.assertEqual({e["name"] for e in today}, {"Still Inside", "Already Left"})
        self.assertEqual(self.client.get(VISITORS, {"date": "2001-01-01"}).data, [])
        self.assertEqual(self.client.get(VISITORS, {"date": "yesterday"}).status_code, 400)
        self.assertEqual(a["id"] != b["id"], True)

    def test_search(self):
        self.check_in(name="Ramesh Kumar", vehicle_no="BA 1 PA 99")
        self.check_in(entry_type="delivery", name="Daraz", phone="", unit=None)
        self.assertEqual(len(self.client.get(VISITORS, {"q": "ramesh"}).data), 1)
        self.assertEqual(len(self.client.get(VISITORS, {"q": "pa 99"}).data), 1)
        self.assertEqual(len(self.client.get(VISITORS, {"q": "1a"}).data), 1)
        self.assertEqual(len(self.client.get(VISITORS, {"type": "delivery"}).data), 1)

    def test_phone_lookup_fills_in_repeat_visitors(self):
        self.check_in(entry_type="worker", name="Sita Cleaner", phone="9800000001", purpose="Cleaning")
        r = self.client.get("/residency/visitors/lookup/", {"phone": "9800000001"}).data
        self.assertTrue(r["found"])
        self.assertEqual((r["name"], r["entry_type"], r["unit"], r["purpose"]), ("Sita Cleaner", "worker", self.unit.id, "Cleaning"))
        self.assertFalse(self.client.get("/residency/visitors/lookup/", {"phone": "9800000002"}).data["found"])
        # Another building's guard can't look up this building's visitors
        self.client.force_authenticate(self.other_guard)
        self.assertFalse(self.client.get("/residency/visitors/lookup/", {"phone": "9800000001"}).data["found"])

    def test_secretary_reads_but_cannot_write(self):
        entry = self.check_in().data
        self.client.force_authenticate(self.secretary)
        self.assertEqual(len(self.client.get(VISITORS).data), 1)
        self.assertEqual(self.check_in().status_code, 403)
        self.assertEqual(self.client.post(checkout_url(entry["id"])).status_code, 403)

    def test_other_building_sees_nothing(self):
        entry = self.check_in().data
        self.client.force_authenticate(self.other_guard)
        self.assertEqual(self.client.get(VISITORS).data, [])
        self.assertEqual(self.client.post(checkout_url(entry["id"])).status_code, 404)

    def test_residents_have_no_access(self):
        resident = User.objects.create_user("res", password="x", role="resident", building=self.building)
        self.client.force_authenticate(resident)
        self.assertEqual(self.client.get(VISITORS).status_code, 403)
        self.assertEqual(self.check_in().status_code, 403)


BADGES = "/residency/badges/"


def seen_url(section):
    return f"/residency/badges/{section}/seen/"


@override_settings(MEDIA_ROOT=TEST_MEDIA)
class UnreadBadgeTests(APITestCase):
    def setUp(self):
        from .models import Complaint, Notice
        self.Complaint, self.Notice = Complaint, Notice
        self.secretary = User.objects.create_user("sec", password="x", role="secretary")
        self.building = Building.objects.create(name="Sunrise", total_floors=1, secretary=self.secretary)
        self.unit = Unit.objects.create(floor=self.building.floors.first(), name="1A", area=900, rent=1000)
        self.resident = User.objects.create_user("res", password="x", role="resident", building=self.building)
        ResidentProfile.objects.create(user=self.resident, unit=self.unit, moved_in=date(2026, 1, 1))
        self.guard = User.objects.create_user("grd", password="x", role="guard", building=self.building)

    def badges(self, user):
        self.client.force_authenticate(user)
        return self.client.get(BADGES).data

    def post_notice(self):
        self.client.force_authenticate(self.secretary)
        self.client.post("/residency/mybuilding/notices/", {"title": "Water cut", "message": "Sunday"}, format="multipart")

    def test_new_notice_shows_for_residents_and_guards_until_opened(self):
        self.post_notice()
        self.assertEqual(self.badges(self.resident)["notices"], 1)
        self.assertEqual(self.badges(self.guard)["notices"], 1)
        r = self.client.post(seen_url("notices"))      # the guard opens Notices
        self.assertEqual(r.data["notices"], 0)
        self.assertEqual(self.badges(self.resident)["notices"], 1)   # still unread for the resident

    def test_secretary_sees_new_complaints(self):
        self.client.force_authenticate(self.resident)
        self.client.post("/residency/mycomplaints/", {"title": "Leak"}, format="multipart")
        self.assertEqual(self.badges(self.secretary)["complaints"], 1)
        self.client.post(seen_url("complaints"))
        self.assertEqual(self.badges(self.secretary)["complaints"], 0)
        self.assertNotIn("notices", self.badges(self.secretary))   # secretaries post notices, no badge

    def test_resident_sees_secretarys_reply(self):
        self.client.force_authenticate(self.resident)
        cid = self.client.post("/residency/mycomplaints/", {"title": "Leak"}, format="multipart").data["id"]
        self.assertEqual(self.badges(self.resident)["complaints"], 0)   # their own new complaint isn't unread
        self.client.force_authenticate(self.secretary)
        self.client.patch(f"/residency/mybuilding/complaints/{cid}/", {"response": "Plumber Monday"}, format="json")
        self.assertEqual(self.badges(self.resident)["complaints"], 1)
        self.client.post(seen_url("complaints"))
        self.assertEqual(self.badges(self.resident)["complaints"], 0)

    def test_resident_sees_new_bills_once_sent(self):
        self.client.force_authenticate(self.secretary)
        bill = self.client.post("/residency/mybuilding/bills/", {"unit": self.unit.id, "period": "2026-10", "due_date": "2026-10-15"}, format="json").data
        self.assertEqual(self.badges(self.resident)["bills"], 0)     # a draft
        self.client.force_authenticate(self.secretary)
        self.client.post("/residency/mybuilding/bills/send/", {"ids": [bill["id"]]}, format="json")
        self.assertEqual(self.badges(self.resident)["bills"], 1)
        self.client.post(seen_url("bills"))
        self.assertEqual(self.badges(self.resident)["bills"], 0)

    def test_changing_a_sent_bill_shows_as_updated(self):
        self.client.force_authenticate(self.secretary)
        bill = self.client.post("/residency/mybuilding/bills/", {"unit": self.unit.id, "period": "2026-10", "due_date": "2026-10-15", "send": True}, format="json").data
        self.client.force_authenticate(self.resident)
        self.client.post(seen_url("bills"))
        self.client.force_authenticate(self.secretary)
        self.client.patch(f"/residency/mybuilding/bills/{bill['id']}/", {"items": [{"title": "Rent", "amount": "1000"}, {"title": "Electricity", "amount": "900"}]}, format="json")
        self.assertEqual(self.badges(self.resident)["bills"], 1)
        self.assertIsNotNone(self.client.get("/residency/myunit/bills/").data[0]["changed_at"])

    def test_sections_are_per_role(self):
        self.client.force_authenticate(self.guard)
        self.assertEqual(self.client.post(seen_url("bills")).status_code, 404)
        self.assertEqual(set(self.badges(self.guard)), {"notices"})
        self.assertEqual(set(self.badges(self.resident)), {"notices", "bills", "complaints"})

    def test_other_buildings_dont_count(self):
        other_sec = User.objects.create_user("sec2", password="x", role="secretary")
        other = Building.objects.create(name="Other", total_floors=1, secretary=other_sec)
        outsider = User.objects.create_user("out", password="x", role="guard", building=other)
        self.post_notice()
        self.assertEqual(self.badges(outsider)["notices"], 0)


DASHBOARD = "/residency/mybuilding/dashboard/"


@override_settings(MEDIA_ROOT=TEST_MEDIA)
class DashboardAndReminderTests(APITestCase):
    def setUp(self):
        from datetime import timedelta
        from django.utils import timezone
        self.today = timezone.localdate()
        self.month = self.today.replace(day=1)
        self.last_month = (self.month - timedelta(days=1)).replace(day=1)
        self.secretary = User.objects.create_user("sec", password="x", role="secretary")
        self.building = Building.objects.create(name="Sunrise", total_floors=2, secretary=self.secretary)
        f1, f2 = self.building.floors.all()
        self.a = Unit.objects.create(floor=f1, name="1A", area=900, rent=10000)
        self.b = Unit.objects.create(floor=f1, name="1B", area=900, rent=8000)
        self.c = Unit.objects.create(floor=f2, name="2A", area=900, rent=5000)
        self.resident = User.objects.create_user("res", password="x", role="resident", building=self.building)
        ResidentProfile.objects.create(user=self.resident, unit=self.a)
        User.objects.create_user("homeless", password="x", role="resident", building=self.building)
        self.client.force_authenticate(self.secretary)

    def bill(self, unit, period, due, send=True, paid=False):
        r = self.client.post(BILLS, {"unit": unit.id, "period": period.strftime("%Y-%m"), "due_date": str(due), "send": send}, format="json")
        assert r.status_code == 201, r.data
        if paid:
            self.client.patch(bill_url(r.data["id"]), {"status": "paid"}, format="json")
        return r.data

    def test_dashboard_collection_and_occupancy(self):
        from datetime import timedelta
        self.bill(self.a, self.last_month, self.last_month + timedelta(days=2))           # overdue
        self.bill(self.a, self.month, self.month + timedelta(days=40), paid=True)          # paid this month
        self.bill(self.b, self.month, self.month + timedelta(days=40))                     # unpaid, not due
        self.bill(self.c, self.month, self.month + timedelta(days=40), send=False)         # draft

        d = self.client.get(DASHBOARD).data
        c = d["collection"]
        self.assertEqual((c["billed"], c["collected"], c["outstanding"]), ("18000.00", "10000.00", "8000.00"))
        self.assertEqual((c["drafts"], c["unbilled_units"], c["overdue_bills"], c["overdue_total"]), (1, 0, 1, "10000.00"))
        self.assertGreater(c["oldest_overdue_days"], 0)
        o = d["occupancy"]
        self.assertEqual((o["units"], o["occupied"], o["vacant_count"], o["residents_without_unit"]), (3, 1, 2, 1))
        self.assertEqual([u["name"] for u in o["vacant"]], ["1B", "2A"])

    def test_dashboard_complaints_and_gate(self):
        self.client.force_authenticate(self.resident)
        self.client.post("/residency/mycomplaints/", {"title": "Leak"}, format="multipart")
        guard = User.objects.create_user("g", password="x", role="guard", building=self.building)
        self.client.force_authenticate(guard)
        self.client.post("/residency/visitors/", {"entry_type": "visitor", "name": "Ram"}, format="json")
        self.client.force_authenticate(self.secretary)
        d = self.client.get(DASHBOARD).data
        self.assertEqual(d["complaints"]["open"], 1)
        self.assertEqual(d["complaints"]["oldest"]["title"], "Leak")
        self.assertEqual((d["gate"]["inside_now"], d["gate"]["entries_today"]), (1, 1))

    def test_building_map(self):
        from datetime import timedelta
        self.bill(self.a, self.last_month, self.last_month + timedelta(days=2))         # overdue, last month
        self.bill(self.a, self.month, self.month + timedelta(days=40), paid=True)        # 1A paid this month
        self.bill(self.b, self.month, self.month + timedelta(days=40), send=False)       # 1B draft
        self.client.force_authenticate(self.resident)
        self.client.post("/residency/mycomplaints/", {"title": "Leak"}, format="multipart")
        self.client.post("/residency/mycomplaints/", {"title": "Noise", "is_anonymous": "true"}, format="multipart")
        self.client.force_authenticate(self.secretary)

        floors = self.client.get(DASHBOARD).data["map"]["floors"]
        self.assertEqual([f["number"] for f in floors], [2, 1])                         # top floor first
        units = {u["name"]: u for f in floors for u in f["units"]}
        a, b, c = units["1A"], units["1B"], units["2A"]
        self.assertEqual(a["bill"]["state"], "paid")
        self.assertEqual((a["owed"], a["owed_overdue"], a["unpaid_bills"]), ("10000.00", "10000.00", 1))
        self.assertEqual([r["name"] for r in a["residents"]], ["res"])
        self.assertEqual(a["open_complaints"], 1)                                       # the anonymous one isn't counted
        self.assertEqual(b["bill"]["state"], "draft")
        self.assertEqual((b["residents"], b["owed"]), ([], "0.00"))                     # vacant
        self.assertIsNone(c["bill"])                                                     # not billed this month

    def test_compared_with_last_month_at_the_same_point(self):
        from datetime import timedelta
        self.bill(self.a, self.last_month, self.last_month + timedelta(days=10), paid=True)
        self.bill(self.b, self.last_month, self.last_month + timedelta(days=10))
        last = self.client.get(DASHBOARD).data["collection"]["last_month"]
        self.assertEqual(last["period"], self.last_month.strftime("%Y-%m"))
        self.assertEqual(last["billed"], "18000.00")
        # Paid just now, i.e. after "the same day last month", so it doesn't count yet
        self.assertEqual(last["collected_by_same_day"], "0.00")

    def test_dashboard_is_secretary_only(self):
        self.client.force_authenticate(self.resident)
        self.assertEqual(self.client.get(DASHBOARD).status_code, 403)

    # ---------- reminders ----------

    def sent_long_ago(self, bill):
        """Backdate sending, so a badge can only come from a reminder, not from the bill being new."""
        from datetime import timedelta
        Bill.objects.filter(pk=bill["id"]).update(sent_at=timezone_now() - timedelta(days=60))

    def resident_badge(self):
        self.client.force_authenticate(self.resident)
        return self.client.get("/residency/badges/").data["bills"]

    def test_due_soon_reminder_comes_back_after_seen(self):
        from datetime import timedelta
        from residency.models import LastSeen
        bill = self.bill(self.a, self.month, self.today + timedelta(days=2))
        self.sent_long_ago(bill)
        self.client.force_authenticate(self.resident)
        mine = self.client.get(MY_BILLS).data[0]
        self.assertTrue(mine["due_soon"])
        self.assertEqual(mine["days_until_due"], 2)
        # Looked at bills a week ago: the "due soon" reminder (today-1) is newer, so it shows
        LastSeen.objects.update_or_create(user=self.resident, section="bills",
                                          defaults={"seen_at": timezone_now() - timedelta(days=7)})
        self.assertEqual(self.resident_badge(), 1)
        self.client.post("/residency/badges/bills/seen/")
        self.assertEqual(self.resident_badge(), 0)
        self.assertIsNotNone(bill)

    def test_overdue_reminders_repeat_weekly(self):
        from datetime import timedelta
        from residency.models import LastSeen
        due = self.today - timedelta(days=9)    # overdue for 9 days: reminders on day 1 and day 8
        self.sent_long_ago(self.bill(self.a, due.replace(day=1), due))
        LastSeen.objects.update_or_create(user=self.resident, section="bills",
                                          defaults={"seen_at": timezone_now() - timedelta(days=3)})
        self.assertEqual(self.resident_badge(), 1)          # the day-8 reminder came after they last looked
        LastSeen.objects.filter(user=self.resident).update(seen_at=timezone_now())
        self.assertEqual(self.resident_badge(), 0)

    def test_no_reminder_when_due_date_is_far_away(self):
        from datetime import timedelta
        from residency.models import LastSeen
        self.sent_long_ago(self.bill(self.a, self.month, self.month + timedelta(days=40)))
        LastSeen.objects.update_or_create(user=self.resident, section="bills",
                                          defaults={"seen_at": timezone_now() - timedelta(days=7)})
        self.assertEqual(self.resident_badge(), 0)

    def test_paid_and_draft_bills_never_remind(self):
        from datetime import timedelta
        from residency.models import LastSeen
        self.bill(self.a, self.last_month, self.last_month + timedelta(days=2), paid=True)
        self.bill(self.b, self.month, self.today + timedelta(days=1), send=False)
        LastSeen.objects.update_or_create(user=self.resident, section="bills",
                                          defaults={"seen_at": timezone_now() - timedelta(days=60)})
        # Only the paid bill was ever sent to them; paid bills don't remind (its "sent" may count once)
        self.client.force_authenticate(self.resident)
        bills = self.client.get(MY_BILLS).data
        self.assertTrue(all(not b["due_soon"] and not b["is_overdue"] for b in bills))


def timezone_now():
    from django.utils import timezone
    return timezone.now()


METHODS = "/residency/mybuilding/payment-methods/"
SEC_PAYMENTS = "/residency/mybuilding/payments/"


@override_settings(MEDIA_ROOT=TEST_MEDIA)
class PaymentTests(APITestCase):
    PASSWORD = "Secret-pass-2026"

    def setUp(self):
        self.secretary = User.objects.create_user("sec", password=self.PASSWORD, role="secretary")
        self.building = Building.objects.create(name="Himalaya Heights", total_floors=1, secretary=self.secretary)
        self.unit = Unit.objects.create(floor=self.building.floors.first(), name="3B", area=900, rent=10000)
        self.resident = User.objects.create_user("res", password="x", role="resident", first_name="Sita", building=self.building)
        ResidentProfile.objects.create(user=self.resident, unit=self.unit)
        self.client.force_authenticate(self.secretary)
        self.bill = self.client.post(BILLS, {"unit": self.unit.id, "period": "2026-10", "due_date": "2026-10-15",
                                             "items": [{"title": "Electricity", "amount": "2000"}], "send": True}, format="json").data

    def add_method(self, **data):
        payload = {"kind": "fonepay", "label": "Scan with any bank app", "account_name": "Himalaya Heights Society",
                   "qr": image_file("qr.png"), "password": self.PASSWORD}
        payload.update(data)
        return self.client.post(METHODS, payload, format="multipart")

    def report(self, **data):
        payload = {"amount": "12000", "kind": "fonepay", "reference": "TXN123", "paid_on": "2026-10-10"}
        payload.update(data)
        self.client.force_authenticate(self.resident)
        return self.client.post(f"/residency/myunit/bills/{self.bill['id']}/payments/", payload, format="multipart")

    def as_secretary(self):
        self.client.force_authenticate(self.secretary)

    # ---------- payment details ----------

    def test_changing_payment_details_needs_the_password(self):
        r = self.add_method(password="wrong")
        self.assertEqual(r.status_code, 400)
        self.assertIn("password", r.data)
        r = self.add_method()
        self.assertEqual(r.status_code, 201, r.data)
        data = self.client.get(METHODS).data
        self.assertEqual(len(data["methods"]), 1)
        self.assertIn("Added", data["log"][0]["summary"])
        self.assertIsNotNone(data["changed_at"])
        mid = r.data["id"]
        self.assertEqual(self.client.patch(f"{METHODS}{mid}/", {"account_name": "Someone else", "password": "nope"}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(f"{METHODS}{mid}/", {"password": "nope"}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(f"{METHODS}{mid}/", {"password": self.PASSWORD}, format="json").status_code, 204)
        self.assertEqual(self.client.get(METHODS).data["methods"], [])

    def test_a_method_needs_a_qr_or_an_account_number(self):
        r = self.add_method(qr="")
        self.assertEqual(r.status_code, 400)
        r = self.add_method(qr="", kind="bank", account_number="0123456789", bank_name="NIC Asia")
        self.assertEqual(r.status_code, 201, r.data)

    def test_residents_see_methods_and_are_told_about_changes(self):
        self.add_method()
        self.client.force_authenticate(self.resident)
        data = self.client.get("/residency/myunit/payment-methods/").data
        self.assertEqual(data["methods"][0]["account_name"], "Himalaya Heights Society")
        self.client.post("/residency/badges/bills/seen/")
        self.as_secretary()
        mid = self.client.get(METHODS).data["methods"][0]["id"]
        self.client.patch(f"{METHODS}{mid}/", {"qr": image_file("new.png"), "password": self.PASSWORD}, format="multipart")
        self.client.force_authenticate(self.resident)
        self.assertEqual(self.client.get("/residency/badges/").data["bills"], 1)
        self.assertEqual(self.client.post(METHODS, {}, format="json").status_code, 403)   # residents can't manage them

    # ---------- reporting and confirming ----------

    def test_resident_reports_and_secretary_confirms(self):
        r = self.report(proof=image_file("proof.png"))
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["status"], "pending")
        self.as_secretary()
        self.assertEqual(self.client.get("/residency/badges/").data["payments"], 1)
        self.assertEqual(len(self.client.get(SEC_PAYMENTS, {"status": "pending"}).data), 1)
        c = self.client.post(f"{SEC_PAYMENTS}{r.data['id']}/confirm/").data
        self.assertEqual(c["status"], "confirmed")
        self.assertEqual(c["receipt_no"], "HH-" + c["decided_at"][:4] + "-0001")
        bill = self.client.get(bill_url(self.bill["id"])).data
        self.assertEqual((bill["status"], bill["balance"]), ("paid", "0.00"))
        self.assertEqual(self.client.get("/residency/badges/").data["payments"], 0)

    def test_partial_payments(self):
        first = self.report(amount="5000").data
        self.as_secretary()
        self.client.post(f"{SEC_PAYMENTS}{first['id']}/confirm/")
        bill = self.client.get(bill_url(self.bill["id"])).data
        self.assertEqual((bill["status"], bill["amount_paid"], bill["balance"]), ("unpaid", "5000.00", "7000.00"))
        # The secretary records the rest in cash: confirmed straight away
        r = self.client.post(f"/residency/mybuilding/bills/{self.bill['id']}/payments/",
                             {"amount": "7000", "kind": "cash", "paid_on": "2026-10-20"}, format="json")
        self.assertEqual(r.data["status"], "confirmed")
        self.assertEqual(self.client.get(bill_url(self.bill["id"])).data["status"], "paid")

    def test_report_rules(self):
        self.assertIn("amount", self.report(amount="99999").data)                     # more than owed
        self.assertIn("reference", self.report(reference="").data)                    # no ID and no screenshot
        self.assertIn("paid_on", self.report(paid_on="2999-01-01").data)               # future date
        self.assertEqual(self.report(kind="cash", reference="").status_code, 201)     # cash needs no ID
        self.assertEqual(self.report(amount="1").status_code, 400)                    # pending already covers the bill

    def test_reject_with_a_reason_and_reverse_a_confirmed_payment(self):
        p = self.report().data
        self.as_secretary()
        self.assertEqual(self.client.post(f"{SEC_PAYMENTS}{p['id']}/reject/", {"reason": " "}, format="json").status_code, 400)
        r = self.client.post(f"{SEC_PAYMENTS}{p['id']}/reject/", {"reason": "No such transaction in the account"}, format="json")
        self.assertEqual(r.data["status"], "rejected")
        self.client.force_authenticate(self.resident)
        mine = self.client.get(MY_BILLS).data[0]["payments"][0]
        self.assertEqual(mine["reject_reason"], "No such transaction in the account")

        # A confirmed payment can be reversed: the bill reopens and the receipt shows as cancelled
        p2 = self.report(reference="TXN999").data
        self.as_secretary()
        self.client.post(f"{SEC_PAYMENTS}{p2['id']}/confirm/")
        self.client.post(f"{SEC_PAYMENTS}{p2['id']}/reject/", {"reason": "Bounced"}, format="json")
        self.assertEqual(self.client.get(bill_url(self.bill["id"])).data["status"], "unpaid")
        receipt = self.client.get(f"/residency/payments/{p2['id']}/receipt/").data
        self.assertTrue(receipt["cancelled"])

    def test_resident_hears_about_the_decision(self):
        p = self.report().data
        self.client.post("/residency/badges/bills/seen/")
        self.as_secretary()
        self.client.post(f"{SEC_PAYMENTS}{p['id']}/confirm/")
        self.client.force_authenticate(self.resident)
        self.assertEqual(self.client.get("/residency/badges/").data["bills"], 1)

    def test_who_can_report_and_see_receipts(self):
        neighbour = User.objects.create_user("nei", password="x", role="resident", building=self.building)
        self.client.force_authenticate(neighbour)
        self.assertEqual(self.client.post(f"/residency/myunit/bills/{self.bill['id']}/payments/",
                                          {"amount": "1", "kind": "cash", "paid_on": "2026-10-10"}, format="multipart").status_code, 404)
        p = self.report().data
        self.as_secretary()
        self.client.post(f"{SEC_PAYMENTS}{p['id']}/confirm/")
        self.client.force_authenticate(self.resident)
        receipt = self.client.get(f"/residency/payments/{p['id']}/receipt/").data
        self.assertEqual((receipt["amount"], receipt["received_from"], receipt["unit"]["name"]), ("12000.00", "Sita", "3B"))
        self.client.force_authenticate(neighbour)
        self.assertEqual(self.client.get(f"/residency/payments/{p['id']}/receipt/").status_code, 404)

    def test_drafts_cannot_be_paid_by_residents(self):
        self.as_secretary()
        draft = self.client.post(BILLS, {"unit": self.unit.id, "period": "2026-11", "due_date": "2026-11-15"}, format="json").data
        self.client.force_authenticate(self.resident)
        r = self.client.post(f"/residency/myunit/bills/{draft['id']}/payments/",
                             {"amount": "1", "kind": "cash", "paid_on": "2026-10-10"}, format="multipart")
        self.assertEqual(r.status_code, 404)

    def test_dashboard_counts_partial_payments(self):
        from django.utils import timezone
        self.as_secretary()
        month = timezone.localdate().replace(day=1)
        other = Unit.objects.create(floor=self.building.floors.first(), name="3C", area=700, rent=10000)
        bill = self.client.post(BILLS, {"unit": other.id, "period": month.strftime("%Y-%m"),
                                        "due_date": str(month.replace(day=20)), "send": True}, format="json").data
        Bill.objects.filter(pk=self.bill["id"]).delete()   # keep this month to the one bill above
        self.client.post(f"/residency/mybuilding/bills/{bill['id']}/payments/",
                         {"amount": "4000", "kind": "cash", "paid_on": str(month)}, format="json")
        c = self.client.get("/residency/mybuilding/dashboard/").data["collection"]
        self.assertEqual((c["billed"], c["collected"], c["outstanding"]), ("10000.00", "4000.00", "6000.00"))
