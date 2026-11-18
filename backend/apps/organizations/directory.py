"""Known institutions (BdREN full members) offered as suggestions when creating an institution."""
import json
from functools import lru_cache
from pathlib import Path

from .models import Organization

SOURCE = Path(__file__).with_name("data") / "bdren_members.json"


@lru_cache(maxsize=1)
def entries():
    return tuple(json.loads(SOURCE.read_text(encoding="utf-8"))["institutions"])


def search(q="", limit=20):
    """Directory entries matching `q` (name or short name) that are not created yet (same slug or name)."""
    text = (q or "").strip().lower()
    existing = Organization.objects.values_list("name", "slug")
    pairs = list(existing)
    names = {name.lower() for name, _ in pairs}
    slugs = {slug for _, slug in pairs}
    found = []
    for entry in entries():
        if entry["suggested_slug"] in slugs or entry["name"].lower() in names:
            continue
        if text and text not in entry["name"].lower() and not entry["short_name"].lower().startswith(text):
            continue
        found.append(entry)
        if len(found) == limit:
            break
    return found
