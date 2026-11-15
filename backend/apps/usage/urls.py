from django.urls import path

from . import views

urlpatterns = [
    path("reservations/", views.UsageReservationCreateView.as_view()),
    path("reservations/<uuid:reservation_id>/commit/", views.UsageReservationCommitView.as_view()),
    path("reservations/<uuid:reservation_id>/release/", views.UsageReservationReleaseView.as_view()),
    path("summary/", views.UsageSummaryView.as_view()),
]
