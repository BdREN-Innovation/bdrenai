"""Emails one gentle reminder to an institution's owners/admins when its subscription period has ended
(docs/BILLING_API.md "Emails").

    manage.py send_expiry_reminders            # one pass, then exit
    manage.py send_expiry_reminders --loop     # every --interval seconds (the `expiry-reminders` compose service)
"""
import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from ...receipts import send_expiry_reminders


class Command(BaseCommand):
    help = "Remind institution admins once when a subscription period has ended in the last 7 days."

    def add_arguments(self, parser):
        parser.add_argument("--loop", action="store_true", help="Keep running, one pass every --interval seconds.")
        parser.add_argument("--interval", type=float, default=86400.0, help="Seconds between passes (default daily).")
        parser.add_argument("--batch", type=int, default=200, help="Subscriptions handled per step.")

    def handle(self, *args, loop, interval, batch, **options):
        while True:
            total = 0
            while True:
                reminded, emails = send_expiry_reminders(batch=batch)
                total += reminded
                if reminded:
                    self.stdout.write(f"expiry reminders subscriptions={reminded} emails={emails}")
                if reminded < batch:
                    break
            if not loop:
                return
            time.sleep(interval)
            close_old_connections()
