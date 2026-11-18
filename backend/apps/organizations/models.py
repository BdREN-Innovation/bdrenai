import uuid

from django.conf import settings
from django.db import models

from .validators import validate_domains, validate_timezone

DEFAULT_TIMEZONE = "Asia/Dhaka"


class Organization(models.Model):
    """Business or academic institution mapped optionally to a ZITADEL organization ID."""

    class Status(models.TextChoices):
        ACTIVE = "active"
        SUSPENDED = "suspended"
        DEACTIVATED = "deactivated"

    class Type(models.TextChoices):
        UNIVERSITY = "university"
        RESEARCH = "research"
        GOVERNMENT = "government"
        SCHOOL = "school"
        OTHER = "other"

    class Sector(models.TextChoices):
        PUBLIC = "public"
        PRIVATE = "private"
        OTHER = "other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=100, unique=True)
    zitadel_organization_id = models.CharField(max_length=128, unique=True, null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    type = models.CharField(max_length=16, choices=Type.choices, default=Type.OTHER)
    sector = models.CharField(max_length=16, choices=Sector.choices, blank=True)
    timezone = models.CharField(max_length=64, default=DEFAULT_TIMEZONE, validators=[validate_timezone])
    contact_email = models.EmailField(blank=True)
    # Lowercase email domains (subdomains included) that confirm a sign-up's choice of this institution;
    # unique across institutions. Invitations accept any email.
    sign_in_domains = models.JSONField(default=list, blank=True, validators=[validate_domains])
    # Institution-wide seat cap across all apps; null = unlimited.
    seat_cap = models.PositiveIntegerField(null=True, blank=True)
    seat_cap_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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
        PENDING = "pending"  # chose this institution at sign-up; awaits a verified email on its domains
        SUSPENDED = "suspended"
        DEPROVISIONED = "deprovisioned"

    class Coverage(models.TextChoices):
        """`institution`: on the institution's package, holding a seat. `none`: affiliated only (free tier or a
        personal plan)."""

        INSTITUTION = "institution"
        NONE = "none"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.MEMBER)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    coverage = models.CharField(max_length=16, choices=Coverage.choices, default=Coverage.INSTITUTION)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "organization"], name="uniq_membership_user_org"),
            models.UniqueConstraint(
                fields=["user"], condition=~models.Q(status="deprovisioned"), name="uniq_membership_one_institution",
            ),
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
