from django.urls import path

from . import views

urlpatterns = [
    path("contexts/", views.AccountContextsView.as_view()),
    path("switch-context/", views.SwitchAccountContextView.as_view()),
]
