-- Controlled, minimized handoff summaries for ZHAKIN COMMAND AI.
-- Apply only to disposable test databases until separately reviewed and approved.
CREATE TABLE IF NOT EXISTS office_handoff_summaries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES office_organizations(id),
  task_id TEXT NOT NULL REFERENCES office_tasks(id),
  workspace TEXT NOT NULL CHECK (workspace IN ('treasury', 'legal')),
  task_version INTEGER NOT NULL CHECK (task_version > 1),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 1000),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  UNIQUE(task_id, task_version)
);
CREATE INDEX IF NOT EXISTS idx_office_handoff_org_workspace_time
  ON office_handoff_summaries(organization_id, workspace, created_at);
