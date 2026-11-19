"""Settles bKash checkouts the browser callback never resolved (docs/BILLING_API.md, bKash flow 3).

    manage.py reconcile_bkash            # one pass, then exit
    manage.py reconcile_bkash --loop     # every --interval seconds (the `billing-reconciler` compose service)
"""
import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from ... import bkash
from ...services import reconcile


class Command(BaseCommand):
    help = "Query bKash for pending payments older than 10 minutes and complete, fail or cancel them."

    def add_arguments(self, parser):
        parser.add_argument("--loop", action="store_true", help="Keep running, one pass every --interval seconds.")
        parser.add_argument("--interval", type=float, default=300.0, help="Seconds between passes (default 5 min).")
        parser.add_argument("--batch", type=int, default=100, help="Payments checked per pass.")

    def handle(self, *args, loop, interval, batch, **options):
        while True:
            if bkash.enabled():
                counts = reconcile(batch=batch)
                if counts["checked"]:
                    self.stdout.write("bkash reconcile " + " ".join(f"{k}={v}" for k, v in counts.items()))
            if not loop:
                return
            time.sleep(interval)
            close_old_connections()  # a long-running process must drop connections the database closed
