from django.core.exceptions import PermissionDenied
from django.http import JsonResponse
from rest_framework.views import APIView

from apps.organizations.models import Membership

from .models import Account
from .services import accessible_accounts_for_user, resolve_authorized_account


class AccountContextsView(APIView):
    """Lists all account contexts (personal + organizations) available to the authenticated user."""

    def get(self, request):
        accounts = accessible_accounts_for_user(request.user)
        roles_by_org = dict(
            Membership.objects.filter(user=request.user, status=Membership.Status.ACTIVE)
            .values_list("organization_id", "role")
        )
        active = resolve_authorized_account(request.user, session=request.session)
        items = []
        for a in accounts:
            items.append({
                "account_id": str(a.id),
                "account_type": a.account_type,
                "organization": (
                    {"id": str(a.organization.id), "name": a.organization.name, "slug": a.organization.slug}
                    if a.organization_id else None
                ),
                "role": "owner" if a.account_type == Account.Type.PERSONAL else roles_by_org.get(a.organization_id),
                "is_active_context": a.id == active.id,
            })
        return JsonResponse({"active_account_id": str(active.id), "contexts": items})


class SwitchAccountContextView(APIView):
    """Switches the active account context stored in the server-side session after verifying membership."""

    def post(self, request):
        account_id = request.data.get("account_id")
        if not account_id:
            return JsonResponse({"error": "account_id_required"}, status=400)
        try:
            acct = resolve_authorized_account(request.user, account_id=account_id)
        except PermissionDenied:
            return JsonResponse({"error": "forbidden_account_context"}, status=403)
        request.session["active_account_id"] = str(acct.id)
        return JsonResponse({
            "active_account_id": str(acct.id),
            "account_type": acct.account_type,
            "organization_slug": acct.organization.slug if acct.organization_id else None,
        })
