import pytest
from django.test import Client

from apps.organizations import directory
from apps.organizations.models import Organization
from tests.factories import make_org, make_user
from tests.test_superadmin_api import make_superadmin, post, signed_in

pytestmark = pytest.mark.django_db

URL = "/api/v1/superadmin/institutions/directory/"


def names(response):
    return [entry["name"] for entry in response.json()["results"]]


def test_directory_lists_the_bdren_full_members_once_each():
    entries = directory.entries()
    assert len(entries) == 120
    assert len({e["suggested_slug"] for e in entries}) == 120
    national = next(e for e in entries if e["short_name"] == "NU")
    assert national["suggested_slug"] == "nu" and national["offices"] == ["Dhanmondi Office"]


def test_search_matches_name_or_short_name_prefix():
    client = signed_in(make_superadmin())
    assert names(client.get(URL, {"q": "dhaka"}))[0] == "University of Dhaka"
    du = client.get(URL, {"q": "du"}).json()["results"]
    assert {"name": "University of Dhaka", "short_name": "DU", "sector": "public",
            "suggested_slug": "du", "offices": []} in du
    assert names(client.get(URL, {"q": "BUE"})) == ["Bangladesh University of Engineering & Technology"]


def test_search_hides_institutions_already_created_by_slug_or_name():
    make_org("du", name="Dhaka Uni")
    make_org("brac", name="BRAC University")
    client = signed_in(make_superadmin())
    found = names(client.get(URL, {"q": "university"}))
    assert "University of Dhaka" not in found and "BRAC University" not in found
    assert len(client.get(URL).json()["results"]) == 20


def test_directory_is_superadmin_only():
    assert Client().get(URL).status_code == 401
    c = Client()
    c.force_login(make_user("someone@du.ac.bd"))
    assert c.get(URL).status_code == 403


def test_create_institution_stores_sector_and_rejects_unknown_sector():
    client = signed_in(make_superadmin())
    body = {"name": "University of Dhaka", "slug": "du", "type": "university", "sector": "public"}
    r = post(client, "institutions/", body)
    assert r.status_code == 201, r.json()
    assert r.json()["institution"]["sector"] == "public"
    assert Organization.objects.get(slug="du").sector == "public"
    r = post(client, "institutions/", {**body, "slug": "du2", "sector": "state"})
    assert r.status_code == 400 and "sector" in r.json()["fields"]
