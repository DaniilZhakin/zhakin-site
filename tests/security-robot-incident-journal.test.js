import test from "node:test";
import assert from "node:assert/strict";
import { appendIncidentEvent, mergeIncident, validateIncidentEvent } from "../src/security-robot-incident-journal.js";

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
