"""Mail worker for invitation emails that bulk actions (imports, resend-expired) leave `queued`.

    manage.py send_invitation_emails            # one batch, then exit
    manage.py send_invitation_emails --loop     # keep polling (the `mailer` service in docker-compose)
"""
import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from ...emails import send_queued


class Command(BaseCommand):
    help = "Send queued invitation emails; with --loop keep polling for new ones."

    def add_arguments(self, parser):
        parser.add_argument("--loop", action="store_true", help="Keep running, polling every --interval seconds.")
        parser.add_argument("--interval", type=float, default=5.0, help="Seconds between polls when idle.")
        parser.add_argument("--batch", type=int, default=100, help="Emails claimed and sent per step.")

    def handle(self, *args, loop, interval, batch, **options):
        while True:
            sent, failed = send_queued(batch)
            if sent or failed:
                self.stdout.write(f"invitation emails sent={sent} failed={failed}")
            if not loop:
                return
            if sent + failed < batch:
                time.sleep(interval)
            close_old_connections()  # a long-running process must drop connections the database closed
