#!/usr/bin/env python3
"""Validate the publication graph, analytical directions, filtered navigation, context links, sitemap and SEO metadata."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "publications.html"
DIRECTIONS = ROOT / "publications" / "directions.html"
JS = ROOT / "assets/js/publications.js"
SITEMAP = ROOT / "sitemap.xml"
PUB_DIR = ROOT / "publications"

errors = []

index_text = INDEX.read_text(encoding="utf-8")
directions_text = DIRECTIONS.read_text(encoding="utf-8")
js_text = JS.read_text(encoding="utf-8")
sitemap_text = SITEMAP.read_text(encoding="utf-8")

index_paths = sorted(set(re.findall(r'href=["\'](/publications/[^"\'#?]+\.html)', index_text)))
classified = dict(re.findall(r'["\'](/publications/[^"\']+\.html)["\']\s*:\s*["\']([a-z]+)["\']', js_text))

direction_groups = {
    "finance": {
        "label": "Финансы и инвестиции",
        "paths": {
            "/publications/money-financial-system.html",
            "/publications/digital-ruble.html",
            "/publications/ai-financial-system.html",
            "/publications/price-discovery.html",
        },
    },
    "ai": {
        "label": "AI и государство",
        "paths": {
            "/publications/ai-parliament.html",
            "/publications/ai-infrastructure.html",
        },
    },
    "law": {
        "label": "Право и институты",
        "paths": {
            "/publications/understanding-state-and-law.html",
            "/publications/legal-architecture.html",
        },
    },
    "infra": {
        "label": "Инфраструктура и экономика",
        "paths": {
            "/publications/food-infrastructure.html",
        },
    },
    "strategy": {
        "label": "Стратегическое развитие",
        "paths": {
            "/publications/economic-transition-1990s.html",
            "/publications/future-without-money.html",
            "/publications/intellectual-economy.html",
            "/publications/capital-requires-proof.html",
        },
    },
}

expected_paths = set(index_paths)
expected_direction_paths = set().union(*(group["paths"] for group in direction_groups.values()))

if not index_paths:
    errors.append("publications.html: no publication links found")

if len(index_paths) != 13:
    errors.append(f"publication count: expected 13, found {len(index_paths)}")

missing_classification = [path for path in index_paths if path not in classified]
extra_classification = [path for path in classified if path not in index_paths]

if missing_classification:
    errors.append("missing classification: " + ", ".join(missing_classification))
if extra_classification:
    errors.append("classification points to non-index publication: " + ", ".join(extra_classification))

allowed_groups = set(direction_groups)
invalid_groups = sorted({group for group in classified.values() if group not in allowed_groups})
if invalid_groups:
    errors.append("invalid analytical groups: " + ", ".join(invalid_groups))

if expected_direction_paths != expected_paths:
    missing_direction = sorted(expected_paths - expected_direction_paths)
    extra_direction = sorted(expected_direction_paths - expected_paths)
    if missing_direction:
        errors.append("missing from analytical directions: " + ", ".join(missing_direction))
    if extra_direction:
        errors.append("analytical directions contain non-index publication: " + ", ".join(extra_direction))

for group_id, group in direction_groups.items():
    expected = group["paths"]
    actual = {path for path in expected_paths if classified.get(path) == group_id}
    if actual != expected:
        errors.append(
            f"direction mismatch [{group_id}]: expected {len(expected)}, classified {len(actual)}"
        )
    if group["label"] not in directions_text:
        errors.append(f"directions.html: missing direction label: {group['label']}")

# Validate that every direction-page publication link resolves to a real publication file.
# Exclude the directions page's own self-link from the publication graph.
direction_links = sorted(set(re.findall(r'href=["\'](/publications/(?!directions\.html(?:["\'#?]|$))[^"\'#?]+\.html)', directions_text)))
for path in direction_links:
    if not (ROOT / path.lstrip("/")).is_file():
        errors.append(f"directions.html: missing publication file: {path}")

if set(direction_links) != expected_direction_paths:
    missing_links = sorted(expected_direction_paths - set(direction_links))
    extra_links = sorted(set(direction_links) - expected_direction_paths)
    if missing_links:
        errors.append("directions.html missing links: " + ", ".join(missing_links))
    if extra_links:
        errors.append("directions.html extra links: " + ", ".join(extra_links))

# Validate one filtered publication-index entry point per analytical direction.
for group_id in direction_groups:
    expected_href = f'/publications.html?direction={group_id}'
    if expected_href not in directions_text:
        errors.append(f"directions.html: missing filtered entry point: {expected_href}")

if 'URLSearchParams(window.location.search)' not in js_text:
    errors.append("publications.js: filtered direction query handling missing")
if 'applyFilter(requestedDirection)' not in js_text:
    errors.append("publications.js: requested direction is not applied")
if 'button.setAttribute(\'aria-pressed\'' not in js_text:
    errors.append("publications.js: filter accessibility state handling missing")

if '<link rel="canonical"' not in directions_text:
    errors.append("directions.html: missing canonical")
if '"@type":"CollectionPage"' not in directions_text and '"@type": "CollectionPage"' not in directions_text:
    errors.append("directions.html: missing CollectionPage JSON-LD")

for path in index_paths:
    file_path = ROOT / path.lstrip("/")
    if not file_path.is_file():
        errors.append(f"missing publication file: {path}")
        continue
    text = file_path.read_text(encoding="utf-8")
    if '<link rel="canonical"' not in text:
        errors.append(f"missing canonical: {path}")
    if '"@type":"Article"' not in text and '"@type": "Article"' not in text:
        errors.append(f"missing Article JSON-LD: {path}")

    group_id = classified.get(path)
    if not group_id or group_id not in direction_groups:
        continue
    group = direction_groups[group_id]
    context_match = re.search(
        r'<div class="publication-context" data-publication-context="v1">.*?'
        r'<div class="publication-context-label">Аналитическое направление</div>\s*'
        r'<div class="publication-context-direction">([^<]+)</div>\s*'
        r'<div class="publication-context-links">(.*?)</div>\s*'
        r'<a class="publication-context-map" href="([^"]+)">.*?</a>\s*'
        r'<a class="publication-context-index" href="([^"]+)">.*?</a>\s*'
        r'</div>',
        text,
        re.S,
    )
    if not context_match:
        errors.append(f"publication context missing or malformed: {path}")
        continue

    context_label, links_html, map_href, index_href = context_match.groups()
    if context_label != group["label"]:
        errors.append(f"publication context direction mismatch: {path}")

    related_links = set(re.findall(r'href=["\'](/publications/[^"\'#?]+\.html)', links_html))
    expected_related = expected_paths.intersection(group["paths"]) - {path}
    if related_links != expected_related:
        missing_related = sorted(expected_related - related_links)
        extra_related = sorted(related_links - expected_related)
        if missing_related:
            errors.append(f"publication context missing related links [{path}]: " + ", ".join(missing_related))
        if extra_related:
            errors.append(f"publication context extra related links [{path}]: " + ", ".join(extra_related))
    for related in related_links:
        if not (ROOT / related.lstrip("/")).is_file():
            errors.append(f"publication context link target missing: {path} -> {related}")

    expected_map = "/publications/directions.html"
    expected_index = f"/publications.html?direction={group_id}"
    if map_href != expected_map:
        errors.append(f"publication context map mismatch: {path}")
    if index_href != expected_index:
        errors.append(f"publication context filtered entry mismatch: {path}")

sitemap_url = "https://xn--80alhhq.xn--p1ai/publications/directions.html"
if sitemap_url not in sitemap_text:
    errors.append("sitemap.xml: analytical directions URL missing")

if errors:
    print("PUBLICATION GRAPH: FAIL")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print("PUBLICATION GRAPH: PASS")
print(f"- indexed publications: {len(index_paths)}")
print(f"- classified publications: {len(classified)}")
print(f"- analytical groups: {', '.join(sorted(allowed_groups))}")
print("- directions map: verified")
print("- direction links: verified")
print("- filtered entry points: verified")
print("- filtered query handling: verified")
print("- publication context blocks: verified")
print("- related-material links: verified")
print("- sitemap directions URL: verified")
print("- canonical + Article JSON-LD: verified")
