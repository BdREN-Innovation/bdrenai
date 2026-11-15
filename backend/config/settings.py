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

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle", "rest_framework.throttling.UserRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"anon": "60/min", "user": "600/min", "auth": "20/min"},
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
LANGUAGE_CODE = "en-us"
STATIC_URL = "static/"
