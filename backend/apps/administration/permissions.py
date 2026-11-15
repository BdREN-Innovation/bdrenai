from rest_framework.permissions import BasePermission

from .models import PlatformRoleAssignment


def user_platform_roles(user) -> set[str]:
    if not user or not user.is_authenticated or not user.is_active:
        return set()
    return set(PlatformRoleAssignment.objects.filter(user=user).values_list("role", flat=True))


class HasPlatformRole(BasePermission):
    """Enforces Role-Based Access Control (RBAC). Platform Super Admin always has access."""

    allowed_roles: set[str] = set()

    def has_permission(self, request, view):
        roles = user_platform_roles(request.user)
        if PlatformRoleAssignment.Role.SUPER_ADMIN in roles:
            return True
        required = getattr(view, "required_roles", self.allowed_roles)
        return bool(roles & set(required))
