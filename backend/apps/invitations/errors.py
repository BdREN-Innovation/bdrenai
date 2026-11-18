"""Business-rule failures raised by services and rendered by views in the contract's error shape."""
from django.http import JsonResponse
from rest_framework.exceptions import APIException, AuthenticationFailed, NotAuthenticated

DRF_ERROR_CODES = {
    400: "invalid", 401: "not_authenticated", 403: "forbidden", 404: "not_found",
    405: "method_not_allowed", 415: "unsupported_media_type", 429: "throttled",
}
DRF_MESSAGES = {
    "not_authenticated": "Sign in first.",
    "not_found": "Not found.",
}


class ServiceError(Exception):
    """`{"error": code, "message": ..., "fields": {...}, **extra}` with an HTTP status."""

    def __init__(self, code, message, *, status=400, fields=None, extra=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.fields = fields or {}
        self.extra = extra or {}

    def body(self):
        out = {"error": self.code, "message": self.message, **self.extra}
        if self.fields:
            out["fields"] = self.fields
        return out

    def response(self):
        return JsonResponse(self.body(), status=self.status)


def invalid(fields, message="Check the highlighted fields."):
    return ServiceError("invalid", message, status=400, fields=fields)


class ContractErrors:
    """APIView mixin: `ServiceError` and DRF's own failures (bad JSON, CSRF, 404, 405, throttling) all leave
    as `{"error", "message", "fields"?}`, and an anonymous caller gets 401 rather than DRF's 403."""

    def error_code(self, exc, status):
        return DRF_ERROR_CODES.get(status, "error")

    def handle_exception(self, exc):
        if isinstance(exc, ServiceError):
            return exc.response()
        response = super().handle_exception(exc)
        if isinstance(exc, (NotAuthenticated, AuthenticationFailed)):
            response.status_code = 401
        code = self.error_code(exc, response.status_code)
        detail = exc.detail if isinstance(exc, APIException) else None
        message = DRF_MESSAGES.get(code) or (str(detail) if isinstance(detail, str) else "Request failed.")
        response.data = {"error": code, "message": message}
        return response
