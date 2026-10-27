# accounts/permissions.py
from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsSecretary(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == "secretary"


class IsGuard(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == "guard"


class IsResident(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == "resident"


class IsResidentOrGuard(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role in ("resident", "guard")


class IsSecretaryOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:      # GET, HEAD, OPTIONS: just viewing
            return True
        return request.user.role == "secretary"


class IsGuardOrSecretaryReadOnly(BasePermission):
    """Guards keep the visitor log; the secretary can only read it."""
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.user.role == "guard":
            return True
        return request.user.role == "secretary" and request.method in SAFE_METHODS
