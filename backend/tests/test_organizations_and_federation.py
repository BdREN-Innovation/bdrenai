import json
from urllib.parse import parse_qs, urlparse

import pytest
from django.db import IntegrityError, transaction
from django.test import Client

from apps.accounts.models import Account
from apps.audit.models import AuditLog
from apps.identities.models import ExternalIdentity, User
from apps.invitations.errors import ServiceError
from apps.invitations.services import seats_used
from apps.organizations.models import InstitutionalIdentityProvider, Membership, Organization
from apps.organizations.services import (
    add_or_update_membership,
    create_organization,
    register_institutional_idp,
)
from tests.conftest import ISSUER

pytestmark = pytest.mark.django_db


def login_with_claims(client, idp, **claim_overrides):
    r = client.get("/api/v1/auth/login/")
    state = parse_qs(urlparse(r["Location"]).query)["state"][0]
    nonce = client.session["oidc_flow"]["nonce"]
    idp.token_response_claims = {"nonce": nonce, **claim_overrides}
    return client.get("/api/v1/auth/callback/", {"code": "c", "state": state})


def test_one_institution_per_user_and_context_switching(idp):
    c = Client()
    assert login_with_claims(c, idp, sub="u-ctx").status_code == 302
    user = User.objects.get(zitadel_subject="u-ctx")

    org_a = create_organization(name="University A", slug="univ-a", zitadel_organization_id="z-org-a")
    org_b = create_organization(name="Organization B", slug="org-b", zitadel_organization_id="z-org-b")
    org_unjoined = create_organization(name="Other Org", slug="other-org")

    add_or_update_membership(user=user, organization=org_a, role=Membership.Role.ADMIN)
    with pytest.raises(ServiceError) as e:
        add_or_update_membership(user=user, organization=org_b, role=Membership.Role.MEMBER)
    assert e.value.code == "member_of_other_institution"
    with pytest.raises(IntegrityError), transaction.atomic():
        Membership.objects.create(user=user, organization=org_b)

    # Personal + University A
    ctx_res = c.get("/api/v1/accounts/contexts/").json()
    assert len(ctx_res["contexts"]) == 2
    by_slug = {x["organization"]["slug"]: x for x in ctx_res["contexts"] if x["organization"]}
    assert by_slug["univ-a"]["role"] == "admin"

    sw = c.post(
        "/api/v1/accounts/switch-context/",
        data=json.dumps({"account_id": str(org_a.account.id)}),
        content_type="application/json",
    )
    assert sw.status_code == 200 and sw.json()["organization_slug"] == "univ-a"
    me = c.get("/api/v1/auth/me/").json()
    assert me["active_account_id"] == str(org_a.account.id)

    # No longer covered: the institution account is no longer theirs, and the session falls back to personal
    Membership.objects.filter(user=user).update(coverage=Membership.Coverage.NONE)
    me = c.get("/api/v1/auth/me/").json()
    assert me["active_account_id"] == str(Account.objects.get(owner_user=user, account_type="personal").id)

    forb = c.post(
        "/api/v1/accounts/switch-context/",
        data=json.dumps({"account_id": str(org_unjoined.account.id)}),
        content_type="application/json",
    )
    assert forb.status_code == 403


def test_account_constraint_requires_owner_or_org():
    from django.db import transaction
    with pytest.raises(IntegrityError), transaction.atomic():
        Account.objects.create(account_type=Account.Type.PERSONAL, owner_user=None)
    with pytest.raises(IntegrityError), transaction.atomic():
        Account.objects.create(account_type=Account.Type.ORGANIZATION, organization=None)


def test_institutional_saml_and_oidc_login_maps_membership_and_handles_deprovisioning(idp):
    univ_saml = create_organization(name="BUET SAML", slug="buet", zitadel_organization_id="z-buet-101")
    register_institutional_idp(
        organization=univ_saml,
        name="BUET Shibboleth SAML",
        protocol=InstitutionalIdentityProvider.Protocol.SAML,
        zitadel_idp_id="idp-buet-saml",
        issuer_or_entity_id="https://idp.buet.ac.bd/idp/shibboleth",
        auto_join_role=Membership.Role.MEMBER,
    )

    c = Client()
    cb = login_with_claims(
        c,
        idp,
        sub="u-buet-1",
        email="faculty@buet.ac.bd",
        **{"urn:zitadel:iam:org:id": "z-buet-101", "urn:zitadel:iam:user:idp:id": "idp-buet-saml"},
    )
    assert cb.status_code == 302
    u = User.objects.get(zitadel_subject="u-buet-1")
    m = Membership.objects.get(user=u, organization=univ_saml)
    assert m.role == Membership.Role.MEMBER and m.status == Membership.Status.ACTIVE

    # Deprovision institutional membership -> subsequent institutional login must be blocked (403)
    m.status = Membership.Status.DEPROVISIONED
    m.save(update_fields=["status"])
    c2 = Client()
    cb2 = login_with_claims(
        c2,
        idp,
        sub="u-buet-1",
        **{"urn:zitadel:iam:org:id": "z-buet-101"},
    )
    assert cb2.status_code == 403

    # Re-activate membership, but suspend the Organization -> login blocked (403)
    m.status = Membership.Status.ACTIVE
    m.save(update_fields=["status"])
    univ_saml.status = Organization.Status.SUSPENDED
    univ_saml.save(update_fields=["status"])
    c3 = Client()
    assert login_with_claims(c3, idp, sub="u-buet-1", **{"urn:zitadel:iam:org:id": "z-buet-101"}).status_code == 403


def test_explicit_verified_account_linking_and_conflict_rejection(idp):
    # User 1 logs in with personal identity "u-primary"
    c1 = Client()
    assert login_with_claims(c1, idp, sub="u-primary", email="researcher@bdren.ai").status_code == 302
    u1 = User.objects.get(zitadel_subject="u-primary")

    # User 1 starts explicit account linking flow for their institutional identity "u-inst-linked"
    start_res = c1.post(
        "/api/v1/auth/link/start/",
        data=json.dumps({"provider_type": "saml"}),
        content_type="application/json",
    )
    assert start_res.status_code == 200
    link_state = parse_qs(urlparse(start_res.json()["authorization_url"]).query)["state"][0]
    link_nonce = c1.session["oidc_link_flow"]["nonce"]

    univ_du = create_organization(name="Dhaka University", slug="du", zitadel_organization_id="z-du-202")
    idp.token_response_claims = {
        "nonce": link_nonce,
        "sub": "u-inst-linked",
        "email": "researcher@du.ac.bd",
        "urn:zitadel:iam:org:id": "z-du-202",
    }
    link_cb = c1.get("/api/v1/auth/link/callback/", {"code": "link-code", "state": link_state})
    assert link_cb.status_code == 200 and link_cb.json()["linked"] is True

    # Verify ExternalIdentity and DU Membership were attached to u1 (no second User created)
    assert User.objects.count() == 1
    assert ExternalIdentity.objects.filter(user=u1, issuer=ISSUER, subject="u-inst-linked", provider_type="saml").exists()
    assert Membership.objects.filter(user=u1, organization=univ_du, status="active").exists()

    # Now logging in fresh with "u-inst-linked" resolves directly to u1!
    c_fresh = Client()
    assert login_with_claims(c_fresh, idp, sub="u-inst-linked", email="researcher@du.ac.bd").status_code == 302
    assert c_fresh.get("/api/v1/auth/me/").json()["id"] == str(u1.id)

    # User 2 logs in and attempts to link "u-primary" -> rejected with 409 Conflict
    c2 = Client()
    assert login_with_claims(c2, idp, sub="u-other", email="other@bdren.ai").status_code == 302
    s2 = c2.post("/api/v1/auth/link/start/", data=json.dumps({"provider_type": "oidc"}), content_type="application/json")
    st2 = parse_qs(urlparse(s2.json()["authorization_url"]).query)["state"][0]
    idp.token_response_claims = {"nonce": c2.session["oidc_link_flow"]["nonce"], "sub": "u-primary"}
    conflict = c2.get("/api/v1/auth/link/callback/", {"code": "c2", "state": st2})
    assert conflict.status_code == 409


def test_institutional_sign_in_affiliates_without_covering(idp):
    """Signing in through the institution's IdP proves affiliation only: active, not covered, no seat used."""
    org = create_organization(name="BUET", slug="buet", zitadel_organization_id="z-buet-101", seat_cap=1)
    sso = {"urn:zitadel:iam:org:id": "z-buet-101"}
    for sub, email in (("u-1", "one@buet.ac.bd"), ("u-2", "two@buet.ac.bd")):
        assert login_with_claims(Client(), idp, sub=sub, email=email, **sso).status_code == 302
    memberships = Membership.objects.filter(organization=org)
    assert {(m.status, m.coverage) for m in memberships} == {(Membership.Status.ACTIVE, Membership.Coverage.NONE)}
    assert memberships.count() == 2
    joined = AuditLog.objects.filter(action="membership.joined", metadata__source="institution_sign_in")
    assert joined.count() == 2
    assert seats_used(org) == 0


def test_institutional_sign_in_of_someone_in_another_institution_does_not_join(idp):
    other = create_organization(name="DU", slug="du-x")
    org = create_organization(name="BUET", slug="buet-x", zitadel_organization_id="z-buet-x")
    c = Client()
    assert login_with_claims(c, idp, sub="u-x", email="x@du.ac.bd").status_code == 302
    user = User.objects.get(zitadel_subject="u-x")
    add_or_update_membership(user=user, organization=other)
    sso = {"urn:zitadel:iam:org:id": "z-buet-x"}
    assert login_with_claims(Client(), idp, sub="u-x", email="x@du.ac.bd", **sso).status_code == 302
    assert not Membership.objects.filter(user=user, organization=org).exists()


def test_institutional_sign_in_never_makes_an_admin_who_is_not_covered(idp):
    org = create_organization(name="BUET", slug="buet", zitadel_organization_id="z-buet-101")
    register_institutional_idp(
        organization=org, name="BUET SAML", protocol=InstitutionalIdentityProvider.Protocol.SAML,
        zitadel_idp_id="idp-buet-saml", issuer_or_entity_id="https://idp.buet.ac.bd/idp/shibboleth",
        auto_join_role=Membership.Role.ADMIN,
    )
    c = Client()
    claims = {"urn:zitadel:iam:org:id": "z-buet-101", "urn:zitadel:iam:user:idp:id": "idp-buet-saml"}
    assert login_with_claims(c, idp, sub="u-buet-a", email="a@buet.ac.bd", **claims).status_code == 302
    m = Membership.objects.get(user__zitadel_subject="u-buet-a", organization=org)
    assert (m.role, m.coverage) == (Membership.Role.MEMBER, Membership.Coverage.NONE)
    assert c.get("/api/v1/portal/institutions/").json() == []
