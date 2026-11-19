from django.urls import path

from . import billing, views

institution = "institutions/<slug:slug>/"

urlpatterns = [
    path("institutions/", views.InstitutionsView.as_view()),
    path(institution, views.InstitutionView.as_view()),
    path(institution + "members/", views.MembersView.as_view()),
    path(institution + "members/<uuid:membership_id>/", views.MemberView.as_view()),
    path(institution + "members/<uuid:membership_id>/remove/", views.MemberRemoveView.as_view()),
    path(institution + "members/<uuid:membership_id>/cover/", views.MemberCoverView.as_view()),
    path(institution + "invitations/", views.InvitationsView.as_view()),
    path(institution + "invitations/<uuid:invitation_id>/resend/", views.InvitationResendView.as_view()),
    path(institution + "invitations/<uuid:invitation_id>/revoke/", views.InvitationRevokeView.as_view()),
    path(institution + "import/", views.ImportView.as_view()),
    path(institution + "dashboard/", views.DashboardView.as_view()),
    path(institution + "usage/", views.UsageView.as_view()),
    path(institution + "usage/export.csv", views.UsageExportView.as_view()),
    path(institution + "domains/", views.DomainsView.as_view()),
    path(institution + "billing/", billing.BillingView.as_view()),
    path(institution + "billing/checkout/", billing.CheckoutView.as_view()),
    path(institution + "billing/downgrade/", billing.DowngradeView.as_view()),
    path(institution + "billing/payments/<uuid:pk>/abandon/", billing.AbandonView.as_view()),
    path(institution + "billing/payments/<uuid:pk>/receipt/", billing.ReceiptView.as_view()),
    path(institution + "billing/payments/<uuid:pk>/attachment/", billing.AttachmentView.as_view()),
]
