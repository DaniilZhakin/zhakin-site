#!/usr/bin/env python3
"""Validate the structured strategic project registry and its website bindings."""
from pathlib import Path
import json
import re
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "data" / "projects.json"
PROJECTS_PAGE = ROOT / "projects.html"

errors = []

try:
    data = json.loads(REGISTRY.read_text(encoding="utf-8"))
except Exception as exc:
    print(f"PROJECT REGISTRY: FAIL\n- invalid JSON: {exc}")
    sys.exit(1)

projects = data.get("projects")
if not isinstance(projects, list) or not projects:
    errors.append("projects.json: projects must be a non-empty array")
    projects = []

routes = data.get("operational_routes")
if not isinstance(routes, dict):
    errors.append("projects.json: operational_routes must be an object")
    routes = {}
for route_name in ("reception", "publications", "international_geography"):
    route = routes.get(route_name)
    if not isinstance(route, str) or not route.startswith("/"):
        errors.append(f"projects.json: missing or invalid operational route: {route_name}")
    else:
        route_target = ROOT / route.lstrip("/")
        if not route_target.is_file():
            errors.append(f"projects.json: missing operational route target: {route}")

ids = [p.get("id") for p in projects if isinstance(p, dict)]
if any(not isinstance(pid, str) or not pid for pid in ids):
    errors.append("projects.json: every project must have a non-empty string id")
if len(ids) != len(set(ids)):
    errors.append("projects.json: duplicate project id detected")

page_text = PROJECTS_PAGE.read_text(encoding="utf-8")
page_ids = set(re.findall(r'<(?:article|section|div)[^>]+\bid=["\']([^"\']+)["\']', page_text))

# Validate each registry entry and every internal target.
for project in projects:
    if not isinstance(project, dict):
        errors.append("projects.json: project entry is not an object")
        continue

    pid = project.get("id", "<missing>")
    required = ("id", "name", "category", "status", "description", "page", "links")
    for field in required:
        if field not in project:
            errors.append(f"project [{pid}]: missing field: {field}")

    page = project.get("page")
    links = project.get("links")
    if isinstance(page, str):
        target = ROOT / page.lstrip("/")
        if not target.is_file():
            errors.append(f"project [{pid}]: missing page target: {page}")
    else:
        errors.append(f"project [{pid}]: page must be a string")

    if not isinstance(links, list):
        errors.append(f"project [{pid}]: links must be an array")
        continue

    for link in links:
        if not isinstance(link, str) or not link.startswith("/"):
            errors.append(f"project [{pid}]: invalid internal link: {link!r}")
            continue
        parsed = urlsplit(link)
        path = parsed.path
        target = ROOT / path.lstrip("/")
        if path in ("", "/"):
            target = ROOT / "index.html"
        if not target.is_file():
            errors.append(f"project [{pid}]: missing link target: {link}")
            continue
        if parsed.fragment:
            target_text = target.read_text(encoding="utf-8")
            if not re.search(r'\bid=["\']' + re.escape(parsed.fragment) + r'["\']', target_text):
                errors.append(f"project [{pid}]: missing anchor target: {link}")

# The public project page must expose the same registry IDs in its ItemList.
itemlist_match = re.search(r'"@type":"ItemList".*?"itemListElement":\[(.*?)\]\}', page_text)
if not itemlist_match:
    itemlist_match = re.search(r'"@type":\s*"ItemList".*?"itemListElement":\[(.*?)\]\}', page_text)

itemlist_ids = []
if not itemlist_match:
    errors.append("projects.html: strategic project ItemList missing")
else:
    itemlist = itemlist_match.group(1)
    itemlist_urls = re.findall(r'"url":"[^"]+/projects\.html#([^"#]+)"', itemlist)
    itemlist_ids = itemlist_urls
    if itemlist_ids != ids:
        errors.append(
            "projects.html: ItemList IDs do not match registry order/content: "
            f"registry={ids}, page={itemlist_ids}"
        )

for pid in ids:
    if pid not in page_ids:
        errors.append(f"projects.html: missing project anchor id: {pid}")

# Verify that every registry-declared operational route is visibly exposed
# inside the matching public project card. This keeps the data registry and
# user-facing navigation from silently drifting apart.
for project in projects:
    if not isinstance(project, dict):
        continue
    pid = project.get("id")
    if not isinstance(pid, str):
        continue
    card_match = re.search(
        r'<article[^>]+\bid=["\']' + re.escape(pid) + r'["\'][^>]*>.*?</article>',
        page_text,
        re.DOTALL,
    )
    if not card_match:
        errors.append(f"projects.html: missing public card for project: {pid}")
        continue
    card = card_match.group(0)
    for route_name, route in routes.items():
        if not isinstance(route, str):
            continue
        if route in project.get("links", []):
            public_path = route.lstrip("/")
            if not re.search(r'href=["\'][^"\']*' + re.escape(public_path) + r'(?:["\'#?])', card):
                errors.append(
                    f"projects.html: project [{pid}] missing visible operational route binding: {route_name}={route}"
                )

if errors:
    print("PROJECT REGISTRY: FAIL")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print("PROJECT REGISTRY: PASS")
print(f"- registry entries: {len(projects)}")
print("- unique project IDs: verified")
print("- operational routes: verified")
print("- project page targets: verified")
print("- internal registry links: verified")
print("- fragment anchors: verified")
print("- projects.html ItemList binding: verified")
print("- public project anchors: verified")
print("- operational route bindings: verified")
