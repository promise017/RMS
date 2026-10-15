from django.db import models
from django.core.validators import MinValueValidator
from accounts.models import User
from django.conf import settings    

class Building(models.Model):
    name=models.TextField()
    total_floors=models.PositiveIntegerField(
        validators=[MinValueValidator(1)]
    )

    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)
        if is_new:
       
            Floor.objects.bulk_create(
                [Floor(building=self, number=n) for n in range(1, self.total_floors + 1)]
        )

    def __str__(self):
        return self.name

        
class Floor(models.Model):
    building=models.ForeignKey(
        Building,
        on_delete=models.CASCADE
        )    
    number=models.PositiveIntegerField()

    def __str__(self):
        return f"{self.building.name},floor{self.number}"

class Unit(models.Model):
    floor=models.ForeignKey(
        Floor,
        on_delete=models.CASCADE,
        related_name="unit"
    )
    name=models.CharField(max_length=20)
    area=models.PositiveIntegerField()

    residents= models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name='units',
        limit_choices_to={"role":"resident"}
    )
    @property
    def formatted_area(self):
        if self.area:
            return f"{self.area } sq.ft"

    def __str__(self):
        return f"{self.floor.number} {self.name}"


    rent=models.PositiveIntegerField()

class BuildingImage(models.Model):
    building=models.ForeignKey(
        Building,
        on_delete=models.CASCADE,
        related_name="images"
    )
    description=models.TextField()
    photo=models.ImageField(upload_to="buildings/")
    description=models.TextField()

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
    message=models.TextField()
    created_at=models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering=["-created_at"]



    
    



    



    


