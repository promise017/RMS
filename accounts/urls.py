from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import LoginView, SignupView, MeView, ChangePasswordView, ResetMemberPasswordView

urlpatterns = [
    path("login/", LoginView.as_view(), name="login"),
    path("signup/", SignupView.as_view(), name="signup"),
    path("refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", MeView.as_view(), name="me"),
    path("password/change/", ChangePasswordView.as_view(), name="change_password"),
    path("members/<int:pk>/password/reset/", ResetMemberPasswordView.as_view(), name="reset_member_password"),
]
