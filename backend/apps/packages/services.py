"""Packages: creation and versioning with subscriber migration policies, the rules a package draft from the
superadmin editor must meet, version diffs and previews, archive/restore, and the apps' features
(docs/SUPERADMIN_API.md, Phase 2a).

A PackageVersion is an immutable commercial snapshot (terms, included apps, limits). Presentation fields
(name, audience, ...) live on the Package and change without a new version."""
import re
import uuid
from dataclasses import dataclass, replace
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Case, Count, Exists, IntegerField, OuterRef, Prefetch, Q, Subquery, Value, When
from django.db.models.functions import Coalesce

from apps.audit.services import record_audit
from apps.entitlements.services import sync_subscription_entitlements
from apps.invitations.errors import ServiceError, invalid
from apps.invitations.services import audit_metadata, clean_name
from apps.products.models import Feature, Product
from apps.subscriptions.models import Subscription, SubscriptionHistory

from .models import Package, PackageLimit, PackageVersion

SINGLE = Package.Kind.SINGLE
BUNDLE = Package.Kind.BUNDLE
ARCHIVED = Package.Status.ARCHIVED
FREE = Package.BillingInterval.FREE
LIVE = (Subscription.Status.ACTIVE, Subscription.Status.TRIAL)
TERM_FIELDS = ("price", "currency", "billing_interval", "price_unit", "trial_days", "seat_limit")
PACKAGE_TERMS = TERM_FIELDS[:-1]
LIMIT_STATE = ("limit_value", "limit_period", "on_limit")
COMMERCIAL_KEYS = frozenset({"app", "apps", "limits", *TERM_FIELDS})
FIXED_KEYS = ("kind", "slug")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FEATURE_KEY_RE = re.compile(r"^[a-z0-9_]{2,64}$")
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
CENT = Decimal("0.01")
MAX_PRICE = Decimal("99999999.99")
MAX_SLUG = 100
MAX_TRIAL_DAYS = 365
MAX_SEATS = 1_000_000
MAX_LIMIT = 10**15
MAX_REASON = 1000
SORT_RANGE = (-10_000, 10_000)


@dataclass(frozen=True)
class Terms:
    """The commercial terms of a version."""

    price: Decimal = Decimal("0.00")
    currency: str = "BDT"
    billing_interval: str = Package.BillingInterval.MONTHLY
    price_unit: str = Package.PriceUnit.PER_SEAT
    trial_days: int = 0
    seat_limit: int | None = None

    @classmethod
    def of(cls, version):
        return cls(**{name: getattr(version, name) for name in TERM_FIELDS})

    def values(self):
        return {name: getattr(self, name) for name in TERM_FIELDS}


@dataclass(frozen=True)
class Draft:
    """A validated package draft; `presentation` is filled only when creating."""

    kind: str
    products: list
    terms: Terms
    limits: list
    presentation: dict


@dataclass(frozen=True)
class TermChange:
    field: str
    before: Decimal | str | int | None
    after: Decimal | str | int | None


@dataclass(frozen=True)
class AppsChange:
    added: list
    removed: list


@dataclass(frozen=True)
class LimitChange:
    feature: Feature
    before: dict | None
    after: dict | None


def not_found(message):
    return ServiceError("not_found", message, status=404)


def _audit(*, actor, action, target_type, target_id, ip_address=None, **values):
    return record_audit(
        actor=actor, action=action, target_type=target_type, target_id=target_id,
        metadata=audit_metadata(None, **values), ip_address=ip_address,
    )


def _create_limits(version, limits):
    PackageLimit.objects.bulk_create([
        PackageLimit(
            package_version=version,
            feature=item["feature"],
            limit_value=item["limit_value"],
            limit_period=item.get("limit_period", PackageLimit.Period.MONTHLY),
            on_limit=item.get("on_limit", PackageLimit.OnLimit.BLOCK),
        )
        for item in limits
    ])


def _mirror_terms(package, terms):
    """The package carries its latest published terms for catalog and subscription code."""
    for name in PACKAGE_TERMS:
        setattr(package, name, getattr(terms, name))


# ---------------------------------------------------------------- creation and versioning

@transaction.atomic
def create_package_with_version(
    *,
    product=None,
    name: str,
    slug: str,
    description: str = "",
    price=0,
    currency: str = "BDT",
    billing_interval: str = Package.BillingInterval.MONTHLY,
    trial_days: int = 0,
    limits: list[dict],
    actor=None,
    kind: str = SINGLE,
    products: list | None = None,
    price_unit: str = Package.PriceUnit.PER_SEAT,
    seat_limit: int | None = None,
    audience: str = "",
    is_public: bool = True,
    highlight: bool = False,
    sort_order: int = 0,
    ip_address=None,
):
    """Creates a Package along with its initial v1 PackageVersion and PackageLimits. A single package includes
    `product`; a bundle (`product=None`) includes `products`."""
    terms = Terms(
        price=Decimal(str(price)), currency=currency, billing_interval=billing_interval, price_unit=price_unit,
        trial_days=trial_days, seat_limit=seat_limit,
    )
    pkg = Package(
        kind=kind, product=product, name=name, slug=slug, description=description, audience=audience,
        is_public=is_public, highlight=highlight, sort_order=sort_order,
    )
    _mirror_terms(pkg, terms)
    pkg.save()
    ver = PackageVersion.objects.create(
        package=pkg,
        version=1,
        status=PackageVersion.Status.ACTIVE,
        migration_policy=PackageVersion.MigrationPolicy.NEW_ONLY,
        created_by=actor,
        **terms.values(),
    )
    ver.products.set(products if products is not None else [product])
    _create_limits(ver, limits)
    _audit(
        actor=actor, action="package.created", target_type="Package", target_id=str(pkg.id),
        ip_address=ip_address, package_id=str(pkg.id), kind=kind, version=1, slug=slug,
    )
    return pkg, ver


def _migrate(subs, new_ver, actor, note):
    for sub in subs:
        old_ver = sub.package_version
        sub.package_version = new_ver
        sub.pending_package_version = None
        sub.save(update_fields=["package_version", "pending_package_version"])
        SubscriptionHistory.objects.create(
            subscription=sub,
            old_package_version=old_ver,
            new_package_version=new_ver,
            change_type=SubscriptionHistory.ChangeType.MIGRATED,
            changed_by=actor,
            notes=f"{note} migration to v{new_ver.version}",
        )
        sync_subscription_entitlements(sub)
    return len(subs)


@transaction.atomic
def publish_new_package_version(
    *,
    package: Package,
    limits: list[dict],
    migration_policy: str = PackageVersion.MigrationPolicy.NEW_ONLY,
    selected_subscription_ids: list = None,
    actor=None,
    terms: Terms | None = None,
    products: list | None = None,
    change_reason: str = "",
    ip_address=None,
):
    """Publishes a new immutable PackageVersion for an existing Package; `terms` and `products` default to the
    previous version's, and the package mirrors the new terms. Applies the administrator-selected
    migration_policy to existing subscribers:
      - new_only: existing subscribers stay on their current version.
      - immediate: active/trial subscribers of this package are migrated immediately.
      - on_renewal: existing subscribers have pending_package_version set to the new version.
      - selected_only: only subscriptions in `selected_subscription_ids` are migrated immediately.
    """
    package = Package.objects.select_for_update().get(pk=package.pk)
    previous = package.versions.prefetch_related("products").order_by("-version").first()
    terms = terms or Terms.of(previous)
    new_ver = PackageVersion.objects.create(
        package=package,
        version=previous.version + 1,
        status=PackageVersion.Status.ACTIVE,
        migration_policy=migration_policy,
        change_reason=change_reason,
        created_by=actor,
        **terms.values(),
    )
    new_ver.products.set(products if products is not None else previous.products.all())
    _create_limits(new_ver, limits)
    _mirror_terms(package, terms)
    package.save(update_fields=[*PACKAGE_TERMS, "updated_at"])

    active_subs = Subscription.objects.select_for_update().filter(
        package_version__package=package,
        status__in=LIVE,
    ).exclude(package_version=new_ver)

    migrated_count = 0
    scheduled_count = 0

    if migration_policy == PackageVersion.MigrationPolicy.IMMEDIATE:
        migrated_count = _migrate(list(active_subs), new_ver, actor, "Immediate")

    elif migration_policy == PackageVersion.MigrationPolicy.ON_RENEWAL:
        for sub in active_subs:
            sub.pending_package_version = new_ver
            sub.save(update_fields=["pending_package_version"])
            scheduled_count += 1

    elif migration_policy == PackageVersion.MigrationPolicy.SELECTED_ONLY and selected_subscription_ids:
        migrated_count = _migrate(
            list(active_subs.filter(id__in=selected_subscription_ids)), new_ver, actor, "Selected"
        )

    _audit(
        actor=actor, action="package.version_published", target_type="PackageVersion", target_id=str(new_ver.id),
        ip_address=ip_address, package_id=str(package.id), version=new_ver.version,
        migration_policy=migration_policy, migrated_count=migrated_count, scheduled_count=scheduled_count,
        reason=change_reason,
    )
    return new_ver, {"migrated": migrated_count, "scheduled": scheduled_count}


# ---------------------------------------------------------------- reads

def _ordered_apps(apps=None):
    return Prefetch("products", queryset=(apps or Product.objects).order_by("sort_order", "name"))


def _limits_prefetch(limits=None):
    return Prefetch(
        "limits",
        queryset=(limits or PackageLimit.objects).select_related("feature__product").order_by(
            "feature__product__sort_order", "feature__product__name", "feature__name"
        ),
    )


def latest_versions():
    """The latest version of each package (one row per package)."""
    latest = PackageVersion.objects.filter(package=OuterRef("package")).order_by("-version").values("version")[:1]
    return PackageVersion.objects.filter(version=Subquery(latest))


def _live_subscribers():
    live = (
        Subscription.objects.filter(package_version__package=OuterRef("pk"), status__in=LIVE)
        .order_by()
        .values("package_version__package")
        .annotate(n=Count("pk"))
        .values("n")
    )
    return Coalesce(Subquery(live, output_field=IntegerField()), 0)


def packages():
    """Packages annotated with `current_number` and live `subscribers`, in catalog order (bundles first, then
    by app)."""
    current = PackageVersion.objects.filter(package=OuterRef("pk")).order_by("-version").values("version")[:1]
    return (
        Package.objects.select_related("product")
        .annotate(
            current_number=Subquery(current),
            subscribers=_live_subscribers(),
            kind_order=Case(When(kind=BUNDLE, then=Value(0)), default=Value(1), output_field=IntegerField()),
        )
        .order_by("kind_order", "product__sort_order", "product__name", "sort_order", "name", "pk")
    )


def package_list(*, kind=None, app=None, status=None, q=""):
    """Each package carries `current_versions` ([its latest version, with apps]). Archived packages only show
    when asked for with `status`. `app` matches that app's singles and the bundles whose latest version
    includes it."""
    current = latest_versions().prefetch_related(_ordered_apps())
    qs = packages().prefetch_related(Prefetch("versions", queryset=current, to_attr="current_versions"))
    qs = qs.filter(status=status) if status else qs.exclude(status=ARCHIVED)
    if kind:
        qs = qs.filter(kind=kind)
    if app:
        bundled = PackageVersion.objects.filter(
            package=OuterRef("pk"), version=OuterRef("current_number"), products__slug=app
        )
        qs = qs.filter(Q(kind=SINGLE, product__slug=app) | (Q(kind=BUNDLE) & Exists(bundled)))
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(slug__icontains=q))
    return qs


def load_package(package_id):
    """The package with `all_versions` (newest first: creator, apps, limits and live `subscribers`), or a 404."""
    versions = (
        PackageVersion.objects.select_related("created_by")
        .prefetch_related(_ordered_apps(), _limits_prefetch())
        .annotate(subscribers=Count("subscriptions", filter=Q(subscriptions__status__in=LIVE)))
        .order_by("-version")
    )
    pkg = (
        packages().prefetch_related(Prefetch("versions", queryset=versions, to_attr="all_versions"))
        .filter(pk=package_id).first()
    )
    if pkg is None:
        raise not_found("No package with this id.")
    return pkg


def _locked_package(package_id):
    pkg = Package.objects.select_for_update().filter(pk=package_id).first()
    if pkg is None:
        raise not_found("No package with this id.")
    return pkg


def _current(package):
    return package.versions.prefetch_related("products", _limits_prefetch()).order_by("-version").first()


def live_subscriptions(package):
    """Active and trial subscriptions on any version of the package, with who holds them."""
    return (
        Subscription.objects.filter(package_version__package=package, status__in=LIVE)
        .select_related("account__organization", "account__owner_user")
        .order_by("account__organization__name", "created_at", "pk")
    )


# ---------------------------------------------------------------- draft validation

def _decimal(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        return None
    if not number.is_finite() or number < 0 or number > MAX_PRICE or number != number.quantize(CENT):
        return None
    return number.quantize(CENT)


def _integer(value, low, high):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        return None
    return value


def _text(data, key, errors):
    value = data[key]
    if not isinstance(value, str):
        errors[key] = "Enter text."
        return ""
    return value.strip()


def _active_apps(slugs, errors, field, kept=frozenset()):
    """The apps named by `slugs`; each must be active unless its id is in `kept` (already in the package)."""
    found = {p.slug: p for p in Product.objects.filter(slug__in=slugs)}
    missing = [s for s in slugs if s not in found]
    inactive = sorted(s for s, p in found.items() if p.status != Product.Status.ACTIVE and p.id not in kept)
    if missing:
        errors[field] = "Unknown app: " + ", ".join(missing) + "."
    elif inactive:
        errors[field] = "Only active apps can be included: " + ", ".join(inactive) + "."
    return sorted(found.values(), key=lambda p: (p.sort_order, p.name))


def _single_app(data, package, errors):
    if "apps" in data:
        errors["apps"] = "A single package belongs to one app; use app."
    if package is not None:
        if "app" in data and data["app"] != package.product.slug:
            errors["app"] = "A package's app cannot change."
        return [package.product]
    if not isinstance(data.get("app"), str):
        errors["app"] = "Choose the app."
        return []
    return _active_apps([data["app"]], errors, "app")


def _bundle_apps(data, current, errors):
    if "app" in data:
        errors["app"] = "A combined package includes several apps; use apps."
    if "apps" not in data and current is not None:
        return list(current.products.all())
    slugs = data.get("apps")
    if not isinstance(slugs, list) or not all(isinstance(s, str) for s in slugs):
        errors["apps"] = "List the apps by slug."
        return []
    kept = {p.id for p in current.products.all()} if current is not None else frozenset()
    apps = _active_apps(slugs, errors, "apps", kept)
    if "apps" not in errors and len(apps) < 2:
        errors["apps"] = "A combined package includes at least two apps."
    return apps


def _draft_terms(data, base, errors):
    values = {}
    if "price" in data:
        values["price"] = _decimal(data["price"])
        if values["price"] is None:
            errors["price"] = "Enter a price of 0 or more, with at most two decimals."
    if "currency" in data:
        values["currency"] = data["currency"]
        if not isinstance(data["currency"], str) or not CURRENCY_RE.match(data["currency"]):
            errors["currency"] = "Use a three-letter currency code, for example BDT."
    if "billing_interval" in data:
        values["billing_interval"] = data["billing_interval"]
        if data["billing_interval"] not in Package.BillingInterval.values:
            errors["billing_interval"] = "Choose free, monthly or yearly."
    if "price_unit" in data:
        values["price_unit"] = data["price_unit"]
        if data["price_unit"] not in Package.PriceUnit.values:
            errors["price_unit"] = "Choose per seat, per institution or flat."
    if "trial_days" in data:
        values["trial_days"] = _integer(data["trial_days"], 0, MAX_TRIAL_DAYS)
        if values["trial_days"] is None:
            errors["trial_days"] = f"Enter 0 to {MAX_TRIAL_DAYS} days."
    if "seat_limit" in data and data["seat_limit"] is not None:
        values["seat_limit"] = _integer(data["seat_limit"], 1, MAX_SEATS)
        if values["seat_limit"] is None:
            errors["seat_limit"] = "Enter a positive number of seats, or leave it empty for unlimited."
    elif "seat_limit" in data:
        values["seat_limit"] = None
    terms = replace(base, **{k: v for k, v in values.items() if k not in errors})
    if "price" not in errors and "billing_interval" not in errors:
        if terms.billing_interval == FREE and terms.price != 0:
            errors["price"] = "A free package costs 0."
        elif terms.billing_interval != FREE and terms.price <= 0:
            errors["price"] = "A paid package needs a price above 0."
    return terms


def _uuid(value):
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        return None


def _draft_limit(item, index, features, errors):
    prefix = f"limits.{index}."
    feature = features.get(_uuid(item.get("feature_id")))
    if feature is None:
        errors[prefix + "feature_id"] = "Choose a feature."
    value = _integer(item.get("limit_value"), 0, MAX_LIMIT)
    if value is None:
        errors[prefix + "limit_value"] = "Enter a whole number of 0 or more."
    period = item.get("limit_period", PackageLimit.Period.MONTHLY)
    if period not in PackageLimit.Period.values:
        errors[prefix + "limit_period"] = "Choose daily, weekly, monthly, yearly or lifetime."
    on_limit = item.get("on_limit", PackageLimit.OnLimit.BLOCK)
    if on_limit not in PackageLimit.OnLimit.values:
        errors[prefix + "on_limit"] = "Choose block or warn."
    return {"feature": feature, "limit_value": value, "limit_period": period, "on_limit": on_limit}


def _draft_limits(data, current, errors):
    if "limits" not in data:
        return [limit_terms(lim) for lim in current.limits.all()] if current is not None else []
    items = data["limits"]
    if not isinstance(items, list) or not all(isinstance(i, dict) for i in items):
        errors["limits"] = "Send a list of limits."
        return []
    ids = {_uuid(i.get("feature_id")) for i in items} - {None}
    features = {str(f.id): f for f in Feature.objects.select_related("product").filter(id__in=ids)}
    limits, seen = [], set()
    for index, item in enumerate(items):
        limit = _draft_limit(item, index, features, errors)
        feature = limit["feature"]
        if feature is not None and feature.id in seen:
            errors[f"limits.{index}.feature_id"] = "This feature already has a limit."
        if feature is not None:
            seen.add(feature.id)
        limits.append(limit)
    return limits


def _check_limit_apps(limits, products):
    included = {p.id for p in products}
    outside = {
        f"limits.{i}.feature_id": "This feature belongs to an app the package does not include."
        for i, lim in enumerate(limits)
        if lim["feature"].product_id not in included
    }
    if outside:
        raise ServiceError(
            "feature_not_in_package", "Limits can only use features of the included apps.", fields=outside,
        )


def _presentation(data, errors, *, partial):
    """Validated name, description, audience, is_public, highlight, sort_order (and slug when creating)."""
    out = {}
    if not partial or "name" in data:
        out["name"] = clean_name(data.get("name"))
        if len(out["name"]) < 2:
            errors["name"] = "Enter the package's name."
    if not partial:
        slug = data.get("slug").strip() if isinstance(data.get("slug"), str) else ""
        if not SLUG_RE.match(slug) or len(slug) > MAX_SLUG:
            errors["slug"] = "Use lowercase letters, digits and single hyphens (up to 100)."
        out["slug"] = slug
    defaults = {"description": "", "audience": "", "is_public": True, "highlight": False, "sort_order": 0}
    for key, default in defaults.items():
        if key not in data:
            if not partial:
                out[key] = default
            continue
        if isinstance(default, bool):
            out[key] = data[key]
            if not isinstance(data[key], bool):
                errors[key] = "Use true or false."
        elif key == "sort_order":
            out[key] = _integer(data[key], *SORT_RANGE)
            if out[key] is None:
                errors[key] = "Enter a whole number."
        else:
            out[key] = _text(data, key, errors)
    if len(out.get("audience", "")) > 255:
        errors["audience"] = "Keep it under 255 characters."
    return out


def clean_draft(data, *, package=None, current=None):
    """A `PackageDraft` body as a `Draft`. Creating (`package` None) needs kind, app/apps, name and slug; for an
    existing package only the commercial part counts and anything left out keeps `current`'s value."""
    if not isinstance(data, dict):
        raise invalid({"non_field": "Send a JSON object."})
    kind = package.kind if package is not None else data.get("kind")
    if kind not in Package.Kind.values:
        raise invalid({"kind": "Choose single or bundle."})
    errors = {}
    products = _single_app(data, package, errors) if kind == SINGLE else _bundle_apps(data, current, errors)
    terms = _draft_terms(data, Terms.of(current) if current is not None else Terms(), errors)
    limits = _draft_limits(data, current, errors)
    presentation = _presentation(data, errors, partial=False) if package is None else {}
    if errors:
        raise invalid(errors)
    _check_limit_apps(limits, products)
    return Draft(kind=kind, products=products, terms=terms, limits=limits, presentation=presentation)


def limit_terms(limit):
    return {"feature": limit.feature, **{key: getattr(limit, key) for key in LIMIT_STATE}}


def _limit_state(limit):
    return {key: limit[key] for key in LIMIT_STATE}


def _by_order(products):
    return sorted(products, key=lambda p: (p.sort_order, p.name))


def version_changes(current, draft):
    """What `draft` changes against `current`: terms, then apps, then limits (in the draft's order, removed
    ones last)."""
    before, after = Terms.of(current), draft.terms
    changes = [
        TermChange(name, getattr(before, name), getattr(after, name))
        for name in TERM_FIELDS
        if getattr(before, name) != getattr(after, name)
    ]
    old_apps = {p.id: p for p in current.products.all()}
    new_apps = {p.id: p for p in draft.products}
    added = _by_order(p for pid, p in new_apps.items() if pid not in old_apps)
    removed = _by_order(p for pid, p in old_apps.items() if pid not in new_apps)
    if added or removed:
        changes.append(AppsChange(added, removed))
    old_limits = {lim.feature_id: limit_terms(lim) for lim in current.limits.all()}
    new_limits = {lim["feature"].id: lim for lim in draft.limits}
    for fid, lim in new_limits.items():
        old = old_limits.get(fid)
        if old is None or _limit_state(old) != _limit_state(lim):
            changes.append(LimitChange(lim["feature"], old and _limit_state(old), _limit_state(lim)))
    changes.extend(
        LimitChange(lim["feature"], _limit_state(lim), None)
        for fid, lim in old_limits.items()
        if fid not in new_limits
    )
    return changes


# ---------------------------------------------------------------- superadmin actions

def _slug_taken():
    return ServiceError(
        "slug_taken", "Another package already uses this slug.", status=409, fields={"slug": "Choose another slug."},
    )


def _check_slug(draft):
    product = draft.products[0] if draft.kind == SINGLE else None
    if Package.objects.filter(product=product, slug=draft.presentation["slug"]).exists():
        raise _slug_taken()


def create_package(data, *, actor, ip_address=None):
    """POST config/packages/: a single or combined package with its v1."""
    draft = clean_draft(data)
    try:
        with transaction.atomic():
            _check_slug(draft)
            pkg, _ = create_package_with_version(
                kind=draft.kind,
                product=draft.products[0] if draft.kind == SINGLE else None,
                products=draft.products,
                limits=draft.limits,
                actor=actor,
                ip_address=ip_address,
                **draft.terms.values(),
                **draft.presentation,
            )
    except IntegrityError:
        raise _slug_taken() from None
    return pkg


def update_presentation(package_id, data, *, actor, ip_address=None):
    """PATCH config/packages/<id>/: name, description, audience, is_public, highlight, sort_order."""
    if not isinstance(data, dict):
        raise invalid({"non_field": "Send a JSON object."})
    commercial = sorted(COMMERCIAL_KEYS & data.keys())
    if commercial:
        raise ServiceError(
            "use_new_version", "Price, apps, seats and limits change by publishing a new version.",
            fields={key: "Publish a new version to change this." for key in commercial},
        )
    errors = {key: "This cannot change." for key in FIXED_KEYS if key in data}
    fields = _presentation(data, errors, partial=True)
    if errors:
        raise invalid(errors)
    with transaction.atomic():
        pkg = _locked_package(package_id)
        changes = {k: [getattr(pkg, k), v] for k, v in fields.items() if getattr(pkg, k) != v}
        if not changes:
            return pkg
        for key, (_, new) in changes.items():
            setattr(pkg, key, new)
        pkg.save(update_fields=[*changes, "updated_at"])
        _audit(
            actor=actor, action="package.updated", target_type="Package", target_id=str(pkg.id),
            ip_address=ip_address, package_id=str(pkg.id), changes=changes,
        )
    return pkg


def preview_version(package_id, data):
    """POST config/packages/<id>/preview/: the changes a draft makes and the live subscriptions it may move."""
    pkg = Package.objects.filter(pk=package_id).select_related("product").first()
    if pkg is None:
        raise not_found("No package with this id.")
    current = _current(pkg)
    draft = clean_draft(data, package=pkg, current=current)
    return version_changes(current, draft), live_subscriptions(pkg)


def _selected(data, package):
    ids = data.get("selected_subscriptions")
    clean = [_uuid(i) for i in ids] if isinstance(ids, list) else []
    if not clean or None in clean:
        raise invalid({"selected_subscriptions": "Choose the subscriptions to move."})
    known = {str(i) for i in live_subscriptions(package).filter(id__in=clean).values_list("id", flat=True)}
    if known != set(clean):
        raise invalid({"selected_subscriptions": "Some of these are not live subscriptions of this package."})
    return clean


def publish_version(package_id, data, *, actor, ip_address=None):
    """POST config/packages/<id>/versions/: publish a draft as the next version and apply the migration policy."""
    if not isinstance(data, dict):
        raise invalid({"non_field": "Send a JSON object."})
    with transaction.atomic():
        pkg = _locked_package(package_id)
        current = _current(pkg)
        draft = clean_draft(data, package=pkg, current=current)
        reason = clean_name(data.get("change_reason"), limit=MAX_REASON)
        if not reason:
            raise invalid({"change_reason": "Say why this version changes; it is kept in the version history."})
        policy = data.get("migration_policy")
        if policy not in PackageVersion.MigrationPolicy.values:
            raise invalid({"migration_policy": "Choose when existing subscribers move to this version."})
        selected = _selected(data, pkg) if policy == PackageVersion.MigrationPolicy.SELECTED_ONLY else None
        if not version_changes(current, draft):
            raise ServiceError("no_changes", "This draft changes nothing, so there is no new version to publish.")
        _, stats = publish_new_package_version(
            package=pkg, limits=draft.limits, terms=draft.terms, products=draft.products,
            migration_policy=policy, selected_subscription_ids=selected, change_reason=reason,
            actor=actor, ip_address=ip_address,
        )
    return stats


def set_archived(package_id, archived, *, reason, actor, ip_address=None):
    """Archive (no new subscribers, hidden from the catalog; existing ones keep running) or restore."""
    if not reason:
        raise invalid({"reason": "Give a reason; it is kept in the audit log."})
    with transaction.atomic():
        pkg = _locked_package(package_id)
        if archived == (pkg.status == ARCHIVED):
            code = "already_archived" if archived else "not_archived"
            raise ServiceError(code, "The package is already in that state.", status=409)
        pkg.status = ARCHIVED if archived else Package.Status.ACTIVE
        pkg.save(update_fields=["status", "updated_at"])
        _audit(
            actor=actor, action="package.archived" if archived else "package.restored", target_type="Package",
            target_id=str(pkg.id), ip_address=ip_address, package_id=str(pkg.id), reason=reason,
        )
    return pkg


# ---------------------------------------------------------------- apps and features

def _features():
    return Feature.objects.annotate(in_use=Exists(PackageLimit.objects.filter(feature=OuterRef("pk"))))


def apps():
    """Apps in order with `features` (annotated `in_use`) and counts of packages that are not archived:
    `single_packages`, and `bundle_packages` whose latest version includes the app."""
    bundles = (
        latest_versions()
        .filter(package__kind=BUNDLE, products=OuterRef("pk"))
        .exclude(package__status=ARCHIVED)
        .order_by()
        .values("package__kind")
        .annotate(n=Count("pk"))
        .values("n")
    )
    return (
        Product.objects.annotate(
            single_packages=Count("packages", filter=Q(packages__kind=SINGLE) & ~Q(packages__status=ARCHIVED)),
            bundle_packages=Coalesce(Subquery(bundles, output_field=IntegerField()), 0),
        )
        .prefetch_related(Prefetch("features", queryset=_features().order_by("name", "key")))
        .order_by("sort_order", "name")
    )


def _plain_app(slug):
    product = Product.objects.filter(slug=slug).first()
    if product is None:
        raise not_found("No app with this slug.")
    return product


def load_app(slug):
    product = apps().filter(slug=slug).first()
    if product is None:
        raise not_found("No app with this slug.")
    return product


def _app_fields(data):
    errors, out = {}, {}
    if "name" in data:
        out["name"] = clean_name(data["name"])
        if len(out["name"]) < 2:
            errors["name"] = "Enter the app's name."
    if "description" in data:
        out["description"] = _text(data, "description", errors)
    if "status" in data:
        out["status"] = data["status"]
        if data["status"] not in Product.Status.values:
            errors["status"] = "Choose active, inactive or archived."
    if "sort_order" in data:
        out["sort_order"] = _integer(data["sort_order"], *SORT_RANGE)
        if out["sort_order"] is None:
            errors["sort_order"] = "Enter a whole number."
    if errors:
        raise invalid(errors)
    return out


def update_app(slug, data, *, actor, ip_address=None):
    """PATCH config/apps/<slug>/: name, description, status, sort_order."""
    if not isinstance(data, dict):
        raise invalid({"non_field": "Send a JSON object."})
    fields = _app_fields(data)
    with transaction.atomic():
        product = Product.objects.select_for_update().get(pk=_plain_app(slug).pk)
        changes = {k: [getattr(product, k), v] for k, v in fields.items() if getattr(product, k) != v}
        if changes:
            for key, (_, new) in changes.items():
                setattr(product, key, new)
            product.save(update_fields=[*changes, "updated_at"])
            _audit(
                actor=actor, action="product.updated", target_type="Product", target_id=str(product.id),
                ip_address=ip_address, product_id=str(product.id), changes=changes,
            )
    return product


def _feature_fields(data, *, partial):
    errors, out = {}, {}
    if not partial or "key" in data:
        out["key"] = data.get("key")
        if not isinstance(out["key"], str) or not FEATURE_KEY_RE.match(out["key"]):
            errors["key"] = "Use 2 to 64 lowercase letters, digits or underscores."
    if not partial or "name" in data:
        out["name"] = clean_name(data.get("name"))
        if len(out["name"]) < 2:
            errors["name"] = "Enter the feature's name."
    if not partial or "unit" in data:
        out["unit"] = clean_name(data.get("unit"), limit=64)
        if not out["unit"]:
            errors["unit"] = "Enter the unit it is counted in, for example requests."
    if "description" in data:
        out["description"] = _text(data, "description", errors)
    if "quota_policy" in data:
        out["quota_policy"] = data["quota_policy"]
        if data["quota_policy"] not in Feature.QuotaPolicy.values:
            errors["quota_policy"] = "Choose a quota policy."
    if partial and "status" in data:
        out["status"] = data["status"]
        if data["status"] not in Feature.Status.values:
            errors["status"] = "Choose active or inactive."
    if errors:
        raise invalid(errors)
    return out


def _key_taken():
    return ServiceError(
        "key_taken", "This app already has a feature with this key.", status=409, fields={"key": "Choose another key."},
    )


def _check_key(product_id, key, exclude=None):
    if Feature.objects.filter(product_id=product_id, key=key).exclude(pk=exclude).exists():
        raise _key_taken()


def load_feature(feature_id):
    return _features().get(pk=feature_id)


def create_feature(slug, data, *, actor, ip_address=None):
    """POST config/apps/<slug>/features/."""
    if not isinstance(data, dict):
        raise invalid({"non_field": "Send a JSON object."})
    product = _plain_app(slug)
    fields = _feature_fields(data, partial=False)
    try:
        with transaction.atomic():
            _check_key(product.id, fields["key"])
            feature = Feature.objects.create(product=product, **fields)
            _audit(
                actor=actor, action="feature.created", target_type="Feature", target_id=str(feature.id),
                ip_address=ip_address, product_id=str(product.id), key=feature.key,
            )
    except IntegrityError:
        raise _key_taken() from None
    return load_feature(feature.pk)


def update_feature(feature_id, data, *, actor, ip_address=None):
    """PATCH config/features/<id>/: a feature that any package version limits keeps its key and unit."""
    if not isinstance(data, dict):
        raise invalid({"non_field": "Send a JSON object."})
    fields = _feature_fields(data, partial=True)
    with transaction.atomic():
        feature = Feature.objects.select_for_update().filter(pk=feature_id).first()
        if feature is None:
            raise not_found("No feature with this id.")
        changes = {k: [getattr(feature, k), v] for k, v in fields.items() if getattr(feature, k) != v}
        locked = sorted({"key", "unit"} & changes.keys())
        if locked and PackageLimit.objects.filter(feature=feature).exists():
            raise ServiceError(
                "feature_in_use", "Packages limit this feature, so its key and unit cannot change.", status=409,
                fields={key: "In use by a package." for key in locked},
            )
        if "key" in changes:
            _check_key(feature.product_id, fields["key"], exclude=feature.pk)
        if changes:
            for key, (_, new) in changes.items():
                setattr(feature, key, new)
            try:
                with transaction.atomic():
                    feature.save(update_fields=list(changes))
            except IntegrityError:
                raise _key_taken() from None
            _audit(
                actor=actor, action="feature.updated", target_type="Feature", target_id=str(feature.id),
                ip_address=ip_address, product_id=str(feature.product_id), changes=changes,
            )
    return load_feature(feature.pk)


# ---------------------------------------------------------------- public catalog

def public_packages():
    """Packages people can subscribe to (active and public), each with `current_versions`: its latest version
    when that is active, with only its active apps and their limits."""
    active = Product.Status.ACTIVE
    versions = (
        latest_versions().filter(status=PackageVersion.Status.ACTIVE)
        .prefetch_related(
            _ordered_apps(Product.objects.filter(status=active)),
            _limits_prefetch(PackageLimit.objects.filter(feature__product__status=active)),
        )
    )
    return (
        Package.objects.filter(status=Package.Status.ACTIVE, is_public=True)
        .prefetch_related(Prefetch("versions", queryset=versions, to_attr="current_versions"))
        .order_by("sort_order", "price", "name")
    )
