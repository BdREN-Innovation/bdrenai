"""Per-admin limit on actions that email invitations, shared by the superadmin and portal APIs."""
from django.conf import settings
from rest_framework.throttling import ScopedRateThrottle

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class InvitationSendThrottle(ScopedRateThrottle):
    """`INVITATION_SEND_RATE` per signed-in user across every view that sets `throttle_scope = "invitation_send"`;
    reads on those views are not counted."""

    def get_rate(self):
        return settings.INVITATION_SEND_RATE

    def allow_request(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return super().allow_request(request, view)


class SendsInvitations:
    """APIView mixin: adds InvitationSendThrottle to the view's default throttles."""

    throttle_scope = "invitation_send"

    def get_throttles(self):
        return [*super().get_throttles(), InvitationSendThrottle()]
