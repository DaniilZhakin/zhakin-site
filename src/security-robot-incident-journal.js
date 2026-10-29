const SEVERITY = Object.freeze({ info: 0, low: 1, medium: 2, high: 3, critical: 4 });
const EVENT_TYPES = new Set(["opened", "updated", "severity_changed", "decision_recorded", "resolved", "reopened"]);

export function validateIncidentEvent(event) {
  const errors = [];
  if (!event || typeof event !== "object" || Array.isArray(event)) return ["event must be an object"];
  const required = ["schema_version", "event_id", "idempotency_key", "incident_id", "event_type", "occurred_at", "recorded_at", "severity", "classification", "summary", "sources", "decision"];
  for (const key of required) if (!Object.hasOwn(event, key)) errors.push("missing required field: " + key);
  const allowed = new Set([...required, "supersedes_event_id"]);
  for (const key of Object.keys(event)) if (!allowed.has(key)) errors.push("undeclared field: " + key);
  if (event.schema_version !== "1.0") errors.push("schema_version must be 1.0");
  for (const key of ["event_id", "idempotency_key", "incident_id", "summary"]) if (typeof event[key] !== "string" || !event[key].trim()) errors.push(key + " must be a non-empty string");
  if (typeof event.event_id === "string" && (event.event_id.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(event.event_id))) errors.push("event_id format is invalid");
  if (typeof event.incident_id === "string" && (event.incident_id.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(event.incident_id))) errors.push("incident_id format is invalid");
  if (typeof event.idempotency_key === "string" && event.idempotency_key.length > 160) errors.push("idempotency_key is too long");
  if (typeof event.summary === "string" && event.summary.length > 2000) errors.push("summary is too long");
  if (!EVENT_TYPES.has(event.event_type)) errors.push("event_type is invalid");
  if (!Object.hasOwn(SEVERITY, event.severity)) errors.push("severity is invalid");
  for (const key of ["occurred_at", "recorded_at"]) if (typeof event[key] !== "string" || Number.isNaN(Date.parse(event[key]))) errors.push(key + " must be a valid timestamp");
  if (!event.classification || typeof event.classification !== "object" || Array.isArray(event.classification)) errors.push("classification must be an object");
  else {
    for (const key of ["facts", "hypotheses", "recommendations"]) {
      if (!Array.isArray(event.classification[key]) || event.classification[key].some((v) => typeof v !== "string" || !v.trim() || v.length > 2000)) errors.push("classification." + key + " must be an array of non-empty strings up to 2000 characters");
    }
    for (const key of Object.keys(event.classification)) if (!["facts", "hypotheses", "recommendations"].includes(key)) errors.push("undeclared classification field: " + key);
  }
  if (!Array.isArray(event.sources)) errors.push("sources must be an array");
  else for (const source of event.sources) {
    if (!source || typeof source !== "object" || Array.isArray(source) || typeof source.source_id !== "string" || !source.source_id.trim() || source.source_id.length > 120 || typeof source.reference !== "string" || !source.reference.trim() || source.reference.length > 500 || typeof source.observed_at !== "string" || Number.isNaN(Date.parse(source.observed_at))) errors.push("each source needs bounded source_id, reference, and a valid observed_at");
    else if (Object.keys(source).some((key) => !["source_id", "reference", "observed_at"].includes(key))) errors.push("source contains undeclared fields");
  }
  const decision = event.decision;
  if (!decision || typeof decision !== "object" || Array.isArray(decision) || !["pending_review", "accepted", "rejected", "deferred", "not_applicable"].includes(decision.status) || typeof decision.rationale !== "string" || !decision.rationale.trim() || decision.rationale.length > 2000 || decision.human_approval_required !== true) errors.push("decision is invalid or omits mandatory human approval");
  else {
    if (Object.keys(decision).some((key) => !["status", "rationale", "human_approval_required", "approved_by", "approved_at"].includes(key))) errors.push("decision contains undeclared fields");
    if (decision.approved_by !== undefined && decision.approved_by !== null && (typeof decision.approved_by !== "string" || !decision.approved_by.trim() || decision.approved_by.length > 120)) errors.push("decision.approved_by is invalid");
    if (decision.approved_at !== undefined && decision.approved_at !== null && (typeof decision.approved_at !== "string" || Number.isNaN(Date.parse(decision.approved_at)))) errors.push("decision.approved_at is invalid");
    if (decision.status === "accepted" && (typeof decision.approved_by !== "string" || !decision.approved_by.trim() || typeof decision.approved_at !== "string" || Number.isNaN(Date.parse(decision.approved_at)))) errors.push("accepted decision requires a named approver and valid approval timestamp");
  }
  if (event.supersedes_event_id !== undefined && event.supersedes_event_id !== null && typeof event.supersedes_event_id !== "string") errors.push("supersedes_event_id must be a string or null");
  return errors;
}

/** Append an event idempotently. Duplicate event IDs or idempotency keys do not create a second history row. */
export function appendIncidentEvent(history, event) {
  if (!Array.isArray(history)) throw new TypeError("history must be an array");
  const errors = validateIncidentEvent(event);
  if (errors.length) return { accepted: false, reason: "invalid_event", errors, history };
  if (history.some((item) => item.event_id === event.event_id || item.idempotency_key === event.idempotency_key)) {
    return { accepted: false, reason: "duplicate", errors: [], history };
  }
  return { accepted: true, reason: "appended", errors: [], history: [...history, structuredClone(event)] };
}

/** Stable incident identity; severity may escalate but never silently downgrade. */
export function mergeIncident(current, event) {
  if (!current || typeof current !== "object") throw new TypeError("current incident is required");
  const appended = appendIncidentEvent(current.history || [], event);
  if (!appended.accepted) return { accepted: false, reason: appended.reason, errors: appended.errors, incident: current };
  if (current.incident_id !== event.incident_id) return { accepted: false, reason: "incident_id_mismatch", errors: [], incident: current };
  const incomingOccurred = Date.parse(event.occurred_at);
  const incomingRecorded = Date.parse(event.recorded_at);
  const latestStateEvent = (current.history || []).reduce((latest, item) => {
    if (!latest) return item;
    const itemOccurred = Date.parse(item.occurred_at);
    const latestOccurred = Date.parse(latest.occurred_at);
    if (itemOccurred > latestOccurred) return item;
    if (itemOccurred === latestOccurred && Date.parse(item.recorded_at) > Date.parse(latest.recorded_at)) return item;
    return latest;
  }, null);
  const latestOccurred = latestStateEvent ? Date.parse(latestStateEvent.occurred_at) : Date.parse(current.created_at || 0);
  const latestEventRecorded = latestStateEvent ? Date.parse(latestStateEvent.recorded_at) : Date.parse(current.updated_at || current.created_at || 0);
  const stale = incomingOccurred < latestOccurred ||
    (incomingOccurred === latestOccurred && incomingRecorded < latestEventRecorded);
  const nextSeverity = SEVERITY[event.severity] > SEVERITY[current.severity] ? event.severity : current.severity;
  return {
    accepted: true, reason: stale ? "stale_event_recorded" : "updated", errors: [],
    incident: {
      ...current,
      incident_id: current.incident_id,
      created_at: current.created_at || event.recorded_at,
      updated_at: stale ? (current.updated_at || current.created_at || event.recorded_at) : event.recorded_at,
      severity: nextSeverity,
      status: stale ? (current.status || "open") :
        event.event_type === "resolved" ? "resolved" :
        event.event_type === "reopened" ? "open" : (current.status || "open"),
      history: appended.history
    }
  };
}
