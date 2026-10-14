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
    role = models.CharField(max_length=10, choices=Role.choices, db_index=True)
    middle_name = models.CharField(max_length=50, blank=True)
    phone1 = models.CharField(max_length=20, blank=True)
    phone2 = models.CharField(max_length=20, blank=True)
 
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
    def is_secretary(self):
        return self.role == self.Role.SECRETARY
 
    @property
    def is_guard(self):
        return self.role == self.Role.GUARD
 
    @property
    def is_resident(self):
        return self.role == self.Role.RESIDENT
 
# Create your models here.
