"""bKash tokenized checkout (v1.2.0-beta) client: token grant, create, execute, status, search, refund.

Settings come from the environment (docs/BILLING_API.md "Settings"). The id_token is cached for 55 minutes. Nothing
here logs credentials, tokens or payer numbers: only the endpoint, HTTP status and bKash's status code.
"""
import logging
from decimal import Decimal
from urllib.parse import urlsplit

import requests
from django.conf import settings
from django.core.cache import cache

log = logging.getLogger(__name__)

SUCCESS = "0000"
NOT_FOUND = "2033"  # "Transaction Not Found": right after execute, the status query may not see it yet
INVALID_STATE = "2056"  # execute on a payment the payer did not approve
TOKEN_CACHE_KEY = "billing:bkash:id_token"
TOKEN_TTL = 55 * 60

COMPLETED = "Completed"
INITIATED = "Initiated"


class BkashError(Exception):
    """bKash refused a call (`code` is its statusCode / errorCode) or did not answer (`network`, `bad_response`)."""

    def __init__(self, code, message):
        super().__init__(f"{message} ({code})")
        self.code = str(code)
        self.message = message


def enabled():
    return all((settings.BKASH_APP_KEY, settings.BKASH_APP_SECRET, settings.BKASH_USERNAME, settings.BKASH_PASSWORD))


def mode():
    """`sandbox`, `live`, or `off` when bKash is not configured."""
    if not enabled():
        return "off"
    return "sandbox" if "sandbox" in settings.BKASH_BASE_URL else "live"


def mask_account(number):
    """`01770618567` -> `********567`."""
    digits = (number or "").strip()
    if not digits:
        return ""
    return "*" * max(len(digits) - 3, 0) + digits[-3:]


def money(amount):
    return f"{Decimal(amount):.2f}"


def _url(path):
    return settings.BKASH_BASE_URL.rstrip("/") + "/" + path


def _post(path, body, headers):
    try:
        response = requests.post(_url(path), json=body, headers=headers, timeout=settings.BKASH_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        log.warning("bkash call failed path=%s error=%s", path, type(exc).__name__)
        raise BkashError("network", "bKash did not answer.") from None
    try:
        data = response.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        log.warning("bkash bad response path=%s http=%s", path, response.status_code)
        raise BkashError("bad_response", "bKash sent an unexpected answer.")
    code = data.get("statusCode") or data.get("errorCode")
    log.info("bkash call path=%s http=%s status=%s", path, response.status_code, code)
    if response.status_code == 401:
        raise BkashError("unauthorized", data.get("message") or "bKash rejected the credentials.")
    if code is not None and str(code) != SUCCESS:
        raise BkashError(code, data.get("statusMessage") or data.get("errorMessage") or "bKash refused the request.")
    if response.status_code >= 400:
        raise BkashError(f"http_{response.status_code}", "bKash refused the request.")
    return data


def grant_token():
    data = _post(
        "checkout/token/grant",
        {"app_key": settings.BKASH_APP_KEY, "app_secret": settings.BKASH_APP_SECRET},
        {
            "username": settings.BKASH_USERNAME, "password": settings.BKASH_PASSWORD,
            "Content-Type": "application/json", "Accept": "application/json",
        },
    )
    token = data.get("id_token")
    if not token:
        raise BkashError("bad_response", "bKash did not issue a token.")
    return token


def token():
    cached = cache.get(TOKEN_CACHE_KEY)
    if cached:
        return cached
    fresh = grant_token()
    cache.set(TOKEN_CACHE_KEY, fresh, TOKEN_TTL)
    return fresh


def call(path, body):
    """An authorised call; a rejected token is dropped and granted again once."""
    if not enabled():
        raise BkashError("not_configured", "bKash is not configured.")
    for attempt in (1, 2):
        headers = {
            "Authorization": token(), "X-App-Key": settings.BKASH_APP_KEY,
            "Content-Type": "application/json", "Accept": "application/json",
        }
        try:
            return _post(path, body, headers)
        except BkashError as exc:
            if exc.code != "unauthorized" or attempt == 2:
                raise
            cache.delete(TOKEN_CACHE_KEY)
    raise AssertionError("unreachable")


def create_payment(*, amount, invoice, payer_reference, callback_url=None):
    """`{"paymentID", "bkashURL", ...}`."""
    data = call("checkout/create", {
        "mode": "0011",
        "payerReference": payer_reference,
        "callbackURL": callback_url or settings.BKASH_CALLBACK_URL,
        "amount": money(amount),
        "currency": "BDT",
        "intent": "sale",
        "merchantInvoiceNumber": invoice,
    })
    if not data.get("paymentID") or not data.get("bkashURL"):
        raise BkashError("bad_response", "bKash did not return a checkout page.")
    if not is_checkout_url(data["bkashURL"]):
        log.warning("bkash returned an unexpected checkout host")
        raise BkashError("bad_response", "bKash returned an unexpected checkout address.")
    return data


CHECKOUT_HOSTS = ("bka.sh", "bkash.com")


def is_checkout_url(value):
    """True for an https URL on bKash's own domains (bka.sh, bkash.com and their subdomains), without credentials."""
    try:
        parts = urlsplit(value or "")
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or parts.username or parts.password or not host:
        return False
    return any(host == domain or host.endswith("." + domain) for domain in CHECKOUT_HOSTS)


def execute(payment_id):
    return call("checkout/execute", {"paymentID": payment_id})


def status(payment_id):
    return call("checkout/payment/status", {"paymentID": payment_id})


def search(trx_id):
    return call("checkout/general/searchTransaction", {"trxID": trx_id})


def refund(*, payment_id, trx_id, amount, sku, reason):
    return call("checkout/payment/refund", {
        "paymentID": payment_id, "amount": money(amount), "trxID": trx_id, "sku": sku[:255], "reason": reason[:255],
    })


def refund_status(*, payment_id, trx_id):
    return call("checkout/payment/refund", {"paymentID": payment_id, "trxID": trx_id})
