"""First-login provisioning, institutional federation mapping, and explicit account linking."""
import logging

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import Account
from apps.organizations.models import InstitutionalIdentityProvider, Membership, Organization

from .models import ExternalIdentity, User

log = logging.getLogger(__name__)


class UserNotAllowed(Exception):
    pass


class AccountLinkingError(Exception):
    pass


def _sync_institutional_organization(user, claims):
    """If the user authenticated under a ZITADEL organization linked to a BDREN Organization,
    verify institutional status and provision/validate their Membership.
    """
    zitadel_org_id = claims.get("urn:zitadel:iam:org:id") or claims.get("org_id")
    if not zitadel_org_id:
        return None
    org = Organization.objects.filter(zitadel_organization_id=str(zitadel_org_id)).first()
    if org is None:
        return None
    if org.status != Organization.Status.ACTIVE:
        raise UserNotAllowed("Institutional organization is disabled")

    membership = Membership.objects.select_for_update().filter(user=user, organization=org).first()
    if membership is not None:
        if membership.status == Membership.Status.PENDING:
            # Signing in through the institution's own login proves membership: approve the sign-up request.
            membership.status = Membership.Status.ACTIVE
            membership.save(update_fields=["status"])
            return org
        if membership.status != Membership.Status.ACTIVE:
            raise UserNotAllowed("Institutional membership is disabled or deprovisioned")
        return org

    # Determine default role from active InstitutionalIdentityProvider if configured
    idp_id = claims.get("urn:zitadel:iam:user:idp:id")
    role = Membership.Role.MEMBER
    if idp_id:
        idp = InstitutionalIdentityProvider.objects.filter(organization=org, zitadel_idp_id=str(idp_id)).first()
        if idp and idp.status != InstitutionalIdentityProvider.Status.ACTIVE:
            raise UserNotAllowed("Upstream institutional identity provider is disabled")
        if idp:
            role = idp.auto_join_role

    Membership.objects.create(user=user, organization=org, role=role, status=Membership.Status.ACTIVE)
    return org


def provision_user(claims):
    """Map validated claims -> User by (issuer, subject) or verified ExternalIdentity ONLY.
    Never matches or links by email address.
    """
    issuer, subject = claims["iss"], str(claims["sub"])
    profile = {
        "email": claims.get("email", "") or "",
        "email_verified": bool(claims.get("email_verified", False)),
        "name": (
            claims.get("name")
            or " ".join(filter(None, [claims.get("given_name"), claims.get("family_name")]))
            or ""
        ),
        "last_login_sync_at": timezone.now(),
    }
    for key in ("given_name", "family_name"):
        if claims.get(key):
            profile[key] = claims[key]
    with transaction.atomic():
        # 1. Check if this (issuer, subject) is already linked as a verified ExternalIdentity
        ext = (
            ExternalIdentity.objects.select_related("user")
            .filter(issuer=issuer, subject=subject)
            .first()
        )
        if ext is not None:
            user = User.objects.select_for_update().get(id=ext.user_id)
            created = False
        else:
            user = User.objects.select_for_update().filter(issuer=issuer, zitadel_subject=subject).first()
            created = False
            if user is None:
                try:
                    with transaction.atomic():
                        user = User.objects.create_from_identity(issuer=issuer, subject=subject, **profile)
                        created = True
                except IntegrityError:
                    user = User.objects.select_for_update().get(issuer=issuer, zitadel_subject=subject)

        if not user.is_active:
            raise UserNotAllowed("User is not active")

        if not created:
            for k, v in profile.items():
                setattr(user, k, v)
            user.save(update_fields=list(profile))

        Account.objects.get_or_create(owner_user=user, account_type=Account.Type.PERSONAL)
        ExternalIdentity.objects.get_or_create(
            issuer=issuer,
            subject=subject,
            defaults={"user": user, "provider_type": ExternalIdentity.ProviderType.ZITADEL},
        )
        _sync_institutional_organization(user, claims)

    if created:
        log.info("provisioned user %s", user.id)
    return user


def link_external_identity(*, user, claims, provider_type=ExternalIdentity.ProviderType.OIDC):
    """Explicitly link a cryptographically verified (issuer, subject) to an authenticated user.
    Refuses if that identity already belongs to another User.
    """
    if not user or not user.is_authenticated or not user.is_active:
        raise AccountLinkingError("Authenticated active user required")

    issuer, subject = claims["iss"], str(claims["sub"])
    with transaction.atomic():
        existing_primary = User.objects.filter(issuer=issuer, zitadel_subject=subject).exclude(id=user.id).first()
        if existing_primary is not None:
            raise AccountLinkingError("Identity is already bound to another user account")

        existing_ext = ExternalIdentity.objects.select_for_update().filter(issuer=issuer, subject=subject).first()
        if existing_ext is not None:
            if existing_ext.user_id != user.id:
                raise AccountLinkingError("Identity is already linked to another user account")
            ext = existing_ext
        else:
            ext = ExternalIdentity.objects.create(
                user=user,
                issuer=issuer,
                subject=subject,
                provider_type=provider_type,
            )
        _sync_institutional_organization(user, claims)
        return ext
