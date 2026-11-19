"""Superadmin billing and subscriptions API (`/api/v1/superadmin/billing/`, docs/BILLING_API.md)."""
from django.http import JsonResponse

from apps.audit.services import client_ip
from apps.billing import queries, quotes
from apps.billing import services as billing
from apps.billing import shapes
from apps.billing.models import PaymentRecord
from apps.billing.views import attachment_response, receipt_response
from apps.invitations.errors import ServiceError, invalid
from apps.invitations.shapes import paginated
from apps.organizations.models import Organization
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import resume_renewal, schedule_change, stop_renewal

from . import lists
from .views import SuperadminView, payload

PAYMENT_STATUSES = frozenset(PaymentRecord.Status.values)
SUBSCRIPTION_STATUSES = frozenset(Subscription.Status.values)
BOOLEANS = {"true": True, "1": True, "false": False, "0": False}


def _institution(slug):
    org = Organization.objects.filter(slug=slug).first()
    if org is None:
        raise billing.not_found("No institution with this slug.")
    return org


def _boolean(request, name):
    value = lists.text(request, name).lower()
    if not value:
        return None
    if value not in BOOLEANS:
        raise invalid({name: "Use true or false."})
    return BOOLEANS[value]


def _days(request, name):
    value = lists.text(request, name)
    if not value:
        return None
    if not value.isdigit() or not 0 <= int(value) <= 3650:
        raise invalid({name: "Use a number of days."})
    return int(value)


def payment_body(pk):
    return shapes.payment(billing.load_payment(pk))


class SummaryView(SuperadminView):
    def get(self, request):
        return JsonResponse(queries.summary(lists.moment(request, "from"), lists.moment(request, "to", end_of_day=True)))


class PaymentsView(SuperadminView):
    def get(self, request):
        qs = queries.payment_list(
            q=lists.text(request),
            status=lists.choice(request, "status", PAYMENT_STATUSES),
            method=lists.choice(request, "method", queries.METHOD_GROUPS),
            institution=lists.text(request, "institution") or None,
            package=lists.uuid_value(request, "package"),
            since=lists.moment(request, "from"),
            until=lists.moment(request, "to", end_of_day=True),
            tab=lists.choice(request, "tab", queries.TABS) or "all",
        )
        return JsonResponse(paginated(qs, request.GET, shapes.payment))


class PaymentView(SuperadminView):
    def get(self, request, pk):
        return JsonResponse(payment_body(pk))


class ManualPaymentView(SuperadminView):
    def post(self, request):
        payment = billing.record_manual(payload(request), actor=request.user, ip_address=client_ip(request))
        return JsonResponse(payment_body(payment.pk), status=201)


class VerifyView(SuperadminView):
    def post(self, request, pk):
        data = payload(request)
        billing.load_payment(pk)
        billing.verify(pk, actor=request.user, notes=data.get("notes"), ip_address=client_ip(request))
        return JsonResponse(payment_body(pk))


class RejectView(SuperadminView):
    def post(self, request, pk):
        data = payload(request)
        billing.load_payment(pk)
        billing.reject(pk, actor=request.user, reason=data.get("reason"), ip_address=client_ip(request))
        return JsonResponse(payment_body(pk))


class RefundView(SuperadminView):
    def post(self, request, pk):
        data = payload(request)
        billing.load_payment(pk)
        billing.refund(pk, data, actor=request.user, ip_address=client_ip(request))
        return JsonResponse(payment_body(pk))


class AttachmentView(SuperadminView):
    def get(self, request, pk):
        return attachment_response(*billing.attachment(pk))

    def post(self, request, pk):
        billing.load_payment(pk)
        billing.attach(pk, request.FILES.get("file"), actor=request.user, ip_address=client_ip(request))
        return JsonResponse(payment_body(pk))


class ReceiptView(SuperadminView):
    def get(self, request, pk):
        return receipt_response(billing.receipt(pk))


class QuoteView(SuperadminView):
    def get(self, request):
        org = billing.find_institution(lists.text(request, "institution"))
        package = billing.find_package(lists.text(request, "package"))
        kind = billing.clean_kind(lists.text(request, "kind"))
        periods = billing.clean_periods(lists.text(request, "periods") or None)
        start = billing.clean_date(lists.text(request, "period_start") or None, "period_start")
        quote = billing.manual_quote(billing.organization_account(org), org, package, kind, periods, start)
        version = quote.package_version
        return JsonResponse({
            **quote.body(),
            "package": shapes.package_ref(package),
            "seat_limit": version.seat_limit,
            "subscription_id": str(quote.subscription.id) if quote.subscription else None,
        })


# ---------------------------------------------------------------- subscriptions

def _subscription(pk):
    sub = queries.subscription_queryset().filter(pk=pk).first()
    if sub is None:
        raise billing.not_found("No subscription with this id.")
    return sub


class SubscriptionsView(SuperadminView):
    def get(self, request):
        qs = queries.subscription_list(
            status=lists.choice(request, "status", SUBSCRIPTION_STATUSES),
            institution=lists.text(request, "institution") or None,
            package=lists.uuid_value(request, "package"),
            expiring_within=_days(request, "expiring_within"),
            scheduled=bool(_boolean(request, "scheduled")),
            auto_renew=_boolean(request, "auto_renew"),
        )
        return JsonResponse(paginated(qs, request.GET, shapes.subscription))


class SubscriptionActionView(SuperadminView):
    """POST subscriptions/<id>/cancel-scheduled-change|stop-renewal|resume-renewal/; the action is in the URL."""

    action = None

    def post(self, request, pk):
        data = payload(request)
        sub = _subscription(pk)
        meta = {"source": "superadmin"}
        if sub.account.organization_id:
            meta["organization_id"] = str(sub.account.organization_id)
        reason = data.get("reason") if isinstance(data.get("reason"), str) else ""
        if reason:
            meta["reason"] = reason[:1000]
        ip = client_ip(request)
        if self.action == "cancel-scheduled-change":
            if sub.pending_package_version_id is None:
                raise ServiceError("no_scheduled_change", "No change is scheduled for this subscription.", status=409)
            schedule_change(subscription=sub, package_version=None, actor=request.user, ip_address=ip)
        elif self.action == "stop-renewal":
            stop_renewal(subscription=sub, actor=request.user, notes=reason, metadata=meta, ip_address=ip)
        else:
            resume_renewal(subscription=sub, actor=request.user, notes=reason, metadata=meta, ip_address=ip)
        return JsonResponse(shapes.subscription(_subscription(pk)))


class InstitutionBillingView(SuperadminView):
    def get(self, request, slug):
        org = _institution(slug)
        subscriptions, payments = queries.account_billing(billing.organization_account(org))
        return JsonResponse({
            "subscriptions": [shapes.subscription(s) for s in subscriptions],
            "payments": [shapes.payment(p) for p in payments],
            "offers": [shapes.offer(p, q) for p, q in quotes.offers(billing.organization_account(org))],
        })
