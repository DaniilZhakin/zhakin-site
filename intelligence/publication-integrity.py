#!/usr/bin/env python3
"""Validate the publication graph and SEO metadata consistency."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "publications.html"
JS = ROOT / "assets/js/publications.js"
PUB_DIR = ROOT / "publications"

errors = []

index_text = INDEX.read_text(encoding="utf-8")
js_text = JS.read_text(encoding="utf-8")

index_paths = sorted(set(re.findall(r'href=["\'](/publications/[^"\'#?]+\.html)', index_text)))
classified = dict(re.findall(r'["\'](/publications/[^"\']+\.html)["\']\s*:\s*["\']([a-z]+)["\']', js_text))

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

allowed_groups = {"finance", "ai", "law", "infra", "strategy"}
invalid_groups = sorted({group for group in classified.values() if group not in allowed_groups})
if invalid_groups:
    errors.append("invalid analytical groups: " + ", ".join(invalid_groups))

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

if errors:
    print("PUBLICATION GRAPH: FAIL")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print("PUBLICATION GRAPH: PASS")
print(f"- indexed publications: {len(index_paths)}")
print(f"- classified publications: {len(classified)}")
print(f"- analytical groups: {', '.join(sorted(set(classified.values())))}")
print("- canonical + Article JSON-LD: verified")
