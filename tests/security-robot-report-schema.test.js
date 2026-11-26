import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { coordinateReports } from "../src/security-robot-coordinator.js";

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


const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateReport = ajv.compile(schema);

test("full JSON Schema 2020-12 validator accepts the example report", () => {
  assert.equal(validateReport(example), true, JSON.stringify(validateReport.errors));
});

test("full JSON Schema validator rejects missing fields, unsafe flags, unknown robots, and extra properties", () => {
  const invalidCases = [
    { ...example, summary: undefined },
    { ...example, automatic_actions_enabled: true },
    { ...example, robots: [{ ...example.robots[0], robot_id: "unknown-robot" }, ...example.robots.slice(1)] },
    { ...example, unexpected: "not allowed" },
    { ...example, recommendations: [{ id: "r1", priority: "urgent", description: "test", requires_human_approval: false }] }
  ];
  for (const candidate of invalidCases) {
    assert.equal(validateReport(candidate), false);
  }
});

test("coordinator output conforms to the complete report schema", () => {
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  const report = {
    source_robot_id: "sentinel-ai",
    generated_at: new Date(now).toISOString(),
    status: "ok",
    summary: "Synthetic test report only.",
    findings: [],
    evidence_refs: ["test://evidence/one"]
  };
  const coordinated = coordinateReports({ reports: [report], registry, now });
  assert.equal(validateReport(coordinated), true, JSON.stringify(validateReport.errors));
  assert.equal(coordinated.production_connected, false);
  assert.equal(coordinated.automatic_actions_enabled, false);
  assert.equal(coordinated.human_approval_required, true);
});
