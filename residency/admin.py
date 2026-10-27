from django.contrib import admin
from .models import (
    Building, Floor, Unit, BuildingImage, UnitImage, Notice, Bill, BillItem,
    ResidentProfile, Complaint, EntryLog,
)


@admin.register(Complaint)
class ComplaintAdmin(admin.ModelAdmin):
    list_display = ["title", "building", "unit", "raised_by", "is_anonymous", "status", "created_at"]
    list_filter = ["status", "is_anonymous", "building"]


@admin.register(EntryLog)
class EntryLogAdmin(admin.ModelAdmin):
    list_display = ["name", "entry_type", "building", "unit", "check_in", "check_out", "logged_by", "checked_out_by"]
    list_filter = ["entry_type", "building"]
    search_fields = ["name", "phone", "vehicle_no"]


class BillItemInline(admin.TabularInline):
    model = BillItem
    extra = 1


@admin.register(Bill)
class BillAdmin(admin.ModelAdmin):
    list_display = ["unit", "period", "due_date", "status", "total"]
    list_filter = ["status", "period"]
    inlines = [BillItemInline]


@admin.register(Building)
class BuildingAdmin(admin.ModelAdmin):
    list_display = ["name", "total_floors", "secretary", "join_code", "code_active"]
    # join_code is editable=False, so the admin form hides it unless it's read-only
    readonly_fields = ["join_code", "created_at"]

admin.site.register(Floor)
admin.site.register(Unit)
admin.site.register(BuildingImage)
admin.site.register(UnitImage)
admin.site.register(Notice)
admin.site.register(ResidentProfile)

# Register your models here.
