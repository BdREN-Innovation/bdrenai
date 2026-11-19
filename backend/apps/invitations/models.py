import hashlib
import secrets
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.organizations.models import Membership


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def new_token():
    """Returns (raw token for the email link, SHA-256 hex stored in the database)."""
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


class Invitation(models.Model):
    """An emailed, single-use offer to join an institution (or, without one, to open a personal account).

    The email only addresses the invite; acceptance binds it to the signed-in (iss, sub) user.
    """

    class Status(models.TextChoices):
        PENDING = "pending"
        ACCEPTED = "accepted"
        REVOKED = "revoked"
        EXPIRED = "expired"

    class Source(models.TextChoices):
        SUPERADMIN = "superadmin"
        PORTAL = "portal"
        IMPORT = "import"

    class EmailStatus(models.TextChoices):
        """Delivery of the latest email: `sending` in the request, `queued` for the mail worker."""

        QUEUED = "queued"
        SENDING = "sending"
        SENT = "sent"
        FAILED = "failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField()
    name = models.CharField(max_length=255, blank=True)
    organization = models.ForeignKey(
        "organizations.Organization", null=True, blank=True, on_delete=models.CASCADE, related_name="invitations"
    )
    role = models.CharField(max_length=16, choices=Membership.Role.choices, default=Membership.Role.MEMBER)
    token_hash = models.CharField(max_length=64, unique=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    source = models.CharField(max_length=16, choices=Source.choices)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="invitations_sent"
    )
    expires_at = models.DateTimeField()
    sent_count = models.PositiveIntegerField(default=1)
    last_sent_at = models.DateTimeField(default=timezone.now)
    email_status = models.CharField(max_length=16, choices=EmailStatus.choices, default=EmailStatus.QUEUED)
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="invitations_accepted"
    )
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "email"],
                condition=models.Q(status="pending"),
                nulls_distinct=False,  # also one pending individual invite per email
                name="uniq_pending_invitation_org_email",
            ),
        ]
        indexes = [
            models.Index(fields=["organization", "status", "expires_at"], name="invitation_org_status_exp"),
            models.Index(fields=["email"], name="invitation_email"),
            models.Index(
                fields=["last_sent_at"], name="invitation_email_outbox",
                condition=models.Q(email_status__in=["queued", "sending"]),
            ),
        ]

    @property
    def is_expired(self):
        return self.status == self.Status.EXPIRED or (
            self.status == self.Status.PENDING and self.expires_at <= timezone.now()
        )

    @property
    def effective_status(self):
        """`pending` past its expiry is reported as `expired`."""
        return self.Status.EXPIRED if self.is_expired else self.status

    def __str__(self):
        return f"{self.email} -> {self.organization_id or 'individual'} ({self.status})"


class Notice(models.Model):
    """A one-off informational email, such as "you were added to the institution's package", sent by the same
    outbox as invitations: inline after commit up to INVITATION_INLINE_EMAILS, the rest by the mail worker."""

    class Kind(models.TextChoices):
        COVERED = "covered"
        RECEIPT = "receipt"
        EXPIRY_REMINDER = "expiry_reminder"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=32, choices=Kind.choices)
    email = models.EmailField()
    organization = models.ForeignKey(
        "organizations.Organization", null=True, blank=True, on_delete=models.CASCADE, related_name="notices"
    )
    subject = models.CharField(max_length=255)
    body_text = models.TextField()
    body_html = models.TextField()
    email_status = models.CharField(
        max_length=16, choices=Invitation.EmailStatus.choices, default=Invitation.EmailStatus.QUEUED
    )
    created_at = models.DateTimeField(default=timezone.now)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["created_at"], name="notice_outbox",
                condition=models.Q(email_status__in=["queued", "sending"]),
            ),
        ]
