"""My profile: details, photo and billing for the signed-in user."""
from django.conf import settings
from django.utils import timezone

from apps.accounts.services import accessible_accounts_for_user
from apps.administration.models import PlatformRoleAssignment
from apps.administration.permissions import user_platform_roles
from apps.billing.models import PaymentRecord
from apps.subscriptions.models import Subscription

from . import zitadel

MAX_AVATAR_BYTES = 2 * 1024 * 1024
NAME_LIMIT = 100


class ProfileInvalid(Exception):
    def __init__(self, fields):
        super().__init__("invalid profile")
        self.fields = fields


def _split_name(user):
    if user.given_name or user.family_name:
        return user.given_name, user.family_name
    first, _, last = (user.name or "").partition(" ")
    return first, last


def avatar_url(user):
    if not user.avatar_updated_at:
        return None
    return f"/api/v1/auth/profile/avatar/?v={int(user.avatar_updated_at.timestamp())}"


def serialize(user):
    first, last = _split_name(user)
    memberships = [
        {"organization": m.organization.name, "role": m.role, "status": m.status, "coverage": m.coverage}
        for m in user.memberships.select_related("organization").order_by("organization__name")
    ]
    return {
        "id": str(user.id),
        "first_name": first,
        "last_name": last,
        "name": user.name,
        "email": user.email,
        "email_verified": user.email_verified,
        "avatar_url": avatar_url(user),
        "member_since": user.created_at.date().isoformat(),
        "memberships": memberships,
        "is_superadmin": PlatformRoleAssignment.Role.SUPER_ADMIN in user_platform_roles(user),
        "can_edit_name": zitadel.enabled() and user.issuer == settings.OIDC["ISSUER"],
    }


def update(user, data):
    """Updates the name in ZITADEL first (it is re-synced from there at every sign-in), then locally."""
    errors = {}
    first = data.get("first_name").strip() if isinstance(data.get("first_name"), str) else ""
    last = data.get("last_name").strip() if isinstance(data.get("last_name"), str) else ""
    if not first:
        errors["first_name"] = "Enter your first name."
    if not last:
        errors["last_name"] = "Enter your last name."
    if len(first) > NAME_LIMIT or len(last) > NAME_LIMIT:
        errors["first_name" if len(first) > NAME_LIMIT else "last_name"] = "Keep names under 100 characters."
    if "email" in data and data.get("email") != user.email:
        errors["email"] = "Your email address can't be changed."
    if errors:
        raise ProfileInvalid(errors)
    zitadel.update_profile(user.zitadel_subject, first_name=first, last_name=last)
    user.given_name, user.family_name, user.name = first, last, f"{first} {last}"
    user.save(update_fields=["given_name", "family_name", "name"])
    return user


def _image_type(head):
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def set_avatar(user, upload):
    if upload is None:
        raise ProfileInvalid({"avatar": "Choose an image to upload."})
    if upload.size > MAX_AVATAR_BYTES:
        raise ProfileInvalid({"avatar": "Images must be 2 MB or smaller."})
    content = upload.read()
    kind = _image_type(content[:16])
    if kind is None:
        raise ProfileInvalid({"avatar": "Use a PNG, JPEG or WebP image."})
    user.avatar, user.avatar_type, user.avatar_updated_at = content, kind, timezone.now()
    user.save(update_fields=["avatar", "avatar_type", "avatar_updated_at"])
    return user


def remove_avatar(user):
    user.avatar, user.avatar_type, user.avatar_updated_at = None, "", None
    user.save(update_fields=["avatar", "avatar_type", "avatar_updated_at"])


def _money(amount):
    return f"{amount:.2f}"


def billing(user):
    """Plans and payments for every account the user can act for (personal + the institution covering them)."""
    accounts = list(accessible_accounts_for_user(user))
    label = {
        a.id: ("Personal" if a.account_type == a.Type.PERSONAL else (a.organization.name if a.organization else "Institution"))
        for a in accounts
    }
    subs = (
        Subscription.objects.filter(account__in=accounts)
        .select_related("product", "package_version__package")
        .order_by("-starts_at")
    )
    pays = PaymentRecord.objects.filter(account__in=accounts).order_by("-created_at")[:20]
    return {
        "subscriptions": [
            {
                "id": str(s.id),
                "account": label.get(s.account_id, ""),
                "product": s.product.name,
                "package": s.package_version.package.name,
                "version": s.package_version.version,
                "status": s.status,
                "billing_interval": s.billing_interval,
                "price": _money(s.package_version.package.price),
                "currency": s.package_version.package.currency,
                "starts_at": s.starts_at.date().isoformat(),
                "expires_at": s.expires_at.date().isoformat() if s.expires_at else None,
                "auto_renew": s.auto_renew,
            }
            for s in subs
        ],
        "payments": [
            {
                "id": str(p.id),
                "account": label.get(p.account_id, ""),
                "amount": _money(p.amount),
                "currency": p.currency,
                "reference": p.reference,
                "status": p.status,
                "created_at": p.created_at.date().isoformat(),
            }
            for p in pays
        ],
    }
