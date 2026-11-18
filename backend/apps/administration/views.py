"""RBAC-protected administrative APIs for admin.bdren.ai / bdren.ai/admin."""
from django.db.models import Count, Sum
from django.http import JsonResponse
from rest_framework.views import APIView

from apps.accounts.models import Account
from apps.audit.models import AuditLog
from apps.audit.services import record_audit
from apps.billing.models import PaymentRecord
from apps.billing.services import verify_manual_payment
from apps.entitlements.services import set_entitlement_override
from apps.identities.models import User
from apps.organizations.models import Membership, Organization
from apps.organizations.services import create_organization, register_institutional_idp
from apps.packages.models import Package, PackageVersion
from apps.packages.services import (
    create_package_with_version,
    publish_new_package_version,
)
from apps.products.models import Feature, Product
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import (
    cancel_subscription,
    change_subscription_package,
    create_subscription,
    renew_subscription,
)
from apps.usage.models import UsageCounter

from .models import PlatformRoleAssignment
from .permissions import HasPlatformRole, user_platform_roles

ALL_ADMIN_ROLES = set(PlatformRoleAssignment.Role.values)


class AdminDashboardSummaryView(APIView):
    permission_classes = [HasPlatformRole]
    required_roles = ALL_ADMIN_ROLES

    def get(self, request):
        rev = PaymentRecord.objects.filter(status=PaymentRecord.Status.COMPLETED).aggregate(t=Sum("amount"))["t"] or 0
        recent_audit = [
            {
                "id": str(a.id),
                "action": a.action,
                "target_type": a.target_type,
                "target_id": a.target_id,
                "actor_email": a.actor.email if a.actor else None,
                "created_at": a.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            for a in AuditLog.objects.select_related("actor")[:15]
        ]
        return JsonResponse({
            "roles": sorted(user_platform_roles(request.user)),
            "metrics": {
                "total_users": User.objects.count(),
                "active_organizations": Organization.objects.filter(status=Organization.Status.ACTIVE).count(),
                "active_subscriptions": Subscription.objects.filter(
                    status__in=[Subscription.Status.ACTIVE, Subscription.Status.TRIAL]
                ).count(),
                "total_products": Product.objects.filter(status=Product.Status.ACTIVE).count(),
                "completed_revenue_bdt": str(rev),
                "pending_payments": PaymentRecord.objects.filter(status=PaymentRecord.Status.PENDING).count(),
            },
            "recent_events": recent_audit,
        })


class AdminUsersView(APIView):
    permission_classes = [HasPlatformRole]
    required_roles = {
        PlatformRoleAssignment.Role.IDENTITY_ADMIN,
        PlatformRoleAssignment.Role.SUPPORT_ADMIN,
    }

    def get(self, request):
        q = (request.GET.get("q") or "").strip()
        qs = User.objects.prefetch_related("external_identities", "memberships__organization", "platform_roles").order_by("-created_at")
        if q:
            from django.db.models import Q
            qs = qs.filter(Q(email__icontains=q) | Q(name__icontains=q) | Q(zitadel_subject__icontains=q))
        items = []
        for u in qs[:100]:
            items.append({
                "id": str(u.id),
                "email": u.email,
                "name": u.name,
                "zitadel_subject": u.zitadel_subject,
                "status": u.status,
                "platform_roles": [r.role for r in u.platform_roles.all()],
                "identities": [{"issuer": e.issuer, "subject": e.subject, "type": e.provider_type} for e in u.external_identities.all()],
                "memberships": [{"org": m.organization.slug, "role": m.role, "status": m.status} for m in u.memberships.all()],
            })
        return JsonResponse({"users": items})

    def patch(self, request):
        uid = request.data.get("user_id")
        new_status = request.data.get("status")
        if new_status not in User.Status.values:
            return JsonResponse({"error": "invalid_status"}, status=400)
        u = User.objects.filter(id=uid).first()
        if u is None:
            return JsonResponse({"error": "user_not_found"}, status=404)
        u.status = new_status
        u.save(update_fields=["status"])
        record_audit(actor=request.user, action="user.status_changed", target_type="User", target_id=str(u.id), metadata={"status": new_status})
        return JsonResponse({"id": str(u.id), "status": u.status})


class AdminOrganizationsView(APIView):
    permission_classes = [HasPlatformRole]
    required_roles = {
        PlatformRoleAssignment.Role.ORG_ADMIN,
        PlatformRoleAssignment.Role.IDENTITY_ADMIN,
    }

    def get(self, request):
        orgs = Organization.objects.select_related("account").prefetch_related("identity_providers").annotate(
            member_count=Count("memberships")
        ).order_by("name")
        return JsonResponse({
            "organizations": [
                {
                    "id": str(o.id),
                    "account_id": str(o.account.id) if hasattr(o, "account") else None,
                    "name": o.name,
                    "slug": o.slug,
                    "zitadel_organization_id": o.zitadel_organization_id,
                    "status": o.status,
                    "member_count": o.member_count,
                    "identity_providers": [
                        {"id": str(i.id), "name": i.name, "protocol": i.protocol, "zitadel_idp_id": i.zitadel_idp_id, "status": i.status}
                        for i in o.identity_providers.all()
                    ],
                }
                for o in orgs
            ]
        })

    def post(self, request):
        action = request.data.get("action", "create_org")
        if action == "create_org":
            org = create_organization(
                name=request.data["name"],
                slug=request.data["slug"],
                zitadel_organization_id=request.data.get("zitadel_organization_id") or None,
            )
            record_audit(actor=request.user, action="organization.created", target_type="Organization", target_id=str(org.id))
            return JsonResponse({"id": str(org.id), "account_id": str(org.account.id), "slug": org.slug}, status=201)
        if action == "register_idp":
            org = Organization.objects.get(id=request.data["organization_id"])
            idp = register_institutional_idp(
                organization=org,
                name=request.data["name"],
                protocol=request.data["protocol"],
                zitadel_idp_id=request.data["zitadel_idp_id"],
                issuer_or_entity_id=request.data["issuer_or_entity_id"],
                auto_join_role=request.data.get("auto_join_role", Membership.Role.MEMBER),
            )
            record_audit(actor=request.user, action="idp.registered", target_type="InstitutionalIdentityProvider", target_id=str(idp.id))
            return JsonResponse({"idp_id": str(idp.id)}, status=201)
        return JsonResponse({"error": "unknown_action"}, status=400)


class AdminProductsAndPackagesView(APIView):
    permission_classes = [HasPlatformRole]
    required_roles = {PlatformRoleAssignment.Role.PRODUCT_MANAGER}

    def post(self, request):
        action = request.data.get("action")
        if action == "create_product":
            prod = Product.objects.create(
                name=request.data["name"],
                slug=request.data["slug"],
                description=request.data.get("description", ""),
                status=request.data.get("status", Product.Status.ACTIVE),
            )
            raw_key = prod.rotate_api_key()
            record_audit(actor=request.user, action="product.created", target_type="Product", target_id=str(prod.id))
            return JsonResponse({"id": str(prod.id), "slug": prod.slug, "api_key": raw_key}, status=201)

        if action == "create_feature":
            prod = Product.objects.get(id=request.data["product_id"])
            feat = Feature.objects.create(
                product=prod,
                key=request.data["key"],
                name=request.data["name"],
                description=request.data.get("description", ""),
                unit=request.data.get("unit", "count"),
                quota_policy=request.data.get("quota_policy", Feature.QuotaPolicy.PERSONAL_THEN_ORG),
            )
            record_audit(actor=request.user, action="feature.created", target_type="Feature", target_id=str(feat.id))
            return JsonResponse({"id": str(feat.id), "key": feat.key, "quota_policy": feat.quota_policy}, status=201)

        if action == "create_package":
            prod = Product.objects.get(id=request.data["product_id"])
            limits_in = []
            for lim in request.data.get("limits", []):
                feat = Feature.objects.get(product=prod, key=lim["feature_key"])
                limits_in.append({
                    "feature": feat,
                    "limit_value": int(lim["limit_value"]),
                    "limit_period": lim.get("limit_period", "monthly"),
                })
            pkg, ver = create_package_with_version(
                product=prod,
                name=request.data["name"],
                slug=request.data["slug"],
                description=request.data.get("description", ""),
                price=request.data.get("price", 0),
                currency=request.data.get("currency", "BDT"),
                billing_interval=request.data.get("billing_interval", Package.BillingInterval.MONTHLY),
                trial_days=int(request.data.get("trial_days", 0)),
                limits=limits_in,
                actor=request.user,
            )
            return JsonResponse({"package_id": str(pkg.id), "package_version_id": str(ver.id), "version": ver.version}, status=201)

        if action == "publish_package_version":
            pkg = Package.objects.select_related("product").get(id=request.data["package_id"])
            limits_in = []
            for lim in request.data.get("limits", []):
                feat = Feature.objects.get(product=pkg.product, key=lim["feature_key"])
                limits_in.append({
                    "feature": feat,
                    "limit_value": int(lim["limit_value"]),
                    "limit_period": lim.get("limit_period", "monthly"),
                })
            ver, stats = publish_new_package_version(
                package=pkg,
                limits=limits_in,
                migration_policy=request.data.get("migration_policy", PackageVersion.MigrationPolicy.NEW_ONLY),
                selected_subscription_ids=request.data.get("selected_subscription_ids"),
                actor=request.user,
            )
            return JsonResponse({"package_version_id": str(ver.id), "version": ver.version, **stats}, status=201)

        return JsonResponse({"error": "unknown_action"}, status=400)


class AdminSubscriptionsAndBillingView(APIView):
    permission_classes = [HasPlatformRole]
    required_roles = {
        PlatformRoleAssignment.Role.BILLING_ADMIN,
        PlatformRoleAssignment.Role.SUPPORT_ADMIN,
    }

    def get(self, request):
        subs = Subscription.objects.select_related("account", "product", "package_version__package").order_by("-created_at")[:100]
        payments = PaymentRecord.objects.select_related("account").order_by("-created_at")[:100]
        return JsonResponse({
            "subscriptions": [
                {
                    "id": str(s.id),
                    "account_id": str(s.account_id),
                    "account_type": s.account.account_type,
                    "product": s.product.slug,
                    "package": s.package_version.package.name,
                    "version": s.package_version.version,
                    "pending_version": s.pending_package_version.version if s.pending_package_version_id else None,
                    "status": s.status,
                    "expires_at": s.expires_at.strftime("%Y-%m-%dT%H:%M:%SZ") if s.expires_at else None,
                }
                for s in subs
            ],
            "payments": [
                {
                    "id": str(p.id),
                    "account_id": str(p.account_id),
                    "amount": str(p.amount),
                    "currency": p.currency,
                    "provider": p.provider,
                    "reference": p.reference,
                    "status": p.status,
                }
                for p in payments
            ],
        })

    def post(self, request):
        action = request.data.get("action")
        if action == "assign_subscription":
            acct = Account.objects.get(id=request.data["account_id"])
            ver = PackageVersion.objects.get(id=request.data["package_version_id"])
            sub = create_subscription(account=acct, package_version=ver, actor=request.user, notes=request.data.get("notes", ""))
            return JsonResponse({"subscription_id": str(sub.id), "status": sub.status}, status=201)
        if action == "change_package":
            sub = Subscription.objects.get(id=request.data["subscription_id"])
            ver = PackageVersion.objects.get(id=request.data["new_package_version_id"])
            sub = change_subscription_package(
                subscription=sub,
                new_package_version=ver,
                change_type=request.data.get("change_type", "upgraded"),
                actor=request.user,
            )
            return JsonResponse({"subscription_id": str(sub.id), "version": sub.package_version.version})
        if action == "renew":
            sub = Subscription.objects.get(id=request.data["subscription_id"])
            sub = renew_subscription(subscription=sub, actor=request.user)
            return JsonResponse({"subscription_id": str(sub.id), "version": sub.package_version.version})
        if action == "cancel":
            sub = Subscription.objects.get(id=request.data["subscription_id"])
            sub = cancel_subscription(subscription=sub, actor=request.user)
            return JsonResponse({"subscription_id": str(sub.id), "status": sub.status})
        if action == "verify_payment":
            pmt = PaymentRecord.objects.get(id=request.data["payment_id"])
            ver = PackageVersion.objects.filter(id=request.data.get("package_version_id")).first()
            pmt = verify_manual_payment(
                payment=pmt,
                verifier_user=request.user,
                approve=bool(request.data.get("approve", True)),
                activate_package_version=ver,
            )
            return JsonResponse({"payment_id": str(pmt.id), "status": pmt.status, "subscription_id": str(pmt.subscription_id) if pmt.subscription_id else None})
        if action == "entitlement_override":
            acct = Account.objects.get(id=request.data["account_id"])
            prod = Product.objects.get(slug=request.data["product"])
            feat = Feature.objects.get(product=prod, key=request.data["feature"])
            ent = set_entitlement_override(account=acct, product=prod, feature=feat, limit=int(request.data["limit"]))
            record_audit(actor=request.user, action="entitlement.override", target_type="Entitlement", target_id=str(ent.id))
            return JsonResponse({"entitlement_id": str(ent.id), "limit": ent.limit})
        return JsonResponse({"error": "unknown_action"}, status=400)


class AdminUsageAndAuditView(APIView):
    permission_classes = [HasPlatformRole]
    required_roles = ALL_ADMIN_ROLES

    def get(self, request):
        counters = UsageCounter.objects.select_related("account", "product", "feature").order_by("-updated_at")[:100]
        logs = AuditLog.objects.select_related("actor").order_by("-created_at")[:100]
        return JsonResponse({
            "usage_counters": [
                {
                    "account_id": str(c.account_id),
                    "account_type": c.account.account_type,
                    "product": c.product.slug,
                    "feature": c.feature.key,
                    "used": c.used,
                    "reserved": c.reserved,
                }
                for c in counters
            ],
            "audit_logs": [
                {
                    "id": str(a.id),
                    "action": a.action,
                    "target_type": a.target_type,
                    "target_id": a.target_id,
                    "actor": a.actor.email if a.actor else "system",
                    "metadata": a.metadata,
                    "created_at": a.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
                }
                for a in logs
            ],
        })
