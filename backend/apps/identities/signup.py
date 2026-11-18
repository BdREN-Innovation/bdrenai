"""Website sign-up: validate the form, create the ZITADEL user, mirror it locally, record the institution request."""
import re
import uuid

from django.conf import settings
from django.db import transaction

from apps.audit.services import record_audit
from apps.organizations.models import Membership, Organization

from . import zitadel
from .services import provision_user

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CODE_RE = re.compile(r"^[A-Za-z0-9]{4,12}$")
PASSWORD_RULES = [
    (lambda p: len(p) >= 8, "At least 8 characters"),
    (lambda p: re.search(r"[A-Z]", p), "An upper-case letter"),
    (lambda p: re.search(r"[a-z]", p), "A lower-case letter"),
    (lambda p: re.search(r"[0-9]", p), "A number"),
    (lambda p: re.search(r"[^A-Za-z0-9]", p), "A symbol"),
]
NO_INSTITUTION = "none"
OTHER_INSTITUTION = "other"


class SignupInvalid(Exception):
    def __init__(self, fields):
        super().__init__("invalid sign-up")
        self.fields = fields


def active_institutions():
    return list(
        Organization.objects.filter(status=Organization.Status.ACTIVE).order_by("name").values("id", "name")
    )


def _text(data, key, limit):
    value = data.get(key)
    return value.strip()[:limit] if isinstance(value, str) else ""


def _institution(choice, other, errors):
    if choice in (NO_INSTITUTION, ""):
        if not choice:
            errors["institution"] = "Choose your institution, or None."
        return None
    if choice == OTHER_INSTITUTION:
        if len(other) < 2:
            errors["institution_other"] = "Type your institution's name."
        return None
    try:
        org = Organization.objects.filter(id=uuid.UUID(choice), status=Organization.Status.ACTIVE).first()
    except ValueError:
        org = None
    if org is None:
        errors["institution"] = "Choose an institution from the list."
    return org


def validate(data):
    """Returns cleaned fields or raises SignupInvalid with one message per bad field."""
    errors = {}
    first, last = _text(data, "first_name", 100), _text(data, "last_name", 100)
    email = _text(data, "email", 254).lower()
    password = data.get("password") if isinstance(data.get("password"), str) else ""
    other = _text(data, "institution_other", 200)
    if not first:
        errors["first_name"] = "Enter your first name."
    if not last:
        errors["last_name"] = "Enter your last name."
    if not EMAIL_RE.match(email):
        errors["email"] = "Enter a valid email address."
    missing = [label for rule, label in PASSWORD_RULES if not rule(password)]
    if missing:
        errors["password"] = "Password needs: " + ", ".join(missing).lower() + "."
    if data.get("confirm_password") != password:
        errors["confirm_password"] = "The passwords don't match."
    if data.get("accepted_terms") is not True:
        errors["accepted_terms"] = "You must agree to the terms to continue."
    org = _institution(_text(data, "institution", 64), other, errors)
    if errors:
        raise SignupInvalid(errors)
    return {"first": first, "last": last, "email": email, "password": password, "org": org, "other": other}


def register(data, ip_address=None):
    """Creates the account. Returns (local user, ZITADEL user id). Raises SignupInvalid or zitadel.ZitadelError."""
    f = validate(data)
    zid = zitadel.create_human_user(first_name=f["first"], last_name=f["last"], email=f["email"], password=f["password"])
    claims = {
        "iss": settings.OIDC["ISSUER"],
        "sub": zid,
        "email": f["email"],
        "email_verified": False,
        "given_name": f["first"],
        "family_name": f["last"],
    }
    with transaction.atomic():
        user = provision_user(claims)
        if f["org"] is not None:
            Membership.objects.get_or_create(
                user=user, organization=f["org"], defaults={"status": Membership.Status.PENDING}
            )
        meta = {"organization_id": str(f["org"].id)} if f["org"] else {"institution_other": f["other"] or None}
        record_audit(
            actor=user, action="user.signed_up", target_type="user", target_id=str(user.id),
            metadata=meta, ip_address=ip_address,
        )
    return user, zid


def valid_code(code):
    return isinstance(code, str) and bool(CODE_RE.match(code.strip()))
