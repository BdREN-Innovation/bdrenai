from django.http import JsonResponse
from django.urls import include, path

from apps.identities.views import CsrfView


def health_view(request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("api/v1/health/", health_view),
    path("api/v1/csrf/", CsrfView.as_view()),
    path("api/v1/auth/", include("apps.identities.urls")),
    path("api/v1/accounts/", include("apps.accounts.urls")),
    path("api/v1/catalog/", include("apps.products.urls")),
    path("api/v1/entitlements/", include("apps.entitlements.urls")),
    path("api/v1/usage/", include("apps.usage.urls")),
    path("api/v1/admin/", include("apps.administration.urls")),
    path("api/v1/invitations/", include("apps.invitations.urls")),
    path("api/v1/superadmin/", include("apps.superadmin.urls")),
    path("api/v1/portal/", include("apps.portal.urls")),
]
