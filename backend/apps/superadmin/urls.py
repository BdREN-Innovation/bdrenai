from django.urls import path

from . import views

urlpatterns = [
    path("session/", views.SessionView.as_view()),
    path("dashboard/", views.DashboardView.as_view()),
    path("institutions/", views.InstitutionsView.as_view()),
    path("institutions/options/", views.InstitutionOptionsView.as_view()),
    path("institutions/directory/", views.InstitutionDirectoryView.as_view()),
    path("institutions/<slug:slug>/", views.InstitutionView.as_view()),
    path("institutions/<slug:slug>/suspend/", views.InstitutionStatusView.as_view(action="suspend")),
    path("institutions/<slug:slug>/reactivate/", views.InstitutionStatusView.as_view(action="reactivate")),
    path("institutions/<slug:slug>/deactivate/", views.InstitutionStatusView.as_view(action="deactivate")),
    path("institutions/<slug:slug>/members/", views.InstitutionMembersView.as_view()),
    path("institutions/<slug:slug>/history/", views.InstitutionHistoryView.as_view()),
    path("institutions/<slug:slug>/import/", views.InstitutionImportView.as_view()),
    path("memberships/<uuid:pk>/", views.MembershipView.as_view()),
    path("memberships/<uuid:pk>/remove/", views.MembershipRemoveView.as_view()),
    path("users/", views.UsersView.as_view()),
    path("users/<uuid:pk>/", views.UserView.as_view()),
    path("invitations/", views.InvitationsView.as_view()),
    path("invitations/resend-expired/", views.InvitationsResendExpiredView.as_view()),
    path("invitations/<uuid:pk>/resend/", views.InvitationResendView.as_view()),
    path("invitations/<uuid:pk>/revoke/", views.InvitationRevokeView.as_view()),
    path("admins/", views.AdminsView.as_view()),
    path("admins/<uuid:user_id>/", views.AdminView.as_view()),
    path("audit/", views.AuditView.as_view()),
]
