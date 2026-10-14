from django.shortcuts import render
from rest_framework_simplejwt.views import TokenObtainPairView
from .serializers import LoginSerializer
from django.http import HttpResponse


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
# Create your views here.
