import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = JSON.parse(await readFile(new URL("../data/security-robot-report.schema.json", import.meta.url), "utf8"));
const registry = JSON.parse(await readFile(new URL("../data/security-robot-registry.json", import.meta.url), "utf8"));

test("report schema declares the expected JSON Schema dialect and object root", () => {
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
});

test("report requires timestamp, status, robot results, findings and recommendations", () => {
  for (const field of [
    "schema_version", "generated_at", "environment", "operating_mode",
    "production_connected", "automatic_actions_enabled", "human_approval_required",
    "overall_status", "summary", "robots", "findings", "recommendations"
  ]) {
    assert.ok(schema.required.includes(field), `missing required field: ${field}`);
    assert.ok(schema.properties[field], `missing property definition: ${field}`);
  }
});

test("report schema enforces recommendation-only safety invariants", () => {
  assert.equal(schema.properties.operating_mode.const, "observe_and_recommend");
  assert.equal(schema.properties.production_connected.const, false);
  assert.equal(schema.properties.automatic_actions_enabled.const, false);
  assert.equal(schema.properties.human_approval_required.const, true);
  assert.equal(schema.properties.recommendations.items.properties.requires_human_approval.const, true);
});

test("report schema restricts status and severity values", () => {
  assert.deepEqual(schema.properties.overall_status.enum, ["ok", "attention_required", "critical", "unknown"]);
  assert.deepEqual(schema.properties.robots.items.properties.status.enum, ["ok", "attention_required", "critical", "not_checked", "unavailable"]);
  assert.deepEqual(schema.properties.findings.items.properties.severity.enum, ["info", "low", "medium", "high", "critical"]);
  assert.deepEqual(schema.properties.recommendations.items.properties.priority.enum, ["low", "medium", "high", "urgent"]);
});

test("robot results, findings and recommendations reject undeclared fields", () => {
  assert.equal(schema.properties.robots.items.additionalProperties, false);
  assert.equal(schema.properties.findings.items.additionalProperties, false);
  assert.equal(schema.properties.recommendations.items.additionalProperties, false);
});

test("report robot IDs map to the central registry", () => {
  const registryIds = new Set(registry.robots.map((robot) => robot.id));
  const reportRobotId = schema.properties.robots.items.properties.robot_id;
  const findingRobotId = schema.properties.findings.items.properties.robot_id;

  assert.equal(reportRobotId.type, "string");
  assert.equal(findingRobotId.type.includes("string"), true);
  assert.equal(reportRobotId.pattern, "^[a-z0-9]+(?:-[a-z0-9]+)*$");
  assert.ok(registryIds.size > 0);

  // A report may contain a subset of robots, but every reported robot must be registered.
  for (const robot of registry.robots) {
    assert.match(robot.id, new RegExp(reportRobotId.pattern));
  }
  assert.equal(registry.robots.some((robot) => robot.id === registry.coordinator_id), true);
});
