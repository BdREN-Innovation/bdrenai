"""Local test accounts: a platform superadmin, an institution admin and an institution member.

Creates (or resets) each account in ZITADEL with a verified email and a known password, mirrors it in Django the way
a first sign-in would, and gives it its role. Re-running is safe: existing accounts get the password reset and their
role ensured. Refuses to run unless the identity provider is local (`localhost`, `*.localhost` or `*.test`).

    docker compose exec backend python manage.py seed_test_accounts
    docker compose exec backend python manage.py seed_test_accounts --password 'Another-Pass-1!'
"""
from urllib.parse import urlparse

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.administration.models import PlatformRoleAssignment
from apps.audit.services import record_audit
from apps.identities import zitadel
from apps.identities.services import provision_user
from apps.organizations import directory
from apps.organizations.models import Membership, Organization
from apps.organizations.services import add_or_update_membership, create_organization

DEFAULT_PASSWORD = "Bdren-Test-2026!"
INSTITUTION_SLUG = "sau"
INSTITUTION_SEAT_CAP = 50
LOCAL_SUFFIXES = (".localhost", ".test")

SUPERADMIN = "superadmin"
INSTITUTION_ADMIN = "institution admin"
MEMBER = "member"

ACCOUNTS = [
    {"email": "superadmin@bdren.test", "first_name": "BdREN", "last_name": "Superadmin", "role": SUPERADMIN},
    {"email": "inst-admin@bdren.test", "first_name": "Institution", "last_name": "Admin", "role": INSTITUTION_ADMIN},
    {"email": "member@bdren.test", "first_name": "Institution", "last_name": "Member", "role": MEMBER},
]


def is_local_issuer(issuer):
    host = (urlparse(issuer).hostname or "").lower()
    return host in ("localhost", "127.0.0.1") or host.endswith(LOCAL_SUFFIXES)


class Command(BaseCommand):
    help = "Creates or resets the local test accounts (superadmin, institution admin, member) in ZITADEL and Django."

    def add_arguments(self, parser):
        parser.add_argument("--password", default=DEFAULT_PASSWORD, help="Password for every account.")

    def handle(self, *args, password, **options):
        issuer = settings.OIDC["ISSUER"]
        if not is_local_issuer(issuer):
            raise CommandError(f"Refusing to seed test accounts against a non-local identity provider ({issuer}).")
        if not zitadel.enabled():
            raise CommandError("ZITADEL_SERVICE_TOKEN is not set; run scripts/bootstrap_zitadel.py first.")

        institution = self._institution()
        rows = []
        for account in ACCOUNTS:
            user = self._user(account, password, issuer)
            self._grant(user, account["role"], institution)
            rows.append((account["email"], account["role"]))

        self.stdout.write(self.style.SUCCESS(f"Test accounts ready (password for all: {password}):"))
        for email, role in rows:
            where = f" of {institution.name}" if role != SUPERADMIN else ""
            self.stdout.write(f"  {email:<26} {role}{where}")

    def _institution(self):
        org = Organization.objects.filter(slug=INSTITUTION_SLUG).first()
        if org is not None:
            return org
        entry = next(e for e in directory.entries() if e["suggested_slug"] == INSTITUTION_SLUG)
        org = create_organization(
            name=entry["name"], slug=INSTITUTION_SLUG, type=Organization.Type.UNIVERSITY, sector=entry["sector"],
            seat_cap=INSTITUTION_SEAT_CAP,
        )
        record_audit(action="organization.created", target_type="Organization", target_id=org.id,
                     metadata={"organization_id": str(org.id), "source": "seed_test_accounts"})
        return org

    def _user(self, account, password, issuer):
        email = account["email"]
        try:
            zitadel_id = zitadel.find_user_id(email)
            if zitadel_id is None:
                zitadel_id = zitadel.create_verified_user(
                    first_name=account["first_name"], last_name=account["last_name"], email=email, password=password,
                )
            else:
                zitadel.set_password(zitadel_id, password)
        except zitadel.ZitadelError as e:
            raise CommandError(f"ZITADEL refused {email}: {e}") from e
        return provision_user({
            "iss": issuer,
            "sub": zitadel_id,
            "email": email,
            "email_verified": True,
            "given_name": account["first_name"],
            "family_name": account["last_name"],
        })

    @transaction.atomic
    def _grant(self, user, role, institution):
        if role == SUPERADMIN:
            _, created = PlatformRoleAssignment.objects.get_or_create(
                user=user, role=PlatformRoleAssignment.Role.SUPER_ADMIN,
            )
            if created:
                record_audit(action="platform_role.granted", target_type="User", target_id=user.id,
                             metadata={"role": PlatformRoleAssignment.Role.SUPER_ADMIN, "source": "seed_test_accounts"})
            return
        membership_role = Membership.Role.ADMIN if role == INSTITUTION_ADMIN else Membership.Role.MEMBER
        add_or_update_membership(user=user, organization=institution, role=membership_role)
