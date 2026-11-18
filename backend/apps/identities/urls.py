from django.urls import path

from . import views

urlpatterns = [
    path("login/", views.LoginView.as_view()),
    path("callback/", views.CallbackView.as_view()),
    path("link/start/", views.LinkStartView.as_view()),
    path("link/callback/", views.LinkCallbackView.as_view()),
    path("logout/", views.LogoutView.as_view()),
    path("logged-out/", views.LoggedOutView.as_view()),
    path("me/", views.MeView.as_view()),
    path("institutions/", views.InstitutionsView.as_view()),
    path("register/", views.RegisterView.as_view()),
    path("register/verify/", views.RegisterVerifyView.as_view()),
    path("register/resend/", views.RegisterResendView.as_view()),
]
