from django.urls import path

from . import views

urlpatterns = [
    path("<str:token>/", views.InvitationPreviewView.as_view()),
    path("<str:token>/accept/", views.InvitationAcceptView.as_view()),
]
