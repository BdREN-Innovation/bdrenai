"""Keeps UserSession in step with Django's sign-in and sign-out."""
from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.contrib.sessions.models import Session
from django.dispatch import receiver
from django.utils import timezone

from .models import UserSession


@receiver(user_logged_in, dispatch_uid="identities.track_session")
def track_session(sender, request, user, **kwargs):
    key = request.session.session_key
    if not key:
        return
    UserSession.objects.update_or_create(session_key=key, defaults={"user": user})
    live = Session.objects.filter(expire_date__gt=timezone.now()).values("session_key")
    UserSession.objects.filter(user=user).exclude(session_key__in=live).delete()


@receiver(user_logged_out, dispatch_uid="identities.forget_session")
def forget_session(sender, request, user, **kwargs):
    key = request.session.session_key if request is not None else None
    if key:
        UserSession.objects.filter(session_key=key).delete()
