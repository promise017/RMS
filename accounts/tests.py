from rest_framework.test import APIClient, APITestCase

from residency.models import Building
from .models import User

LOGIN = "/accounts/login/"
REFRESH = "/accounts/refresh/"
CHANGE = "/accounts/password/change/"


def reset_url(pk):
    return f"/accounts/members/{pk}/password/reset/"


OLD = "Old-pass-2026"
NEW = "Fresh-pass-2026"


class PasswordTests(APITestCase):
    def setUp(self):
        self.secretary = User.objects.create_user("sec", password=OLD, role="secretary")
        self.building = Building.objects.create(name="Sunrise", total_floors=1, secretary=self.secretary)
        self.resident = User.objects.create_user("res", password=OLD, role="resident", building=self.building)
        self.guard = User.objects.create_user("grd", password=OLD, role="guard", building=self.building)

        other_secretary = User.objects.create_user("sec2", password=OLD, role="secretary")
        other = Building.objects.create(name="Other", total_floors=1, secretary=other_secretary)
        self.stranger = User.objects.create_user("far", password=OLD, role="resident", building=other)

    def login(self, username, password):
        return APIClient().post(LOGIN, {"username": username, "password": password}, format="json")

    def as_logged_in(self, username, password=OLD):
        """A client using a real login (so its refresh token can later be signed out)."""
        tokens = self.login(username, password).data
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        return client, tokens

    def change(self, client, current=OLD, new=NEW, confirm=None):
        return client.post(CHANGE, {
            "current_password": current, "new_password": new, "confirm_password": confirm or new,
        }, format="json")

    # ---------- changing your own password ----------

    def test_resident_changes_own_password(self):
        client, _ = self.as_logged_in("res")
        r = self.change(client)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIn("access", r.data)
        self.assertEqual(self.login("res", OLD).status_code, 401)
        self.assertEqual(self.login("res", NEW).status_code, 200)

    def test_guard_changes_own_password(self):
        client, _ = self.as_logged_in("grd")
        self.assertEqual(self.change(client).status_code, 200)
        self.assertEqual(self.login("grd", NEW).status_code, 200)

    def test_wrong_current_password(self):
        client, _ = self.as_logged_in("res")
        r = self.change(client, current="not-it")
        self.assertEqual(r.status_code, 400)
        self.assertIn("current_password", r.data)
        self.assertEqual(self.login("res", OLD).status_code, 200)

    def test_new_password_rules(self):
        client, _ = self.as_logged_in("res")
        self.assertIn("confirm_password", self.change(client, confirm="Something-else-1").data)
        self.assertIn("new_password", self.change(client, new="123").data)          # too short / numeric
        self.assertIn("new_password", self.change(client, new="password123").data)  # too common
        self.assertIn("new_password", self.change(client, new=OLD).data)            # same as before

    def test_change_signs_out_other_devices(self):
        phone, phone_tokens = self.as_logged_in("res")
        laptop, laptop_tokens = self.as_logged_in("res")
        r = self.change(laptop)
        # The other device's refresh token no longer works...
        self.assertEqual(APIClient().post(REFRESH, {"refresh": phone_tokens["refresh"]}, format="json").status_code, 401)
        self.assertEqual(APIClient().post(REFRESH, {"refresh": laptop_tokens["refresh"]}, format="json").status_code, 401)
        # ...but the fresh tokens handed back keep this device signed in
        self.assertEqual(APIClient().post(REFRESH, {"refresh": r.data["refresh"]}, format="json").status_code, 200)

    def test_secretary_cannot_use_change_password(self):
        client, _ = self.as_logged_in("sec")
        self.assertEqual(self.change(client).status_code, 403)

    def test_must_be_logged_in(self):
        self.assertEqual(self.change(APIClient()).status_code, 401)

    # ---------- the secretary resetting someone's password ----------

    def reset(self, client, member, new=NEW, confirm=None):
        return client.post(reset_url(member.pk), {"new_password": new, "confirm_password": confirm or new}, format="json")

    def test_secretary_resets_resident_and_guard(self):
        client, _ = self.as_logged_in("sec")
        for member in (self.resident, self.guard):
            r = self.reset(client, member)
            self.assertEqual(r.status_code, 200, r.data)
            self.assertEqual(self.login(member.username, NEW).status_code, 200)
            self.assertEqual(self.login(member.username, OLD).status_code, 401)

    def test_reset_signs_the_member_out(self):
        _, tokens = self.as_logged_in("res")
        client, _ = self.as_logged_in("sec")
        self.reset(client, self.resident)
        self.assertEqual(APIClient().post(REFRESH, {"refresh": tokens["refresh"]}, format="json").status_code, 401)

    def test_reset_rules(self):
        client, _ = self.as_logged_in("sec")
        self.assertEqual(self.reset(client, self.resident, confirm="Different-pass-1").status_code, 400)
        self.assertEqual(self.reset(client, self.resident, new="12345678").status_code, 400)

    def test_secretary_only_resets_their_own_residents_and_guards(self):
        client, _ = self.as_logged_in("sec")
        self.assertEqual(self.reset(client, self.stranger).status_code, 404)    # another building
        self.assertEqual(self.reset(client, self.secretary).status_code, 404)   # secretaries: developer only

    def test_residents_and_guards_cannot_reset(self):
        for username, target in (("res", self.guard), ("grd", self.resident)):
            client, _ = self.as_logged_in(username)
            self.assertEqual(self.reset(client, target).status_code, 403)
