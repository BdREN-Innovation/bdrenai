"""Grants or revokes a platform role from the shell, e.g. to create the first superadmin.

    manage.py grant_platform_role --email admin@bdren.ai
    manage.py grant_platform_role --user <uuid> --role platform_super_admin --revoke

The user must have signed in once (users exist only after their first ZITADEL login).
"""
import uuid

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.audit.services import record_audit
from apps.identities.models import User

from ...models import PlatformRoleAssignment


class Command(BaseCommand):
    help = "Grant (or --revoke) a platform role to an existing user, found by --email or --user."

    def add_arguments(self, parser):
        who = parser.add_mutually_exclusive_group(required=True)
        who.add_argument(
            "--email", help="Verified email of a user who has signed in once (must match exactly one user).",
        )
        who.add_argument("--user", help="User id (UUID).")
        parser.add_argument(
            "--role", default=PlatformRoleAssignment.Role.SUPER_ADMIN, choices=PlatformRoleAssignment.Role.values,
        )
        parser.add_argument("--revoke", action="store_true", help="Remove the role instead of granting it.")

    def handle(self, *args, email=None, user=None, role, revoke, **options):
        target = self._find_user(email, user)
        with transaction.atomic():
            if revoke:
                deleted, _ = PlatformRoleAssignment.objects.filter(user=target, role=role).delete()
                changed, action = bool(deleted), "platform_role.revoked"
            else:
                _, changed = PlatformRoleAssignment.objects.get_or_create(user=target, role=role)
                action = "platform_role.granted"
            if changed:
                record_audit(
                    action=action, target_type="User", target_id=str(target.id),
                    metadata={"role": role, "source": "cli"},
                )
        verb = "Revoked" if revoke else "Granted"
        if not changed:
            state = "does not have" if revoke else "already has"
            self.stdout.write(f"{target.email or target.id} {state} {role}; nothing changed.")
            return
        direction = "from" if revoke else "to"
        self.stdout.write(self.style.SUCCESS(f"{verb} {role} {direction} {target.email or target.id}."))
        if revoke and role == PlatformRoleAssignment.Role.SUPER_ADMIN and not PlatformRoleAssignment.objects.filter(
            role=PlatformRoleAssignment.Role.SUPER_ADMIN
        ).exists():
            self.stderr.write(self.style.WARNING("No platform superadmin is left."))

    def _find_user(self, email, user_id):
        if user_id:
            try:
                uid = uuid.UUID(user_id)
            except ValueError:
                raise CommandError("--user must be a UUID.") from None
            found = User.objects.filter(id=uid).first()
            if found is None:
                raise CommandError(f"No user with id {user_id}.")
            return found
        matches = list(User.objects.filter(email__iexact=email.strip(), email_verified=True)[:2])
        if not matches:
            raise CommandError(
                f"No user has verified the email {email}. They must sign in once and verify it first, "
                "or use --user <uuid>."
            )
        if len(matches) > 1:
            raise CommandError(f"More than one user has email {email}; use --user <uuid>.")
        return matches[0]
