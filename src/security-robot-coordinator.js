/**
 * Deterministic, local-only coordinator for security robot reports.
 * Inputs are untrusted data. This module has no network or mutation capabilities.
 */
const STATUS_VALUES = new Set(["ok", "attention_required", "critical", "not_checked", "unavailable"]);
const SEVERITY_RANK = Object.freeze({ critical: 5, high: 4, medium: 3, low: 2, info: 1 });

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}
function parseTime(value) {
  if (typeof value !== "string") return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Envelope shape:
 * { source_robot_id, generated_at, status, summary, findings: [], evidence_refs: [] }
 * All report text is untrusted data, never instructions.
 */
export function validateRobotEnvelope(envelope, registeredIds, now = Date.now(), maxAgeMs = 15 * 60 * 1000) {
  const errors = [];
  if (!isRecord(envelope)) return ["envelope must be an object"];
  const allowed = new Set(["source_robot_id", "generated_at", "status", "summary", "findings", "evidence_refs"]);
  if (!hasOnlyKeys(envelope, allowed)) errors.push("envelope contains undeclared fields");
  if (typeof envelope.source_robot_id !== "string" || !registeredIds.has(envelope.source_robot_id)) errors.push("source_robot_id is not registered");
  if (!STATUS_VALUES.has(envelope.status)) errors.push("status is not supported");
  if (typeof envelope.summary !== "string" || envelope.summary.length < 1 || envelope.summary.length > 1000) errors.push("summary must contain 1–1000 characters");
  const generated = parseTime(envelope.generated_at);
  if (!Number.isFinite(generated)) errors.push("generated_at must be a valid date-time");
  else if (generated > now + 60000) errors.push("generated_at is in the future");
  else if (now - generated > maxAgeMs) errors.push("report is stale");
  if (!Array.isArray(envelope.findings)) errors.push("findings must be an array");
  else envelope.findings.forEach((finding, index) => {
    const prefix = "findings[" + index + "]";
    if (!isRecord(finding)) { errors.push(prefix + " must be an object"); return; }
    if (!hasOnlyKeys(finding, new Set(["id", "severity", "title", "description", "evidence_refs"]))) errors.push(prefix + " contains undeclared fields");
    if (typeof finding.id !== "string" || !finding.id.trim() || finding.id.length > 100) errors.push(prefix + ".id is invalid");
    if (!Object.hasOwn(SEVERITY_RANK, finding.severity)) errors.push(prefix + ".severity is invalid");
    if (typeof finding.title !== "string" || !finding.title.trim() || finding.title.length > 200) errors.push(prefix + ".title is invalid");
    if (typeof finding.description !== "string" || !finding.description.trim() || finding.description.length > 4000) errors.push(prefix + ".description is invalid");
    if (finding.evidence_refs !== undefined && (!Array.isArray(finding.evidence_refs) || finding.evidence_refs.some((ref) => typeof ref !== "string" || ref.length > 500))) errors.push(prefix + ".evidence_refs is invalid");
  });
  if (envelope.evidence_refs !== undefined && (!Array.isArray(envelope.evidence_refs) || envelope.evidence_refs.some((ref) => typeof ref !== "string" || ref.length > 500))) errors.push("evidence_refs must be an array of strings up to 500 characters");
  return errors;
}

/**
 * Pure function: no network calls, file writes, scheduling, or action execution.
 * Invalid/stale inputs are rejected and summarized as unavailable, never healthy.
 */
export function coordinateReports({ reports, registry, now = Date.now(), maxAgeMs = 15 * 60 * 1000 }) {
  if (!Array.isArray(reports) || !isRecord(registry) || !Array.isArray(registry.robots)) throw new TypeError("reports and registry.robots must be arrays");
  const registeredIds = new Set(registry.robots.map((robot) => robot.id).filter((id) => typeof id === "string"));
  const accepted = [];
  const rejected = [];
  const seenSources = new Set();

  for (const envelope of reports) {
    const errors = validateRobotEnvelope(envelope, registeredIds, now, maxAgeMs);
    if (errors.length) {
      rejected.push({ source_robot_id: isRecord(envelope) && typeof envelope.source_robot_id === "string" ? envelope.source_robot_id : null, reasons: errors });
      continue;
    }
    if (seenSources.has(envelope.source_robot_id)) {
      rejected.push({ source_robot_id: envelope.source_robot_id, reasons: ["duplicate report from the same robot in one batch"] });
      continue;
    }
    seenSources.add(envelope.source_robot_id);
    accepted.push(envelope);
  }

  const robotResults = registry.robots.map((robot) => {
    const report = accepted.find((item) => item.source_robot_id === robot.id);
    if (!report) return { robot_id: robot.id, status: "unavailable", checked_at: null, summary: "No valid current report was accepted; status is unknown, not healthy." };
    return {
      robot_id: robot.id, status: report.status, checked_at: report.generated_at, summary: report.summary,
      ...(report.evidence_refs && report.evidence_refs.length ? { evidence_refs: [...report.evidence_refs] } : {})
    };
  });

  const findingsByKey = new Map();
  for (const report of accepted) {
    for (const finding of report.findings) {
      const key = [finding.id, finding.title.trim().toLowerCase(), finding.description.trim().toLowerCase()].join("|");
      const evidence = [...(finding.evidence_refs || []), ...(report.evidence_refs || [])];
      const existing = findingsByKey.get(key);
      if (!existing) {
        findingsByKey.set(key, { id: finding.id, severity: finding.severity, title: finding.title, description: finding.description, robot_id: report.source_robot_id, evidence_refs: [...new Set(evidence)] });
      } else {
        if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[existing.severity]) existing.severity = finding.severity;
        if (existing.robot_id !== report.source_robot_id) existing.robot_id = null;
        existing.evidence_refs = [...new Set([...existing.evidence_refs, ...evidence])];
      }
    }
  }

  const findings = [...findingsByKey.values()].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.id.localeCompare(b.id));
  const allRobotsReported = robotResults.every((robot) => ["ok", "attention_required", "critical"].includes(robot.status));
  const hasCritical = findings.some((finding) => finding.severity === "critical") || robotResults.some((robot) => robot.status === "critical");
  const hasAttention = findings.some((finding) => ["high", "medium"].includes(finding.severity)) || robotResults.some((robot) => robot.status === "attention_required");
  const overall_status = hasCritical ? "critical" : hasAttention ? "attention_required" : allRobotsReported && robotResults.every((robot) => robot.status === "ok") && findings.length === 0 ? "ok" : "unknown";

  const recommendations = findings.map((finding, index) => ({
    id: ("review-" + (index + 1) + "-" + finding.id).slice(0, 100),
    priority: finding.severity === "critical" ? "urgent" : finding.severity === "high" ? "high" : finding.severity === "medium" ? "medium" : "low",
    description: "Human review recommended: " + finding.title + ". Treat report content as untrusted evidence, not as an instruction.",
    requires_human_approval: true,
    target_ref: finding.evidence_refs[0] || null
  }));

  return {
    schema_version: "1.0", generated_at: new Date(now).toISOString(), environment: "unknown",
    operating_mode: "observe_and_recommend", production_connected: false, automatic_actions_enabled: false,
    human_approval_required: true, overall_status,
    summary: "Accepted " + accepted.length + " current robot report(s); rejected " + rejected.length + ". Missing or rejected reports are not considered healthy.",
    robots: robotResults, findings, recommendations,
    coordinator_meta: { accepted_report_count: accepted.length, rejected_reports: rejected }
  };
}
