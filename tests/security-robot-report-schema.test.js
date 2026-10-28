import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = JSON.parse(await readFile(new URL("../data/security-robot-report.schema.json", import.meta.url), "utf8"));
const registry = JSON.parse(await readFile(new URL("../data/security-robot-registry.json", import.meta.url), "utf8"));
const example = JSON.parse(await readFile(new URL("../data/security-robot-report.example.json", import.meta.url), "utf8"));

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
  assert.deepEqual(new Set(reportRobotId.enum), registryIds);
  assert.deepEqual(new Set(findingRobotId.enum.filter((id) => id !== null)), registryIds);
  assert.equal(findingRobotId.enum.includes(null), true);
  assert.ok(registryIds.size > 0);

  for (const robot of registry.robots) {
    assert.match(robot.id, new RegExp(reportRobotId.pattern));
  }
  assert.equal(registry.robots.some((robot) => robot.id === registry.coordinator_id), true);
});

test("example report uses only registered robots and marks all checks as not checked", () => {
  const registryIds = new Set(registry.robots.map((robot) => robot.id));
  assert.equal(example.schema_version, schema.properties.schema_version.const);
  assert.equal(example.operating_mode, "observe_and_recommend");
  assert.equal(example.production_connected, false);
  assert.equal(example.automatic_actions_enabled, false);
  assert.equal(example.human_approval_required, true);
  assert.equal(example.overall_status, "unknown");
  assert.equal(example.environment, "unknown");
  assert.equal(Number.isNaN(Date.parse(example.generated_at)), false);
  assert.equal(example.robots.length, registryIds.size);
  assert.deepEqual(new Set(example.robots.map((robot) => robot.robot_id)), registryIds);
  assert.ok(example.robots.every((robot) => robot.status === "not_checked" && robot.checked_at === null));
  assert.deepEqual(example.findings, []);
  assert.deepEqual(example.recommendations, []);
  assert.ok(example.summary.includes("No robots have been connected"));
});

test("example report fields stay within the declared shape and safety limits", () => {
  const topLevelKeys = new Set(Object.keys(schema.properties));
  assert.ok(Object.keys(example).every((key) => topLevelKeys.has(key)));
  assert.deepEqual(Object.keys(example).sort(), [...schema.required].sort());

  for (const robot of example.robots) {
    const allowed = new Set(Object.keys(schema.properties.robots.items.properties));
    assert.ok(Object.keys(robot).every((key) => allowed.has(key)));
    assert.ok(schema.properties.robots.items.required.every((key) => Object.hasOwn(robot, key)));
    assert.ok(robot.summary.length <= schema.properties.robots.items.properties.summary.maxLength);
  }
});


function matchesJsonType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "string") return typeof value === "string";
  return true;
}

function collectSchemaErrors(value, definition, path = "$") {
  const errors = [];
  if (definition.type) {
    const types = Array.isArray(definition.type) ? definition.type : [definition.type];
    if (!types.some((type) => matchesJsonType(value, type))) {
      return [`${path}: expected type ${types.join(" or ")}`];
    }
  }

  if (Object.hasOwn(definition, "const") && value !== definition.const) {
    errors.push(`${path}: does not match const`);
  }
  if (definition.enum && !definition.enum.some((item) => item === value)) {
    errors.push(`${path}: value is outside enum`);
  }
  if (typeof value === "string") {
    if (definition.minLength !== undefined && value.length < definition.minLength) errors.push(`${path}: shorter than minLength`);
    if (definition.maxLength !== undefined && value.length > definition.maxLength) errors.push(`${path}: longer than maxLength`);
    if (definition.pattern && !new RegExp(definition.pattern).test(value)) errors.push(`${path}: does not match pattern`);
    if (definition.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push(`${path}: invalid date-time`);
  }
  if (Array.isArray(value) && definition.items) {
    value.forEach((item, index) => errors.push(...collectSchemaErrors(item, definition.items, `${path}[${index}]`)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const required of definition.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${path}: missing required property ${required}`);
    }
    if (definition.additionalProperties === false && definition.properties) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(definition.properties, key)) errors.push(`${path}: unexpected property ${key}`);
      }
    }
    for (const [key, child] of Object.entries(definition.properties ?? {})) {
      if (Object.hasOwn(value, key)) errors.push(...collectSchemaErrors(value[key], child, `${path}.${key}`));
    }
  }
  return errors;
}

test("example report satisfies the schema's declared local contract checks", () => {
  const errors = collectSchemaErrors(example, schema);
  assert.deepEqual(errors, [], errors.join("\n"));
});
