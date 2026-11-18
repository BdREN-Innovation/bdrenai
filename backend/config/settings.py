"""BDREN platform settings. All secrets come from the environment."""
import json
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and v in (None, ""):
        raise RuntimeError(f"Missing required environment variable {name}")
    return v


def env_list(name, default=""):
    return [x.strip() for x in env(name, default).split(",") if x.strip()]


DEBUG = env("DJANGO_DEBUG", "false").lower() == "true"
SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-insecure-key-not-for-production" if DEBUG else None, required=True)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "rest_framework",
    "apps.organizations",
    "apps.accounts",
    "apps.identities",
    "apps.administration",
    "apps.audit",
    "apps.usage",
    "apps.entitlements",
    "apps.billing",
    "apps.subscriptions",
    "apps.packages",
    "apps.products",
    "apps.invitations",
    "apps.superadmin",
    "apps.portal",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
AUTH_USER_MODEL = "identities.User"
# Passwords are never stored here: users are created with an unusable password
# and authenticate only through ZITADEL (see apps.identities).
AUTHENTICATION_BACKENDS = ["django.contrib.auth.backends.ModelBackend"]
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]

_db_name = env("BDREN_DB_NAME", "bdren")
DATABASES = {"default": {
    "ENGINE": "django.db.backends.postgresql",
    "NAME": _db_name,
    "USER": env("BDREN_DB_USER", "bdren"),
    "PASSWORD": env("BDREN_DB_PASSWORD", ""),
    "HOST": env("BDREN_DB_HOST", "postgres"),
    "PORT": env("BDREN_DB_PORT", "5432"),
    "CONN_MAX_AGE": 60,
}}

REDIS_URL = env("REDIS_URL", "redis://redis:6379/1")
CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL}}
if env("DJANGO_CACHE", "") == "locmem":
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# --- Sessions / cookies (BFF: Secure HttpOnly cookie, no tokens in the browser) ---
SESSION_ENGINE = "django.contrib.sessions.backends.db"  # durable; Redis is cache only
SESSION_COOKIE_NAME = "bdren_session"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_SAMESITE = "Lax"  # Lax is required for the OIDC redirect back from ZITADEL
SESSION_COOKIE_AGE = int(env("SESSION_COOKIE_AGE", str(8 * 3600)))
CSRF_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

# --- CORS allowlist handled explicitly (no wildcard) ---
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")

# --- OIDC (ZITADEL) ---
OIDC = {
    "ISSUER": env("OIDC_ISSUER", "http://auth.bdren.localhost:8080"),
    # Back-channel base URL if the public issuer isn't reachable from the container/host
    # (Host header is still set to the issuer's host). Empty = use the issuer URL.
    "INTERNAL_BASE_URL": env("OIDC_INTERNAL_BASE_URL", ""),
    "CLIENT_ID": env("OIDC_CLIENT_ID", ""),
    "CLIENT_SECRET": env("OIDC_CLIENT_SECRET", ""),
    "REDIRECT_URI": env("OIDC_REDIRECT_URI", "http://localhost:8000/api/v1/auth/callback/"),
    "POST_LOGOUT_REDIRECT_URI": env("OIDC_POST_LOGOUT_REDIRECT_URI", "http://localhost:8000/api/v1/auth/logged-out/"),
    "SCOPES": "openid profile email",
    "ALGORITHMS": ["RS256"],  # explicit allowlist; never 'none' or HS*
    "CLOCK_SKEW_SECONDS": 30,
    "HTTP_TIMEOUT": 10,
    # Post-login redirect allowlist (exact origins) — prevents open redirects.
    "ALLOWED_REDIRECT_ORIGINS": env_list("OIDC_ALLOWED_REDIRECT_ORIGINS", "http://localhost:8000"),
}

# --- Website sign-up (creates users in ZITADEL) ---
# PAT of a ZITADEL machine user with ORG_USER_MANAGER (scripts/bootstrap_zitadel.py creates it).
# Empty = sign-up endpoints answer 503 and the website falls back to ZITADEL's own registration.
ZITADEL_SERVICE_TOKEN = env("ZITADEL_SERVICE_TOKEN", "")

# --- Email (invitations) ---
EMAIL_BACKEND = env("EMAIL_BACKEND") or (
    "django.core.mail.backends.console.EmailBackend" if DEBUG else "django.core.mail.backends.smtp.EmailBackend"
)
EMAIL_HOST = env("EMAIL_HOST", "localhost")
EMAIL_PORT = int(env("EMAIL_PORT", "587"))
EMAIL_HOST_USER = env("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env("EMAIL_USE_TLS", "true").lower() == "true"
EMAIL_TIMEOUT = int(env("EMAIL_TIMEOUT", "10"))
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "BDREN AI <no-reply@bdren.ai>")

# Public origin of the website; invitation links point here (<PLATFORM_PUBLIC_URL>/invite/<token>).
PLATFORM_PUBLIC_URL = env("PLATFORM_PUBLIC_URL", "http://bdren.localhost:8080").rstrip("/")
INVITATION_TTL_DAYS = int(env("INVITATION_TTL_DAYS", "7"))
# Emails one request sends itself; bulk actions leave the rest queued for `manage.py send_invitation_emails --loop`.
INVITATION_INLINE_EMAILS = int(env("INVITATION_INLINE_EMAILS", "5"))
# One invitation is emailed at most once per this many minutes (Resend answers 429 resend_too_soon before that).
INVITATION_RESEND_COOLDOWN_MINUTES = int(env("INVITATION_RESEND_COOLDOWN_MINUTES", "5"))
# Per admin, across the superadmin and portal APIs: invite, resend, resend-expired, import, create-with-admin.
INVITATION_SEND_RATE = env("INVITATION_SEND_RATE", "120/hour")

# Peers whose X-Real-IP header names the client (the bundled nginx). The backend is reachable only on the
# internal Docker network, so private ranges are trusted by default; any other peer is recorded as itself.
TRUSTED_PROXIES = env_list("TRUSTED_PROXIES", "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle", "rest_framework.throttling.UserRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"anon": "60/min", "user": "600/min", "auth": "20/min", "invitations": "30/min"},
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
}

LOGGING = {
    "version": 1, "disable_existing_loggers": False,
    "formatters": {"json": {"format": '{"t":"%(asctime)s","lvl":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}'}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "json"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "UTC"
BDREN_USAGE_TIMEZONE = env("BDREN_USAGE_TIMEZONE", "Asia/Dhaka")
LANGUAGE_CODE = "en-us"
STATIC_URL = "static/"
