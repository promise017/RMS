from django.contrib import admin
from .models import User
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

 

@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    fieldsets = DjangoUserAdmin.fieldsets + (
        ("Griha", {"fields": ("role", "middle_name", "phone1", "phone2", "building")}),
    )
    list_display = ["username", "full_name", "role", "building"]
    list_filter = ["role", "building"]
    add_fieldsets = DjangoUserAdmin.add_fieldsets + (
        ("Griha", {"fields": ("role","first_name", "last_name", "email", "phone1", "phone2")}),
    )

# Register your models here.


