from django.urls import path

from . import views

urlpatterns = [
    path("bkash/callback/", views.BkashCallbackView.as_view()),
]
