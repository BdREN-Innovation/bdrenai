"""Account context resolution and authorization."""
from django.core.exceptions import PermissionDenied

from apps.organizations.models import Membership, Organization

from .models import Account


def accessible_accounts_for_user(user):
    """Returns all active Accounts the user may access: their personal account, and the organization account of the
    institution covering them (an active, covered membership in an active institution)."""
    if not user or not user.is_authenticated or not user.is_active:
        return Account.objects.none()
    active_org_ids = Membership.objects.filter(
        user=user,
        status=Membership.Status.ACTIVE,
        coverage=Membership.Coverage.INSTITUTION,
        organization__status=Organization.Status.ACTIVE,
    ).values_list("organization_id", flat=True)
    return Account.objects.filter(status=Account.Status.ACTIVE).filter(
        models_q_personal_or_org(user, active_org_ids)
    ).select_related("organization")


def models_q_personal_or_org(user, org_ids):
    from django.db.models import Q
    return Q(account_type=Account.Type.PERSONAL, owner_user=user) | Q(
        account_type=Account.Type.ORGANIZATION, organization_id__in=org_ids
    )


def resolve_authorized_account(user, account_id=None, session=None):
    """Validates that `user` is allowed to use `account_id` (or session active account, or default personal).
    A session's account the user lost access to since (for example no longer covered) falls back to personal."""
    qs = accessible_accounts_for_user(user)
    if account_id:
        acct = qs.filter(id=account_id).first()
        if acct is None:
            raise PermissionDenied("User does not have active access to the requested account")
        return acct
    session_id = session.get("active_account_id") if session is not None else None
    acct = qs.filter(id=session_id).first() if session_id else None
    if acct is not None:
        return acct
    personal = qs.filter(account_type=Account.Type.PERSONAL, owner_user=user).first()
    if personal is None:
        raise PermissionDenied("No active personal account available")
    return personal
