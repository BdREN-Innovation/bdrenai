"""JSON shapes of billing (docs/BILLING_API.md): `Payment`, `Subscription`, offers. Querysets come from
`services.payment_queryset()` and `queries.subscription_queryset()`, so the shapes cost no query per row."""
from apps.invitations.shapes import iso, person


def money(value):
    return f"{value:.2f}"


def institution(account):
    org = account.organization
    return {"slug": org.slug, "name": org.name} if org else None


def package_ref(package):
    return {"id": str(package.id), "name": package.name, "kind": package.kind}


def _person(user, portal):
    if user is None:
        return None
    return {"name": user.name} if portal else person(user)


def refund(row, *, portal=False):
    out = {
        "id": str(row.id),
        "amount": money(row.amount),
        "reason": row.reason,
        "method": row.method,
        "bkash_refund_trx_id": row.bkash_refund_trx_id or None,
        "status": row.status,
        "created_at": iso(row.created_at),
    }
    if not portal:
        out["created_by"] = person(row.created_by)
    return out


def payment(p, *, portal=False):
    """The contract's `Payment`; `portal` drops emails and refund authors."""
    version = p.package_version
    bkash = None
    if p.bkash_payment_id:
        bkash = {
            "payment_id": p.bkash_payment_id,
            "trx_id": p.bkash_trx_id,
            "payer_account": p.bkash_payer_account or None,
            "status": p.bkash_status or None,
        }
    return {
        "id": str(p.id),
        "receipt_number": p.receipt_number,
        "institution": institution(p.account),
        "account_id": str(p.account_id),
        "package": package_ref(version.package) if version else None,
        "package_version": version.version if version else None,
        "kind": p.kind,
        "applied": p.applied,
        "subscription_id": str(p.subscription_id) if p.subscription_id else None,
        "target_subscription_id": str(p.target_subscription_id) if p.target_subscription_id else None,
        "method": p.method,
        "status": p.status,
        "amount": money(p.amount),
        "currency": p.currency,
        "periods": p.periods,
        "period_start": iso(p.period_start),
        "period_end": iso(p.period_end),
        "reference": p.reference,
        "payer_name": p.payer_name,
        "payment_date": p.payment_date.isoformat() if p.payment_date else None,
        "notes": p.notes,
        "has_attachment": p.has_attachment,
        "bkash": bkash,
        "failure_reason": p.failure_reason,
        "refunded_amount": money(p.refunded_amount),
        "refunds": [refund(r, portal=portal) for r in p.refunds.all()],
        "recorded_by": _person(p.recorded_by, portal),
        "verified_by": _person(p.verified_by, portal),
        "verified_at": iso(p.verified_at),
        "completed_at": iso(p.completed_at),
        "created_at": iso(p.created_at),
    }


def app_ref(product):
    return {"slug": product.slug, "name": product.name}


def subscription(sub):
    """The contract's `Subscription`. Needs `queries.subscription_queryset()` (`last_payments` prefetched)."""
    version = sub.package_version
    pending = sub.pending_package_version
    last = sub.last_payments[0] if getattr(sub, "last_payments", None) else None
    return {
        "id": str(sub.id),
        "institution": institution(sub.account),
        "account_id": str(sub.account_id),
        "package": package_ref(version.package),
        "version": version.version,
        "apps": [app_ref(p) for p in version.products.all()],
        "status": sub.status,
        "starts_at": iso(sub.starts_at),
        "expires_at": iso(sub.expires_at),
        "auto_renew": sub.auto_renew,
        "scheduled_package": {"id": str(pending.package_id), "name": pending.package.name} if pending else None,
        "last_payment": (
            {"id": str(last.id), "method": last.method, "completed_at": iso(last.completed_at)} if last else None
        ),
    }


def offered_package(package, version):
    return {
        **package_ref(package),
        "audience": package.audience,
        "apps": [app_ref(p) for p in version.products.all()],
    }


def offer(package, quote):
    return {"package": offered_package(package, quote.package_version), "kind": quote.kind, "quote": quote.body()}


def downgrade(sub, package, version):
    """A package the subscription can move to at its next renewal (portal `downgrades`)."""
    return {
        "subscription_id": str(sub.id),
        "package": offered_package(package, version),
        "amount": money(version.price),
        "currency": version.currency,
        "billing_interval": version.billing_interval,
        "seat_limit": version.seat_limit,
    }
