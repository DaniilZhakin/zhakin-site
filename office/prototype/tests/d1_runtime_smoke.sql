-- Local Wrangler/D1 runtime compatibility smoke only; disposable database.
PRAGMA foreign_keys = ON;

CREATE TABLE _office_d1_smoke_task (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE TABLE _office_d1_smoke_proposal (
  task_id TEXT NOT NULL,
  expected_task_version INTEGER NOT NULL,
  proposed_changes_json TEXT NOT NULL CHECK (json_valid(proposed_changes_json))
);
CREATE TABLE _office_d1_smoke_assert (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO _office_d1_smoke_task(id, title, version)
VALUES ('task-1', 'Before', 7);
INSERT INTO _office_d1_smoke_proposal(task_id, expected_task_version, proposed_changes_json)
VALUES ('task-1', 7, '{"title":"After"}');

-- Exercises the UPDATE ... FROM and JSON functions used by the approval gateway.
UPDATE _office_d1_smoke_task
SET title = json_extract(p.proposed_changes_json, '$.title'),
    version = version + 1
FROM _office_d1_smoke_proposal p
WHERE _office_d1_smoke_task.id = p.task_id
  AND _office_d1_smoke_task.version = p.expected_task_version;

INSERT INTO _office_d1_smoke_assert(ok)
SELECT CASE
  WHEN (SELECT title FROM _office_d1_smoke_task WHERE id = 'task-1') = 'After'
   AND (SELECT version FROM _office_d1_smoke_task WHERE id = 'task-1') = 8
   AND json_type('{"title":"After"}', '$.title') = 'text'
  THEN 1 ELSE 0 END;

-- Also fail the step if any migration left a foreign-key violation.
INSERT INTO _office_d1_smoke_assert(ok)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE 0 END;

DROP TABLE _office_d1_smoke_assert;
DROP TABLE _office_d1_smoke_proposal;
DROP TABLE _office_d1_smoke_task;
