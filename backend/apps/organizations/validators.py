"""Validation of institution settings (timezone, sign-in domains, slug)."""
import re
from functools import lru_cache
from zoneinfo import available_timezones

from django.core.exceptions import ValidationError

SLUG_RE = re.compile(r"^[a-z0-9-]{2,64}$")
DOMAIN_RE = re.compile(r"^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
MAX_SIGN_IN_DOMAINS = 50
# Path segments the superadmin API uses next to institutions/<slug>/.
RESERVED_SLUGS = frozenset({"options"})


@lru_cache(maxsize=1)
def _timezones():
    return frozenset(available_timezones())


def validate_timezone(value):
    if not isinstance(value, str) or value not in _timezones():
        raise ValidationError("Choose a valid time zone, for example Asia/Dhaka.", code="invalid_timezone")


def validate_slug(value):
    if not isinstance(value, str) or not SLUG_RE.match(value):
        raise ValidationError("Use 2-64 lowercase letters, digits or hyphens.", code="invalid_slug")
    if value in RESERVED_SLUGS:
        raise ValidationError("This slug is reserved; choose another.", code="reserved_slug")


def normalize_domain(value):
    """`Example.EDU ` -> `example.edu`. Rejects emails, URLs and anything that is not a bare domain."""
    domain = value.strip().lower() if isinstance(value, str) else ""
    if not DOMAIN_RE.match(domain):
        raise ValidationError(
            f"'{str(value)[:100]}' is not a domain. Use the form example.edu (no @, no http://).",
            code="invalid_domain",
        )
    return domain


def normalize_domains(values):
    """Lowercased, de-duplicated list of domains, in the given order."""
    if not isinstance(values, list):
        raise ValidationError("Give a list of domains.", code="invalid_domains")
    if len(values) > MAX_SIGN_IN_DOMAINS:
        raise ValidationError(f"At most {MAX_SIGN_IN_DOMAINS} domains.", code="invalid_domains")
    return list(dict.fromkeys(normalize_domain(v) for v in values))


def validate_domains(values):
    if normalize_domains(values) != values:
        raise ValidationError("Domains must be lowercase and unique.", code="invalid_domains")


def email_domain(email):
    return email.rsplit("@", 1)[-1].lower()


def domain_matches(domain, domains):
    """`cse.du.ac.bd` matches `du.ac.bd` (exact or a subdomain); an empty list matches nothing."""
    return any(domain == d or domain.endswith("." + d) for d in domains or [])


def email_domain_matches(organization, email):
    """Whether `email` is on one of the institution's sign-in domains, which confirms a sign-up's institution."""
    return bool(email) and domain_matches(email_domain(email), organization.sign_in_domains)
