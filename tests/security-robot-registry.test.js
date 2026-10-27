import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const registry = JSON.parse(await readFile(new URL("../data/security-robot-registry.json", import.meta.url), "utf8"));

test("registry remains non-production and recommendation-only", () => {
  assert.equal(registry.status, "design_only");
  assert.equal(registry.production_connected, false);
  assert.equal(registry.automatic_actions_enabled, false);
  assert.equal(registry.operating_mode, "observe_and_recommend");
});

test("robot identifiers and names are unique", () => {
  const ids = registry.robots.map((item) => item.id);
  const names = registry.robots.map((item) => item.name);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(names).size, names.length);
});

test("coordinator has restricted permissions", () => {
  const leader = registry.robots.find((item) => item.id === registry.coordinator_id);
  assert.ok(leader);
  assert.equal(leader.role, "coordinator");
  assert.ok(leader.forbidden_actions.includes("execute_mutations"));
});
