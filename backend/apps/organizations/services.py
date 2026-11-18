"""Organization and membership business logic."""
from django.db import transaction

from apps.accounts.models import Account

from .models import InstitutionalIdentityProvider, Membership, Organization


@transaction.atomic
def create_organization(*, name, slug, zitadel_organization_id=None, owner_user=None, **details):
    """`details` are further Organization fields (type, timezone, contact_email, sign_in_domains, seat_cap, ...)."""
    org = Organization.objects.create(
        name=name,
        slug=slug,
        zitadel_organization_id=zitadel_organization_id,
        **details,
    )
    Account.objects.create(
        account_type=Account.Type.ORGANIZATION,
        organization=org,
        owner_user=owner_user,
    )
    if owner_user is not None:
        Membership.objects.create(
            user=owner_user,
            organization=org,
            role=Membership.Role.OWNER,
            status=Membership.Status.ACTIVE,
        )
    return org


@transaction.atomic
def add_or_update_membership(*, user, organization, role=Membership.Role.MEMBER, status=Membership.Status.ACTIVE):
    membership, _ = Membership.objects.update_or_create(
        user=user,
        organization=organization,
        defaults={"role": role, "status": status},
    )
    return membership


@transaction.atomic
def register_institutional_idp(*, organization, name, protocol, zitadel_idp_id, issuer_or_entity_id, auto_join_role=Membership.Role.MEMBER):
    return InstitutionalIdentityProvider.objects.create(
        organization=organization,
        name=name,
        protocol=protocol,
        zitadel_idp_id=zitadel_idp_id,
        issuer_or_entity_id=issuer_or_entity_id,
        auto_join_role=auto_join_role,
    )
