from rest_framework.permissions import BasePermission

from apps.administration.models import PlatformRoleAssignment

SUPER_ADMIN = PlatformRoleAssignment.Role.SUPER_ADMIN


def is_superadmin(user):
    if not user or not user.is_authenticated or not user.is_active:
        return False
    return PlatformRoleAssignment.objects.filter(user=user, role=SUPER_ADMIN).exists()


class IsSuperadmin(BasePermission):
    """Signed-in, active platform superadmins only. DRF turns an anonymous caller into NotAuthenticated (401)."""

    message = "This account is not a platform superadmin."
    code = "not_superadmin"

    def has_permission(self, request, view):
        return is_superadmin(request.user)
