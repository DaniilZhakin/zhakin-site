from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "profiles.json"
PAGE = ROOT / "profiles.html"

errors = []
try:
    payload = json.loads(DATA.read_text(encoding="utf-8"))
except Exception as exc:
    raise SystemExit(f"profiles.json invalid: {exc}")

if payload.get("schema_version") != "1.0":
    errors.append("profiles.json: unsupported schema_version")
if payload.get("model") != "universal-digital-profile":
    errors.append("profiles.json: model mismatch")

profiles = payload.get("profiles")
if not isinstance(profiles, list) or not profiles:
    errors.append("profiles.json: profiles must be a non-empty list")

ids = set()
for item in profiles or []:
    for key in ("id", "type", "canonical_url", "name", "role_summary"):
        if not item.get(key):
            errors.append(f"profile missing {key}: {item.get('id', '<unknown>')}")
    pid = item.get("id")
    if pid in ids:
        errors.append(f"duplicate profile id: {pid}")
    ids.add(pid)
    if not str(item.get("canonical_url", "")).startswith("https://xn--80alhhq.xn--p1ai/"):
        errors.append(f"profile canonical_url outside canonical domain: {pid}")

html = PAGE.read_text(encoding="utf-8")
if 'href="https://xn--80alhhq.xn--p1ai/profiles.html"' not in html:
    errors.append("profiles.html: canonical link missing")
if '/data/profiles.json' not in html:
    errors.append("profiles.html: profile registry integration missing")

if errors:
    print("\n".join(f"ERROR: {e}" for e in errors))
    raise SystemExit(1)

print(f"PASS: universal digital profile registry integrity ({len(profiles)} profiles)")
