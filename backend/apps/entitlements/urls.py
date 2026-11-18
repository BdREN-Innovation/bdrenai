from django.urls import path

from . import views

urlpatterns = [
    path("check/", views.EntitlementCheckView.as_view()),
    path("current/", views.CurrentEntitlementsView.as_view()),
    path("plan/", views.PlanView.as_view()),
]
