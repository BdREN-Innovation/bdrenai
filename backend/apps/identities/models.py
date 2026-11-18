import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.db import models


class UserManager(BaseUserManager):
    def create_from_identity(self, *, issuer, subject, **extra):
        user = self.model(issuer=issuer, zitadel_subject=subject, **extra)
        user.set_unusable_password()  # passwords live only in ZITADEL
        user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    """Business profile keyed by the validated ZITADEL (issuer, subject). Never by email."""

    class Status(models.TextChoices):
        ACTIVE = "active"
        SUSPENDED = "suspended"
        DEACTIVATED = "deactivated"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issuer = models.CharField(max_length=255)
    zitadel_subject = models.CharField(max_length=255)
    email = models.EmailField(blank=True)  # informational, NOT unique, NOT an identifier
    email_verified = models.BooleanField(default=False)
    name = models.CharField(max_length=255, blank=True)
    given_name = models.CharField(max_length=100, blank=True)
    family_name = models.CharField(max_length=100, blank=True)
    # Profile photo kept in the database: small (<= 2 MB), validated by file signature, served only to its owner.
    avatar = models.BinaryField(null=True, blank=True, editable=False)
    avatar_type = models.CharField(max_length=32, blank=True)
    avatar_updated_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    last_login_sync_at = models.DateTimeField(null=True, blank=True)

    USERNAME_FIELD = "id"
    objects = UserManager()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["issuer", "zitadel_subject"], name="uniq_user_issuer_subject"),
        ]

    @property
    def is_active(self):  # used by Django auth backends / session loading
        return self.status == self.Status.ACTIVE

    def __str__(self):
        return f"{self.name or self.email or self.id}"


class ExternalIdentity(models.Model):
    """An upstream (institutional) identity linked to a user. Linking is explicit, never by email match."""

    class ProviderType(models.TextChoices):
        ZITADEL = "zitadel"
        OIDC = "oidc"
        SAML = "saml"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="external_identities")
    issuer = models.CharField(max_length=255)
    subject = models.CharField(max_length=255)
    provider_type = models.CharField(max_length=16, choices=ProviderType.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["issuer", "subject"], name="uniq_externalidentity_issuer_subject"),
        ]


class UserSession(models.Model):
    """Which server-side session belongs to which user, written at sign-in, so signing a user out everywhere
    deletes only their sessions instead of decoding every session on the platform."""

    session_key = models.CharField(max_length=40, primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="server_sessions")
    created_at = models.DateTimeField(auto_now_add=True)
