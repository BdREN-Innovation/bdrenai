"""Institution-admin portal API (`/api/v1/portal/`, docs/SUPERADMIN_API.md "Portal API")."""
from django.http import JsonResponse
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from apps.audit.services import client_ip
from apps.invitations.errors import ContractErrors, ServiceError
from apps.invitations.shapes import serialize_member
from apps.invitations.throttles import SendsInvitations

from . import services


def _invited(invited, status=200):
    return JsonResponse(
        {"invitation": services.portal_invitation(invited.invitation), "email_sent": invited.email_sent},
        status=status,
    )


class PortalView(ContractErrors, APIView):
    """Signed-in, active users only (401 otherwise); `<slug>` routes also need portal access to that institution."""

    permission_classes = [AllowAny]  # sign-in is checked in initial() so anonymous callers get 401, not DRF's 403

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not (request.user.is_authenticated and request.user.is_active):
            raise ServiceError("not_authenticated", "Sign in to continue.", status=401)
        if "slug" in kwargs:
            self.organization = services.access(request.user, kwargs["slug"])


class InstitutionsView(PortalView):
    def get(self, request):
        return JsonResponse(services.administered_institutions(request.user), safe=False)


class InstitutionView(PortalView):
    def get(self, request, slug):
        return JsonResponse(services.institution_summary(self.organization))


class MembersView(PortalView):
    def get(self, request, slug):
        return JsonResponse(services.list_members(self.organization, request.GET))


class MemberView(PortalView):
    def patch(self, request, slug, membership_id):
        membership = services.update_member(request.user, slug, membership_id, request.data, client_ip(request))
        return JsonResponse(serialize_member(membership))


class MemberRemoveView(PortalView):
    def post(self, request, slug, membership_id):
        membership = services.remove_member(request.user, slug, membership_id, request.data, client_ip(request))
        return JsonResponse(serialize_member(membership))


class InvitationsView(SendsInvitations, PortalView):
    def get(self, request, slug):
        return JsonResponse(services.list_invitations(self.organization, request.GET))

    def post(self, request, slug):
        return _invited(services.invite(request.user, slug, request.data, client_ip(request)), status=201)


class InvitationResendView(SendsInvitations, PortalView):
    def post(self, request, slug, invitation_id):
        return _invited(services.resend(request.user, slug, invitation_id, client_ip(request)))


class InvitationRevokeView(PortalView):
    def post(self, request, slug, invitation_id):
        invitation = services.revoke(request.user, slug, invitation_id, request.data, client_ip(request))
        return JsonResponse({"invitation": services.portal_invitation(invitation)})


class ImportView(SendsInvitations, PortalView):
    def post(self, request, slug):
        return JsonResponse(services.import_members(request.user, slug, request.data, client_ip(request)).body())
