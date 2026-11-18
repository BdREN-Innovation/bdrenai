"""Superadmin API (`/api/v1/superadmin/`, docs/SUPERADMIN_API.md). Thin views over `services`."""
from django.http import HttpResponse, JsonResponse
from rest_framework.views import APIView

from apps.administration.permissions import user_platform_roles
from apps.audit.models import AuditLog
from apps.audit.services import client_ip
from apps.identities.models import User
from apps.invitations import services as invitations
from apps.invitations.errors import ContractErrors, ServiceError, invalid
from apps.invitations.models import Invitation
from apps.invitations.shapes import paginated, serialize_invitation, serialize_member
from apps.invitations.throttles import SendsInvitations
from apps.organizations import directory
from apps.organizations.models import Membership, Organization
from apps.packages import services as packages
from apps.packages.models import Package

from . import lists, services, shapes
from .permissions import IsSuperadmin

SOURCE = services.SOURCE
INVITATION_STATUSES = frozenset(Invitation.Status.values)
MEMBERSHIP_ROLES = frozenset(Membership.Role.values)
PACKAGE_KINDS = frozenset(Package.Kind.values)
PACKAGE_STATUSES = frozenset(Package.Status.values)


def payload(request):
    data = request.data
    if not isinstance(data, dict):
        raise invalid({"non_field": "Send a JSON object."})
    return data


def flag(data, name, default=False):
    value = data.get(name, default)
    if not isinstance(value, bool):
        raise invalid({name: "Use true or false."})
    return value


def _invitation(pk):
    invitation = services.invitations().filter(pk=pk).first()
    if invitation is None:
        raise services.not_found("No invitation with this id.")
    return invitation


def _membership(pk):
    membership = Membership.objects.select_related("organization", "user").filter(pk=pk).first()
    if membership is None:
        raise services.not_found("No membership with this id.")
    return membership


def _plain_institution(slug):
    org = Organization.objects.filter(slug=slug).first()
    if org is None:
        raise services.not_found("No institution with this slug.")
    return org


def _invited_body(invited, org):
    body = {
        "invitation": serialize_invitation(invited.invitation),
        "institution": shapes.institution_detail(services.load_institution(org.slug)) if org else None,
        "email_sent": invited.email_sent,
    }
    if invited.warning:
        body["warning"] = invited.warning
    return body


class SuperadminView(ContractErrors, APIView):
    """Platform superadmins only; every error leaves as `{"error", "message", "fields"?}`."""

    permission_classes = [IsSuperadmin]

    def error_code(self, exc, status):
        code = super().error_code(exc, status)
        detail = getattr(exc, "detail", None)
        if code == "forbidden" and isinstance(detail, str) and getattr(detail, "code", None) == IsSuperadmin.code:
            return IsSuperadmin.code
        return code


# ---------------------------------------------------------------- session and dashboard

class SessionView(SuperadminView):
    def get(self, request):
        return JsonResponse(shapes.session(request.user, user_platform_roles(request.user)))


class DashboardView(SuperadminView):
    def get(self, request):
        return JsonResponse(services.dashboard())


# ---------------------------------------------------------------- institutions

class InstitutionsView(SendsInvitations, SuperadminView):
    def get(self, request):
        qs = services.institution_list(
            q=lists.text(request), status=lists.choice(request, "status", Organization.Status.values),
        )
        return JsonResponse(paginated(qs, request.GET, shapes.institution_row))

    def post(self, request):
        data = payload(request)
        created = invitations.create_institution(
            data=data, admin=data.get("admin"), actor=request.user, ip_address=client_ip(request), source=SOURCE,
        )
        invited = created.invited
        body = {
            "institution": shapes.institution_detail(services.load_institution(created.organization.slug)),
            "invitation": serialize_invitation(invited.invitation) if invited else None,
            "email_sent": invited.email_sent if invited else False,
        }
        return JsonResponse(body, status=201)


class InstitutionOptionsView(SuperadminView):
    def get(self, request):
        options = services.institution_options(lists.text(request))
        return JsonResponse({"results": [shapes.institution_option(org) for org in options]})


class InstitutionDirectoryView(SuperadminView):
    def get(self, request):
        return JsonResponse({"results": directory.search(lists.text(request))})


class InstitutionView(SuperadminView):
    def get(self, request, slug):
        return JsonResponse(shapes.institution_detail(services.load_institution(slug)))

    def patch(self, request, slug):
        org = services.update_institution(
            _plain_institution(slug), payload(request), actor=request.user, ip_address=client_ip(request),
        )
        body = shapes.institution_detail(services.load_institution(org.slug))
        if org.seat_cap is not None and body["seats"]["used"] > org.seat_cap:
            body["warning"] = "over_cap"
        return JsonResponse(body)


class InstitutionStatusView(SuperadminView):
    """POST institutions/<slug>/suspend|reactivate|deactivate/; the action comes from the URL."""

    action = None

    def post(self, request, slug):
        data = payload(request)
        services.change_institution_status(
            _plain_institution(slug), self.action, reason=data.get("reason"), confirm=data.get("confirm"),
            actor=request.user, ip_address=client_ip(request),
        )
        return JsonResponse(shapes.institution_detail(services.load_institution(slug)))


class InstitutionMembersView(SuperadminView):
    def get(self, request, slug):
        qs = invitations.filter_members(
            _plain_institution(slug),
            q=lists.text(request),
            status=lists.choice(request, "status", Membership.Status.values),
            role=lists.choice(request, "role", MEMBERSHIP_ROLES),
        )
        return JsonResponse(paginated(qs, request.GET, serialize_member))


class InstitutionHistoryView(SuperadminView):
    def get(self, request, slug):
        qs = services.institution_history(_plain_institution(slug))
        return JsonResponse(paginated(qs, request.GET, shapes.audit_entry))


class InstitutionImportView(SendsInvitations, SuperadminView):
    def post(self, request, slug):
        data = payload(request)
        result = invitations.import_rows(
            _plain_institution(slug), data.get("rows"), dry_run=flag(data, "dry_run", default=True),
            source=SOURCE, actor=request.user, ip_address=client_ip(request),
        )
        return JsonResponse(result.body())


# ---------------------------------------------------------------- memberships

class MembershipView(SuperadminView):
    def patch(self, request, pk):
        data = payload(request)
        membership = invitations.update_membership(
            _membership(pk), source=SOURCE, actor=request.user, role=data.get("role"), status=data.get("status"),
            reason=services.clean_reason(data.get("reason")), force=flag(data, "force"), ip_address=client_ip(request),
        )
        return JsonResponse(serialize_member(membership))


class MembershipRemoveView(SuperadminView):
    def post(self, request, pk):
        data = payload(request)
        membership = invitations.remove_membership(
            _membership(pk), source=SOURCE, actor=request.user,
            reason=services.clean_reason(data.get("reason"), required=True), force=flag(data, "force"),
            ip_address=client_ip(request),
        )
        return JsonResponse(serialize_member(membership))


# ---------------------------------------------------------------- users

class UsersView(SuperadminView):
    def get(self, request):
        qs = services.user_list(
            q=lists.text(request),
            status=lists.choice(request, "status", User.Status.values),
            institution=lists.text(request, "institution") or None,
            role=lists.choice(request, "role", MEMBERSHIP_ROLES),
        )
        return JsonResponse(paginated(qs, request.GET, shapes.user_row))


class UserView(SuperadminView):
    def get(self, request, pk):
        user = services.load_user(pk)
        return JsonResponse(shapes.user_detail(user, services.user_activity(user)))

    def patch(self, request, pk):
        data = payload(request)
        user = User.objects.filter(pk=pk).first()
        if user is None:
            raise services.not_found("No user with this id.")
        services.set_user_status(
            user, status=data.get("status"), reason=data.get("reason"),
            actor=request.user, ip_address=client_ip(request),
        )
        user = services.load_user(pk)
        return JsonResponse(shapes.user_detail(user, services.user_activity(user)))


# ---------------------------------------------------------------- invitations

class InvitationsView(SendsInvitations, SuperadminView):
    def get(self, request):
        qs = services.invitation_list(
            q=lists.text(request),
            status=lists.choice(request, "status", INVITATION_STATUSES),
            institution=lists.text(request, "institution") or None,
        )
        return JsonResponse(paginated(qs, request.GET, serialize_invitation))

    def post(self, request):
        data = payload(request)
        if data.get("new_institution") is not None:
            return self._with_new_institution(request, data)
        if "institution" not in data:
            raise invalid({"institution": "Choose an institution, or send null to invite an individual."})
        org = None if data["institution"] is None else services.find_institution(data["institution"])
        if org is not None and "role" not in data:
            raise invalid({"role": "Choose a role."})
        invited = invitations.create_invitation(
            organization=org, email=data.get("email"), name=data.get("name", ""), role=data.get("role"),
            source=SOURCE, actor=request.user, ip_address=client_ip(request),
        )
        return JsonResponse(_invited_body(invited, org), status=201)

    def _with_new_institution(self, request, data):
        """The institution and its first invitation in one transaction (`create_institution`)."""
        if not isinstance(data["new_institution"], dict):
            raise invalid({"new_institution": "Give the new institution's details."})
        if "role" not in data:
            raise invalid({"role": "Choose a role."})
        try:
            created = invitations.create_institution(
                data=data["new_institution"], admin={"email": data.get("email"), "name": data.get("name", "")},
                admin_role=data.get("role"), actor=request.user, ip_address=client_ip(request), source=SOURCE,
            )
        except ServiceError as e:
            e.fields = {_invite_field(k): v for k, v in e.fields.items()}
            raise
        return JsonResponse(_invited_body(created.invited, created.organization), status=201)


def _invite_field(key):
    """`create_institution` reports invitation fields as `admin.<f>`; here they are top level, and the
    institution's own fields sit under `new_institution.`."""
    return key.removeprefix("admin.") if key.startswith("admin.") else f"new_institution.{key}"


class InvitationResendView(SendsInvitations, SuperadminView):
    def post(self, request, pk):
        invited = invitations.resend_invitation(
            _invitation(pk), source=SOURCE, actor=request.user, ip_address=client_ip(request),
        )
        return JsonResponse({"invitation": serialize_invitation(_invitation(pk)), "email_sent": invited.email_sent})


class InvitationRevokeView(SuperadminView):
    def post(self, request, pk):
        data = payload(request)
        invitations.revoke_invitation(
            _invitation(pk), source=SOURCE, actor=request.user, reason=services.clean_reason(data.get("reason")),
            ip_address=client_ip(request),
        )
        return JsonResponse({"invitation": serialize_invitation(_invitation(pk))})


class InvitationsResendExpiredView(SendsInvitations, SuperadminView):
    def post(self, request):
        data = payload(request)
        slug = data.get("institution")
        org = services.find_institution(slug) if slug is not None else None
        result = invitations.resend_expired(organization=org, source=SOURCE, actor=request.user, ip_address=client_ip(request))
        return JsonResponse(result.body())


# ---------------------------------------------------------------- admins and audit

class AdminsView(SuperadminView):
    def get(self, request):
        return JsonResponse({"results": [shapes.platform_admin(a) for a in services.platform_admins()]})

    def post(self, request):
        data = payload(request)
        user = services.find_user(user_id=data.get("user_id"), email=data.get("email"))
        assignment = services.grant_superadmin(user, actor=request.user, ip_address=client_ip(request))
        return JsonResponse(shapes.platform_admin(assignment), status=201)


class AdminView(SuperadminView):
    def delete(self, request, user_id):
        services.revoke_superadmin(user_id, actor=request.user, ip_address=client_ip(request))
        return HttpResponse(status=204)


class AuditView(SuperadminView):
    def get(self, request):
        qs = services.audit_entries(
            q=lists.text(request),
            action=lists.text(request, "action") or None,
            actor=lists.uuid_value(request, "actor"),
            role=lists.choice(request, "role", AuditLog.ActorRole.values),
            target_type=lists.text(request, "target_type") or None,
            target_id=lists.text(request, "target_id") or None,
            since=lists.moment(request, "from"),
            until=lists.moment(request, "to", end_of_day=True),
        )
        return JsonResponse(paginated(qs, request.GET, shapes.audit_entry))


class AuditFiltersView(SuperadminView):
    def get(self, request):
        return JsonResponse(services.audit_filter_options())


# ---------------------------------------------------------------- configuration: apps and features

class ConfigAppsView(SuperadminView):
    def get(self, request):
        return JsonResponse({"results": [shapes.app(product) for product in packages.apps()]})


class ConfigAppView(SuperadminView):
    def patch(self, request, slug):
        packages.update_app(slug, payload(request), actor=request.user, ip_address=client_ip(request))
        return JsonResponse(shapes.app(packages.load_app(slug)))


class ConfigAppFeaturesView(SuperadminView):
    def post(self, request, slug):
        feature = packages.create_feature(slug, payload(request), actor=request.user, ip_address=client_ip(request))
        return JsonResponse(shapes.feature(feature), status=201)


class ConfigFeatureView(SuperadminView):
    def patch(self, request, pk):
        feature = packages.update_feature(pk, payload(request), actor=request.user, ip_address=client_ip(request))
        return JsonResponse(shapes.feature(feature))


# ---------------------------------------------------------------- configuration: packages

def _package_detail(pk):
    return shapes.package_detail(packages.load_package(pk))


class ConfigPackagesView(SuperadminView):
    def get(self, request):
        qs = packages.package_list(
            kind=lists.choice(request, "kind", PACKAGE_KINDS),
            app=lists.text(request, "app") or None,
            status=lists.choice(request, "status", PACKAGE_STATUSES),
            q=lists.text(request),
        )
        return JsonResponse(paginated(qs, request.GET, shapes.package_list_row))

    def post(self, request):
        pkg = packages.create_package(payload(request), actor=request.user, ip_address=client_ip(request))
        return JsonResponse(_package_detail(pkg.pk), status=201)


class ConfigPackageView(SuperadminView):
    def get(self, request, pk):
        return JsonResponse(_package_detail(pk))

    def patch(self, request, pk):
        packages.update_presentation(pk, payload(request), actor=request.user, ip_address=client_ip(request))
        return JsonResponse(_package_detail(pk))


class ConfigPackagePreviewView(SuperadminView):
    def post(self, request, pk):
        changes, subscriptions = packages.preview_version(pk, payload(request))
        return JsonResponse({
            "changes": [shapes.package_change(change) for change in changes],
            "affected": shapes.affected(subscriptions),
        })


class ConfigPackageVersionsView(SuperadminView):
    def post(self, request, pk):
        stats = packages.publish_version(pk, payload(request), actor=request.user, ip_address=client_ip(request))
        return JsonResponse({"package": _package_detail(pk), **stats}, status=201)


class ConfigPackageArchiveView(SuperadminView):
    """POST config/packages/<id>/archive|restore/; `archived` comes from the URL."""

    archived = None

    def post(self, request, pk):
        data = payload(request)
        packages.set_archived(
            pk, self.archived, reason=services.clean_reason(data.get("reason"), required=True),
            actor=request.user, ip_address=client_ip(request),
        )
        return JsonResponse(_package_detail(pk))
