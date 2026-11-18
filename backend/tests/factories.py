"""Real-database builders shared by the superadmin, portal and invitation tests."""
import re
import uuid
from datetime import timedelta

from django.core import mail
from django.utils import timezone

from apps.accounts.models import Account
from apps.identities.models import User
from apps.invitations.models import Invitation, new_token
from apps.organizations.models import Membership
from apps.organizations.services import create_organization
from apps.packages.models import Package
from apps.packages.services import create_package_with_version
from apps.products.models import Product
from apps.subscriptions.services import create_subscription
from tests.conftest import ISSUER

LINK_RE = re.compile(r"/invite/([A-Za-z0-9_-]+)")


def make_user(email="person@du.ac.bd", *, verified=True, name="Person"):
    return User.objects.create_from_identity(
        issuer=ISSUER, subject=f"s-{uuid.uuid4().hex}", email=email, email_verified=verified, name=name
    )


def make_org(slug="du", *, name=None, **details):
    return create_organization(name=name or f"Institution {slug}", slug=slug, **details)


def add_member(org, user=None, *, role=Membership.Role.MEMBER, status=Membership.Status.ACTIVE, email=None,
               coverage=Membership.Coverage.INSTITUTION):
    user = user or make_user(email or f"{uuid.uuid4().hex[:8]}@du.ac.bd")
    return Membership.objects.create(user=user, organization=org, role=role, status=status, coverage=coverage)


def affiliate(org, email, **kw):
    """An active, not covered (free-tier) member of `org`."""
    return add_member(org, make_user(email), coverage=Membership.Coverage.NONE, **kw)


def give_personal_plan(user, *, product=None, interval=Package.BillingInterval.MONTHLY):
    """A paid personal subscription for `user` (their personal account is created if missing)."""
    product = product or Product.objects.get_or_create(slug="synapse", defaults={"name": "Synapse"})[0]
    account, _ = Account.objects.get_or_create(owner_user=user, account_type=Account.Type.PERSONAL)
    _, version = create_package_with_version(
        product=product, name="Pro", slug=f"pro-{uuid.uuid4().hex[:8]}", price=500, billing_interval=interval,
        limits=[],
    )
    return create_subscription(account=account, package_version=version)


def make_invitation(org, email="invitee@du.ac.bd", *, role=Membership.Role.MEMBER, expired=False,
                    status=Invitation.Status.PENDING, invited_by=None):
    """Invitation written straight to the database, emailed an hour before (or, expired, a week before it
    expired); returns (invitation, raw token)."""
    token, digest = new_token()
    now = timezone.now()
    expires_at = now - timedelta(hours=1) if expired else now + timedelta(days=7)
    invitation = Invitation.objects.create(
        organization=org, email=email, role=role, token_hash=digest, status=status,
        source=Invitation.Source.SUPERADMIN, invited_by=invited_by, expires_at=expires_at,
        last_sent_at=expires_at - timedelta(days=7) if expired else now - timedelta(hours=1),
        email_status=Invitation.EmailStatus.SENT,
    )
    return invitation, token


def sent_tokens():
    """Raw tokens from the invitation links in the test mail outbox, in send order."""
    return [LINK_RE.search(m.body).group(1) for m in mail.outbox]
