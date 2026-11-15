from django.urls import path

from . import views

urlpatterns = [
    path("summary/", views.AdminDashboardSummaryView.as_view()),
    path("users/", views.AdminUsersView.as_view()),
    path("organizations/", views.AdminOrganizationsView.as_view()),
    path("catalog/", views.AdminProductsAndPackagesView.as_view()),
    path("subscriptions/", views.AdminSubscriptionsAndBillingView.as_view()),
    path("usage-audit/", views.AdminUsageAndAuditView.as_view()),
]
