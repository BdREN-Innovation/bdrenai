from django.urls import path

from . import views

urlpatterns = [
    path("products/", views.PublicProductCatalogView.as_view()),
    path("subscribe/", views.SubscribePackageView.as_view()),
]
