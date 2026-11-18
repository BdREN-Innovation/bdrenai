import uuid

from django.conf import settings
from django.db import models


class Organization(models.Model):
    """Business or academic institution mapped optionally to a ZITADEL organization ID."""

    class Status(models.TextChoices):
        ACTIVE = "active"
        SUSPENDED = "suspended"
        DEACTIVATED = "deactivated"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=100, unique=True)
    zitadel_organization_id = models.CharField(max_length=128, unique=True, null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.slug})"


class Membership(models.Model):
    """Associates a User with an Organization and a specific role."""

    class Role(models.TextChoices):
        OWNER = "owner"
        ADMIN = "admin"
        BILLING = "billing"
        MEMBER = "member"

    class Status(models.TextChoices):
        ACTIVE = "active"
        PENDING = "pending"  # asked to join at sign-up; grants nothing until an admin approves
        SUSPENDED = "suspended"
        DEPROVISIONED = "deprovisioned"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.MEMBER)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "organization"], name="uniq_membership_user_org"),
        ]


class InstitutionalIdentityProvider(models.Model):
    """Tracks an upstream SAML 2.0 or OIDC identity provider brokered by ZITADEL for an Organization."""

    class Protocol(models.TextChoices):
        OIDC = "oidc"
        SAML = "saml"

    class Status(models.TextChoices):
        ACTIVE = "active"
        DISABLED = "disabled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="identity_providers")
    name = models.CharField(max_length=255)
    protocol = models.CharField(max_length=16, choices=Protocol.choices)
    zitadel_idp_id = models.CharField(max_length=128, unique=True)
    issuer_or_entity_id = models.CharField(max_length=512)
    auto_join_role = models.CharField(max_length=16, choices=Membership.Role.choices, default=Membership.Role.MEMBER)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
