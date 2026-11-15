import time

import jwt
import pytest

from apps.identities import oidc
from tests.conftest import CLIENT_ID, ISSUER


def test_valid_token(idp):
    c = oidc.validate_id_token(idp.sign(idp.claims()), "N")
    assert c["sub"] == "u-100"


@pytest.mark.parametrize("over", [
    {"iss": "http://evil"}, {"aud": ["other"]}, {"exp": int(time.time()) - 3600}, {"nonce": "WRONG"},
])
def test_rejects_bad_claims(idp, over):
    with pytest.raises(oidc.OIDCError):
        oidc.validate_id_token(idp.sign(idp.claims(**over)), "N")


def test_rejects_missing_sub(idp):
    c = idp.claims(); del c["sub"]
    with pytest.raises(oidc.OIDCError):
        oidc.validate_id_token(idp.sign(c), "N")


def test_rejects_wrong_signature(idp):
    from cryptography.hazmat.primitives.asymmetric import rsa
    attacker = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(oidc.OIDCError):
        oidc.validate_id_token(idp.sign(idp.claims(), key=attacker), "N")


def test_rejects_alg_none_and_hs256(idp):
    none_tok = jwt.encode(idp.claims(), None, algorithm="none", headers={"kid": "k1"})
    with pytest.raises(oidc.OIDCError):
        oidc.validate_id_token(none_tok, "N")
    hs = jwt.encode(idp.claims(), "secret-secret-secret-secret-1234", algorithm="HS256", headers={"kid": "k1"})
    with pytest.raises(oidc.OIDCError):
        oidc.validate_id_token(hs, "N")


def test_multi_audience_requires_azp(idp):
    with pytest.raises(oidc.OIDCError):
        oidc.validate_id_token(idp.sign(idp.claims(aud=[CLIENT_ID, "x"])), "N")
    assert oidc.validate_id_token(idp.sign(idp.claims(aud=[CLIENT_ID, "x"], azp=CLIENT_ID)), "N")


def test_key_rotation_refetches_jwks(idp):
    oidc.validate_id_token(idp.sign(idp.claims()), "N")
    assert idp.calls["jwks"] == 1
    idp.add_key("k2")  # IdP rotates; cached JWKS lacks k2
    oidc.validate_id_token(idp.sign(idp.claims(), kid="k2"), "N")
    assert idp.calls["jwks"] == 2
    with pytest.raises(oidc.OIDCError):  # unknown kid never validates
        oidc.validate_id_token(idp.sign(idp.claims(), kid="k1", key=idp.keys["k2"]).replace("", ""), "N")


def test_authorization_request_has_pkce_state_nonce(idp):
    url, blob = oidc.start_authorization()
    assert "code_challenge_method=S256" in url and f"state={blob['state']}" in url and f"nonce={blob['nonce']}" in url
    assert blob["verifier"] not in url


def test_discovery_issuer_mismatch(idp, monkeypatch):
    monkeypatch.setattr("apps.identities.oidc.request_json", lambda *a, **k: {"issuer": "http://evil"})
    with pytest.raises(oidc.OIDCError):
        oidc.discovery()
