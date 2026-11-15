import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from django.core.cache import cache
from jwt.algorithms import RSAAlgorithm

ISSUER = "http://auth.test"
CLIENT_ID = "client-1"


class FakeIdP:
    def __init__(self):
        self.keys = {}
        self.add_key("k1")
        self.token_response_claims = None  # callable(nonce)->claims override

    def add_key(self, kid):
        k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.keys[kid] = k
        return k

    def jwks(self):
        out = []
        for kid, k in self.keys.items():
            d = json.loads(RSAAlgorithm.to_jwk(k.public_key()))
            d.update(kid=kid, use="sig", alg="RS256")
            out.append(d)
        return {"keys": out}

    def sign(self, claims, kid="k1", key=None, alg="RS256"):
        return jwt.encode(claims, key or self.keys[kid], algorithm=alg, headers={"kid": kid})

    def claims(self, **over):
        now = int(time.time())
        c = {"iss": ISSUER, "aud": [CLIENT_ID], "sub": "u-100", "iat": now, "exp": now + 300,
             "nonce": "N", "email": "a@example.com", "email_verified": True, "name": "Alice"}
        c.update(over)
        return c


@pytest.fixture
def idp(monkeypatch, settings):
    cache.clear()
    settings.OIDC = {**settings.OIDC, "ISSUER": ISSUER, "CLIENT_ID": CLIENT_ID, "CLIENT_SECRET": "s",
                     "INTERNAL_BASE_URL": "", "REDIRECT_URI": "http://app/cb",
                     "ALLOWED_REDIRECT_ORIGINS": ["http://app"]}
    fake = FakeIdP()
    calls = {"jwks": 0}

    def fake_request(method, url, **kw):
        if url.endswith("/.well-known/openid-configuration"):
            return {"issuer": ISSUER, "authorization_endpoint": ISSUER + "/authorize", "token_endpoint": ISSUER + "/token",
                    "jwks_uri": ISSUER + "/keys", "end_session_endpoint": ISSUER + "/end"}
        if url.endswith("/keys"):
            calls["jwks"] += 1
            return fake.jwks()
        if url.endswith("/token"):
            assert kw["data"]["code_verifier"], "PKCE verifier must be sent"
            return {"id_token": fake.sign(fake.claims(**(fake.token_response_claims or {})))}
        raise AssertionError(url)

    monkeypatch.setattr("apps.identities.oidc.request_json", fake_request)
    fake.calls = calls
    return fake
