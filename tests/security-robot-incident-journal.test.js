import test from "node:test";
import assert from "node:assert/strict";
import { appendIncidentEvent, mergeIncident, validateIncidentEvent } from "../src/security-robot-incident-journal.js";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import incidentSchema from "../data/security-robot-incident-event.schema.json" with { type: "json" };

const event = (overrides = {}) => ({
  schema_version: "1.0", event_id: "evt-001", idempotency_key: "idem-001", incident_id: "inc-001",
  event_type: "opened", occurred_at: "2026-10-29T10:00:00.000Z", recorded_at: "2026-10-29T10:01:00.000Z",
  severity: "medium", classification: { facts: ["Synthetic fact"], hypotheses: ["Synthetic hypothesis"], recommendations: ["Human review"] },
  summary: "Synthetic test incident only.", sources: [{ source_id: "test-source", observed_at: "2026-10-29T10:00:00.000Z", reference: "test://incident/1" }],
  decision: { status: "pending_review", rationale: "Synthetic test only.", human_approval_required: true },
  ...overrides
});
const base = () => ({ incident_id: "inc-001", created_at: "2026-10-29T10:01:00.000Z", updated_at: "2026-10-29T10:01:00.000Z", severity: "medium", status: "open", history: [] });

test("accepts a valid synthetic event", () => assert.deepEqual(validateIncidentEvent(event()), []));
test("rejects unknown fields and missing human approval", () => {
  assert.ok(validateIncidentEvent(event({ surprise: true })).some((e) => e.includes("undeclared")));
  assert.ok(validateIncidentEvent(event({ decision: { status: "accepted", rationale: "No approval", human_approval_required: false } })).some((e) => e.includes("decision is invalid")));
  assert.ok(validateIncidentEvent(event({ decision: { status: "accepted", rationale: "Accepted without approver", human_approval_required: true } })).some((e) => e.includes("requires a named approver")));
  assert.ok(validateIncidentEvent(event({ event_id: "contains spaces" })).some((e) => e.includes("event_id format")));
});

test("JSON Schema enforces explicit approval metadata for accepted decisions", () => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(incidentSchema);
  assert.equal(validate(event()), true);
  assert.equal(validate(event({ decision: { status: "accepted", rationale: "Approved", human_approval_required: true } })), false);
  assert.equal(validate(event({ decision: { status: "accepted", rationale: "Approved", human_approval_required: true, approved_by: "human-reviewer", approved_at: "2026-10-29T10:02:00.000Z" } })), true);
});
test("idempotency key and event ID prevent duplicate history entries", () => {
  const first = appendIncidentEvent([], event());
  assert.equal(first.accepted, true);
  assert.equal(appendIncidentEvent(first.history, event()).reason, "duplicate");
  assert.equal(appendIncidentEvent(first.history, event({ event_id: "evt-002" })).reason, "duplicate");
  assert.equal(first.history.length, 1);
});
test("incident identity is stable and mismatched IDs fail closed", () => {
  const result = mergeIncident(base(), event());
  assert.equal(result.accepted, true);
  assert.equal(result.incident.incident_id, "inc-001");
  assert.equal(mergeIncident(base(), event({ incident_id: "other-incident" })).reason, "incident_id_mismatch");
});
test("severity escalates but never silently downgrades", () => {
  const current = { ...base(), severity: "critical" };
  const result = mergeIncident(current, event({ severity: "low", event_id: "evt-lower", idempotency_key: "idem-lower" }));
  assert.equal(result.incident.severity, "critical");
  const escalated = mergeIncident(base(), event({ severity: "critical", event_id: "evt-critical", idempotency_key: "idem-critical" }));
  assert.equal(escalated.incident.severity, "critical");
});
test("recorded history is preserved and resolution is explicit", () => {
  const opened = mergeIncident(base(), event());
  const resolvedEvent = event({ event_id: "evt-resolved", idempotency_key: "idem-resolved", event_type: "resolved", recorded_at: "2026-10-29T10:05:00.000Z" });
  const resolved = mergeIncident(opened.incident, resolvedEvent);
  assert.equal(resolved.incident.status, "resolved");
  assert.equal(resolved.incident.history.length, 2);
  assert.equal(resolved.incident.created_at, base().created_at);
});


test("stale resolved event is recorded but cannot close a newer incident", () => {
  const opened = mergeIncident(base(), event({ occurred_at: "2026-10-29T10:10:00.000Z", recorded_at: "2026-10-29T10:10:01.000Z" }));
  const newer = mergeIncident(opened.incident, event({
    event_id: "evt-updated-newer", idempotency_key: "idem-updated-newer",
    event_type: "updated", occurred_at: "2026-10-29T10:20:00.000Z", recorded_at: "2026-10-29T10:20:01.000Z"
  }));
  const staleResolved = mergeIncident(newer.incident, event({
    event_id: "evt-resolved-stale", idempotency_key: "idem-resolved-stale",
    event_type: "resolved", occurred_at: "2026-10-29T10:15:00.000Z", recorded_at: "2026-10-29T10:21:00.000Z"
  }));
  assert.equal(staleResolved.accepted, true);
  assert.equal(staleResolved.reason, "stale_event_recorded");
  assert.equal(staleResolved.incident.status, "open");
  assert.equal(staleResolved.incident.updated_at, newer.incident.updated_at);
  assert.equal(staleResolved.incident.history.length, 3);
});

test("stale reopened event cannot reopen an incident resolved by a newer event", () => {
  const opened = mergeIncident(base(), event({ occurred_at: "2026-10-29T10:10:00.000Z", recorded_at: "2026-10-29T10:10:01.000Z" }));
  const resolved = mergeIncident(opened.incident, event({
    event_id: "evt-resolved-newer", idempotency_key: "idem-resolved-newer",
    event_type: "resolved", occurred_at: "2026-10-29T10:30:00.000Z", recorded_at: "2026-10-29T10:30:01.000Z"
  }));
  const staleReopened = mergeIncident(resolved.incident, event({
    event_id: "evt-reopened-stale", idempotency_key: "idem-reopened-stale",
    event_type: "reopened", occurred_at: "2026-10-29T10:25:00.000Z", recorded_at: "2026-10-29T10:31:00.000Z"
  }));
  assert.equal(staleReopened.accepted, true);
  assert.equal(staleReopened.reason, "stale_event_recorded");
  assert.equal(staleReopened.incident.status, "resolved");
  assert.equal(staleReopened.incident.updated_at, resolved.incident.updated_at);
  assert.equal(staleReopened.incident.history.length, 3);
});


test("a delayed first event is not rejected by ingestion timestamps", () => {
  const delayedFirst = event({
    event_type: "resolved",
    occurred_at: "2026-10-29T09:59:00.000Z",
    recorded_at: "2026-10-29T10:05:00.000Z"
  });
  const result = mergeIncident(base(), delayedFirst);
  assert.equal(result.accepted, true);
  assert.equal(result.reason, "updated");
  assert.equal(result.incident.status, "resolved");
  assert.equal(result.incident.updated_at, delayedFirst.recorded_at);
});
