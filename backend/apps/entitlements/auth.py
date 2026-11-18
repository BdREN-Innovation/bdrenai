"""Resolves the authenticated user, organization account context, and product authorization
for both browser BFF sessions and server-to-server (`X-Product-Api-Key`) calls.
Never trusts an unverified user_id or account_id from an untrusted caller.
"""
import secrets

from django.core.exceptions import PermissionDenied

from apps.accounts.models import Account
from apps.accounts.services import resolve_authorized_account
from apps.entitlements.services import covered_organization_account
from apps.identities.models import User
from apps.products.models import Product, hash_api_key


def resolve_caller_and_product(request, product_slug: str = None):
    """Returns (user, org_account, product). `org_account` is the account of the institution covering the user
    (found automatically, so apps need not send it), or None; an explicit `organization_account_id` must be one the
    user may use (403 otherwise).
    - If `X-Product-Api-Key` header is present: authenticates the server-to-server Product,
      enforces that `product_slug` (if given) matches that Product, and resolves the target `User`
      by validated `(issuer, zitadel_subject)` or `user_id`.
    - Otherwise requires an authenticated Django session (`request.user`).
    """
    raw_key = request.headers.get("X-Product-Api-Key", "").strip()
    has_body = request.method != "GET" and hasattr(request, "data") and isinstance(request.data, dict)
    data = request.data if has_body else request.GET

    if raw_key:
        key_hash = hash_api_key(raw_key)
        product = Product.objects.filter(api_key_hash=key_hash, status=Product.Status.ACTIVE).first()
        if product is None or not secrets.compare_digest(product.api_key_hash, key_hash):
            raise PermissionDenied("Invalid or inactive product API key")
        if product_slug and product.slug != product_slug:
            raise PermissionDenied("Product API key is not authorized for the requested product")

        sub = data.get("zitadel_subject")
        iss = data.get("issuer")
        uid = data.get("user_id")
        if sub and iss:
            user = User.objects.filter(issuer=iss, zitadel_subject=sub, status=User.Status.ACTIVE).first()
        elif uid:
            user = User.objects.filter(id=uid, status=User.Status.ACTIVE).first()
        else:
            raise PermissionDenied("Server-to-server call must specify (issuer, zitadel_subject) or user_id")
        if user is None:
            raise PermissionDenied("Target user not found or inactive")
    else:
        if not request.user or not request.user.is_authenticated or not request.user.is_active:
            raise PermissionDenied("Authentication required")
        user = request.user
        slug = product_slug or data.get("product")
        product = Product.objects.filter(slug=slug, status=Product.Status.ACTIVE).first() if slug else None
        if slug and product is None:
            raise PermissionDenied("Requested product not found or inactive")

    org_acct = covered_organization_account(user)
    requested = data.get("organization_account_id")
    if requested:
        acct = resolve_authorized_account(user, account_id=requested)
        if acct.account_type == Account.Type.ORGANIZATION:
            org_acct = acct

    return user, org_acct, product
