from django.contrib import admin
from .models import Building,Floor,Unit,BuildingImage, UnitImage


admin.site.register(Building)
admin.site.register(Floor)
admin.site.register(Unit)
admin.site.register(BuildingImage)
admin.site.register(UnitImage)

# Register your models here.
