from django.contrib.auth.models import AbstractUser
from django.db import models

 
class User(AbstractUser):
    class Role(models.TextChoices):
        SECRETARY = "secretary", "Secretary"
        GUARD = "guard", "Guard"
        RESIDENT = "resident", "Resident"
 
    # Provided by AbstractUser: username, password (hashed), first_name,
    # last_name, email, is_active, is_staff, is_superuser, last_login,
    # date_joined.
    middle_name=models.CharField(max_length=50,blank=True)
    role = models.CharField(max_length=10, choices=Role.choices, db_index=True)
    phone1 = models.CharField(max_length=20, blank=True)
    phone2 = models.CharField(max_length=20, blank=True)
    # Residents and guards join one building with its join code; empty until they do.
    # Secretaries are linked through Building.secretary instead.
    building = models.ForeignKey(
        "residency.Building",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="members",
    )

    class Meta:
        ordering = ["first_name", "last_name", "username"]
 
    def __str__(self):
        return self.full_name or self.username
 
    @property
    def full_name(self):
        """First, middle and last name, skipping any that are empty."""
        parts = [self.first_name, self.middle_name, self.last_name]
        return " ".join(p for p in parts if p)
 
    @property
    def current_building(self):
        """The building this user belongs to, whatever their role."""
        if self.is_secretary:
            return self.buildings.first()
        return self.building

    @property
    def is_secretary(self):
        return self.role == self.Role.SECRETARY
 
    @property
    def is_guard(self):
        return self.role == self.Role.GUARD
 
    @property
    def is_resident(self):
        return self.role == self.Role.RESIDENT

# class BuildingCodes(models.Model):
#     building=models.ForeignKey(
#         Building,
#         on_delete=models.CASCADE
#         related_name="codes")
#     code=models


# Create your models here.
