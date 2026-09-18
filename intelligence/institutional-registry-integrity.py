#!/usr/bin/env python3
"""Validate the institutional registry against the existing project registry."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "data" / "institutional-registry.json"
PROJECTS = ROOT / "data" / "projects.json"

errors = []

try:
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
except Exception as exc:
    raise SystemExit(f"INSTITUTIONAL REGISTRY: FAIL\\nInvalid registry JSON: {exc}")

try:
    projects = json.loads(PROJECTS.read_text(encoding="utf-8"))
except Exception as exc:
    raise SystemExit(f"INSTITUTIONAL REGISTRY: FAIL\\nInvalid project registry JSON: {exc}")

required_top = {"schema_version", "updated_at", "source", "entity_types", "relation_types", "entities", "relations"}
missing = required_top - registry.keys()
if missing:
    errors.append(f"missing top-level fields: {sorted(missing)}")

entity_types = set(registry.get("entity_types", []))
relation_types = set(registry.get("relation_types", []))
entities = registry.get("entities", {})

ids = {}
for bucket, items in entities.items():
    for entity in items:
        for field in ("id", "type", "name", "source"):
            if not entity.get(field):
                errors.append(f"{bucket}: entity missing {field}")
        entity_id = entity.get("id")
        if entity_id in ids:
            errors.append(f"duplicate entity id: {entity_id}")
        elif entity_id:
            ids[entity_id] = entity
        if entity.get("type") not in entity_types:
            errors.append(f"{entity_id}: unknown entity type {entity.get('type')}")
        if entity.get("page") and not entity["page"].startswith("/"):
            errors.append(f"{entity_id}: page must be an internal route")

project_ids = {p["id"] for p in projects.get("projects", [])}
registry_project_ids = {e["id"] for e in entities.get("projects", [])}

if project_ids != registry_project_ids:
    errors.append(
        "project registry mismatch: "
        f"projects.json={sorted(project_ids)} institutional={sorted(registry_project_ids)}"
    )

relation_pairs = {
    "member-of": {"person": {"organization"}},
    "implemented-by": {"project": {"organization"}},
    "supports-direction": {"project": {"direction"}},
    "documented-by": {"project": {"document"}},
}

for relation in registry.get("relations", []):
    for field in ("from", "type", "to", "source"):
        if not relation.get(field):
            errors.append(f"relation missing {field}")
    if relation.get("from") not in ids:
        errors.append(f"relation from unknown entity: {relation.get('from')}")
    if relation.get("to") not in ids:
        errors.append(f"relation to unknown entity: {relation.get('to')}")
    relation_type = relation.get("type")
    if relation_type not in relation_types:
        errors.append(f"unknown relation type: {relation_type}")
    else:
        from_type = ids.get(relation.get("from"), {}).get("type")
        to_type = ids.get(relation.get("to"), {}).get("type")
        allowed_targets = relation_pairs.get(relation_type, {}).get(from_type, set())
        if to_type not in allowed_targets:
            errors.append(
                f"invalid relation semantics: {relation_type} "
                f"{from_type}->{to_type}"
            )

if errors:
    print("INSTITUTIONAL REGISTRY: FAIL")
    for error in errors:
        print(f"- {error}")
    raise SystemExit(1)

print("INSTITUTIONAL REGISTRY: PASS")
print(f"entities={len(ids)} relations={len(registry.get('relations', []))}")
