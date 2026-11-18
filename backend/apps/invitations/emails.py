"""Invitation emails: rendered from templates and sent only after the creating transaction commits."""
import logging
import re
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.mail import get_connection, send_mail
from django.db import transaction
from django.db.models import Q
from django.template.loader import render_to_string
from django.utils import timezone

from apps.organizations.models import DEFAULT_TIMEZONE, Membership

from .models import Invitation, Notice, new_token

log = logging.getLogger(__name__)

PLAIN_NAME_RE = re.compile(r"[^\W\d_](?:[^\W\d_]|[ .'-]){0,59}")
DOMAIN_LIKE_RE = re.compile(r"\.\S")  # "J. Smith" is a name; "bdren-login.example" could become a link
STALE_SENDING = timedelta(minutes=10)  # far beyond a request's lifetime: its worker died before recording the result

ROLE_LABELS = {
    Membership.Role.OWNER: "an owner",
    Membership.Role.ADMIN: "an administrator",
    Membership.Role.BILLING: "a billing manager",
    Membership.Role.MEMBER: "a member",
}


def invite_url(token):
    return f"{settings.PLATFORM_PUBLIC_URL}/invite/{token}"


def subject_for(invitation):
    org = invitation.organization
    return f"You're invited to {org.name} on BDREN AI" if org else "You're invited to BDREN AI"


def inviter_name(invitation):
    """The inviter's name only when it reads as a plain name; the email body carries no other free text, so
    nobody can put a message or a link into an official BDREN AI email."""
    inviter = invitation.invited_by
    name = (inviter.name or "").strip() if inviter else ""
    plain = PLAIN_NAME_RE.fullmatch(name) and not DOMAIN_LIKE_RE.search(name)
    return name if plain else "BDREN AI"


def render(invitation, token):
    """Returns (subject, text body, html body)."""
    org = invitation.organization
    tz = ZoneInfo(org.timezone if org else DEFAULT_TIMEZONE)
    expires = invitation.expires_at.astimezone(tz)
    context = {
        "institution": org.name if org else None,
        "inviter": inviter_name(invitation),
        "role": ROLE_LABELS.get(invitation.role, invitation.role),
        "expires": f"{expires.day} {expires:%B %Y, %H:%M} ({tz.key})",
        "url": invite_url(token),
    }
    return (
        subject_for(invitation),
        render_to_string("invitations/invitation.txt", context),
        render_to_string("invitations/invitation.html", context),
    )


def send_all(pairs):
    """Sends each `(invitation, raw token)` over one connection and records `email_status` (`sent` / `failed`)
    on the rows still `sending`. Returns (sent, failed) counts."""
    sent, failed = [], []
    connection = get_connection()
    try:
        connection.open()
    except Exception as exc:  # mail server unreachable: every invitation stays pending for Resend
        log.warning("invitation email connection failed count=%s error=%s", len(pairs), type(exc).__name__)
        failed = [invitation.pk for invitation, _ in pairs]
    else:
        for invitation, token in pairs:
            (sent if _send(connection, invitation, token) else failed).append(invitation.pk)
        connection.close()
    for ids, status in ((sent, Invitation.EmailStatus.SENT), (failed, Invitation.EmailStatus.FAILED)):
        if ids:
            Invitation.objects.filter(pk__in=ids, email_status=Invitation.EmailStatus.SENDING).update(email_status=status)
    return len(sent), len(failed)


def _send(connection, invitation, token):
    subject, text, html = render(invitation, token)
    try:
        send_mail(
            subject, text, settings.DEFAULT_FROM_EMAIL, [invitation.email],
            html_message=html, connection=connection,
        )
    except Exception as exc:  # any transport failure leaves the invitation pending for Resend
        log.warning("invitation email failed invitation=%s error=%s", invitation.id, type(exc).__name__)
        return False
    return True


def covered_notice(organization, user):
    """Unsaved `Notice` telling `user` that `organization` added them to its package."""
    context = {"institution": organization.name, "url": f"{settings.PLATFORM_PUBLIC_URL}/profile"}
    return Notice(
        kind=Notice.Kind.COVERED,
        email=user.email,
        organization=organization,
        subject=f"{organization.name} added you to its BDREN AI package",
        body_text=render_to_string("invitations/covered.txt", context),
        body_html=render_to_string("invitations/covered.html", context),
    )


def send_notices(notices):
    """Sends each saved `Notice` over one connection and records `email_status`. Returns (sent, failed) counts."""
    sent, failed = [], []
    connection = get_connection()
    try:
        connection.open()
    except Exception as exc:  # mail server unreachable: the worker retries nothing, the notice is informational
        log.warning("notice email connection failed count=%s error=%s", len(notices), type(exc).__name__)
        failed = [notice.pk for notice in notices]
    else:
        for notice in notices:
            (sent if _send_notice(connection, notice) else failed).append(notice.pk)
        connection.close()
    now = timezone.now()
    Notice.objects.filter(pk__in=sent, email_status=Invitation.EmailStatus.SENDING).update(
        email_status=Invitation.EmailStatus.SENT, sent_at=now
    )
    Notice.objects.filter(pk__in=failed, email_status=Invitation.EmailStatus.SENDING).update(
        email_status=Invitation.EmailStatus.FAILED
    )
    return len(sent), len(failed)


def _send_notice(connection, notice):
    try:
        send_mail(
            notice.subject, notice.body_text, settings.DEFAULT_FROM_EMAIL, [notice.email],
            html_message=notice.body_html, connection=connection,
        )
    except Exception as exc:  # any transport failure is logged and recorded as `failed`
        log.warning("notice email failed notice=%s error=%s", notice.id, type(exc).__name__)
        return False
    return True


class Outbox:
    """Collects invitation and notice emails during a transaction and sends them once it commits.

    A request sends at most `INVITATION_INLINE_EMAILS` itself, so bulk actions never hold a web worker on SMTP:
    `reserve()` answers `sending` for those and `queued` for the rest, which the mail worker
    (`manage.py send_invitation_emails`) sends with a fresh token. Read `failures` / `email_sent` after the
    outermost transaction has committed; a rolled-back transaction sends nothing.
    """

    def __init__(self, limit=None):
        self.limit = settings.INVITATION_INLINE_EMAILS if limit is None else limit
        self._reserved = 0
        self._queue = []
        self._notices = []
        self.sent = 0
        self.failures = 0
        self.queued = 0

    def reserve(self):
        """The `email_status` to store on the next invitation before saving it."""
        if self._reserved < self.limit:
            self._reserved += 1
            return Invitation.EmailStatus.SENDING
        return Invitation.EmailStatus.QUEUED

    def add(self, invitation, token):
        """Call after `invitation` (with its `reserve()`d status) is saved."""
        if invitation.email_status != Invitation.EmailStatus.SENDING:
            self.queued += 1
            return
        self._schedule()
        self._queue.append((invitation, token))

    def notify(self, notices):
        """Saves the unsaved `Notice` rows (one query) and sends those within the inline limit after commit."""
        for notice in notices:
            notice.email_status = self.reserve()
        Notice.objects.bulk_create(notices)
        for notice in notices:
            if notice.email_status != Invitation.EmailStatus.SENDING:
                self.queued += 1
                continue
            self._schedule()
            self._notices.append(notice)

    def _schedule(self):
        if not self._queue and not self._notices:
            transaction.on_commit(self._flush)

    @property
    def email_sent(self):
        return self.sent > 0 and self.failures == 0 and self.queued == 0

    def _flush(self):
        queue, self._queue = self._queue, []
        notices, self._notices = self._notices, []
        for sent, failed in (send_all(queue) if queue else (0, 0), send_notices(notices) if notices else (0, 0)):
            self.sent += sent
            self.failures += failed


def send_queued(limit=100):
    """One step of the mail worker: claims up to `limit` pending invitations whose email is `queued` (or stuck in
    `sending` after a request died), gives each a fresh token (only its hash is stored, and nobody has received
    the old one), sends them and records the result; then the same for notices. Returns (sent, failed)."""
    now = timezone.now()
    stale = now - STALE_SENDING
    waiting = Q(email_status=Invitation.EmailStatus.QUEUED) | Q(
        email_status=Invitation.EmailStatus.SENDING, last_sent_at__lte=stale
    )
    with transaction.atomic():
        rows = list(
            Invitation.objects.select_for_update(skip_locked=True, of=("self",))
            .select_related("organization", "invited_by")
            .filter(waiting, status=Invitation.Status.PENDING, expires_at__gt=now)
            .order_by("last_sent_at")[:limit]
        )
        pairs = []
        for invitation in rows:
            token, invitation.token_hash = new_token()
            invitation.email_status = Invitation.EmailStatus.SENDING
            invitation.last_sent_at = now
            pairs.append((invitation, token))
        Invitation.objects.bulk_update(rows, ["token_hash", "email_status", "last_sent_at"])
        notices = list(
            Notice.objects.select_for_update(skip_locked=True)
            .filter(
                Q(email_status=Invitation.EmailStatus.QUEUED)
                | Q(email_status=Invitation.EmailStatus.SENDING, created_at__lte=stale)
            )
            .order_by("created_at")[:limit]
        )
        Notice.objects.filter(pk__in=[n.pk for n in notices]).update(email_status=Invitation.EmailStatus.SENDING)
    sent, failed = send_all(pairs) if pairs else (0, 0)
    notice_sent, notice_failed = send_notices(notices) if notices else (0, 0)
    return sent + notice_sent, failed + notice_failed
