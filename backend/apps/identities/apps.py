from django.apps import AppConfig


class IdentitiesConfig(AppConfig):
    name = "apps.identities"
    label = "identities"

    def ready(self):
        from . import signals  # noqa: F401  (connects the session receivers)
