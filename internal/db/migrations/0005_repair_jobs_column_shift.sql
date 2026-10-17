-- Repair jobs rows corrupted by INSERT SELECT * in 0004 (depends_on was last column in jobs, not before color).
-- Symptom: last_run_at contains values like 'success' instead of epoch ms.

PRAGMA foreign_keys=OFF;

CREATE TABLE jobs_repair (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  type               TEXT NOT NULL CHECK (type IN ('http','shell','script','docker','sql')),
  schedule           TEXT NOT NULL,
  timezone           TEXT NOT NULL DEFAULT 'UTC',
  config             TEXT NOT NULL DEFAULT '{}',
  enabled            INTEGER NOT NULL DEFAULT 1,
  timeout_sec        INTEGER NOT NULL DEFAULT 300,
  max_retries        INTEGER NOT NULL DEFAULT 0,
  retry_backoff_sec  INTEGER NOT NULL DEFAULT 30,
  concurrency_policy TEXT NOT NULL DEFAULT 'forbid' CHECK (concurrency_policy IN ('allow','forbid','replace')),
  tags               TEXT NOT NULL DEFAULT '[]',
  depends_on         TEXT NOT NULL DEFAULT '[]',
  color              TEXT NOT NULL DEFAULT '',
  last_run_at        INTEGER,
  last_status        TEXT,
  next_run_at        INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

INSERT INTO jobs_repair (
  id, name, description, type, schedule, timezone, config, enabled, timeout_sec, max_retries,
  retry_backoff_sec, concurrency_policy, tags, depends_on, color, last_run_at, last_status, next_run_at, created_at, updated_at
)
SELECT
  id, name, description, type, schedule, timezone, config, enabled, timeout_sec, max_retries,
  retry_backoff_sec, concurrency_policy, tags,
  CASE
    WHEN last_run_at IN ('success','failed','timeout','running','queued','cancelled','skipped') THEN
      CASE WHEN typeof(updated_at) = 'text' AND trim(updated_at) GLOB '[[]*' THEN updated_at ELSE '[]' END
    ELSE depends_on
  END,
  CASE
    WHEN last_run_at IN ('success','failed','timeout','running','queued','cancelled','skipped') THEN depends_on
    ELSE color
  END,
  CASE
    WHEN last_run_at IN ('success','failed','timeout','running','queued','cancelled','skipped') THEN
      CASE WHEN typeof(color) = 'integer' THEN color
           WHEN typeof(color) = 'text' AND color GLOB '[0-9]*' THEN CAST(color AS INTEGER)
           ELSE NULL END
    ELSE last_run_at
  END,
  CASE
    WHEN last_run_at IN ('success','failed','timeout','running','queued','cancelled','skipped') THEN last_run_at
    ELSE last_status
  END,
  CASE
    WHEN last_run_at IN ('success','failed','timeout','running','queued','cancelled','skipped') THEN
      CASE WHEN typeof(last_status) = 'integer' THEN last_status
           WHEN typeof(last_status) = 'text' AND last_status GLOB '[0-9]*' THEN CAST(last_status AS INTEGER)
           ELSE NULL END
    ELSE next_run_at
  END,
  CASE
    WHEN last_run_at IN ('success','failed','timeout','running','queued','cancelled','skipped') THEN
      CASE WHEN typeof(next_run_at) = 'integer' THEN next_run_at
           WHEN typeof(next_run_at) = 'text' AND next_run_at GLOB '[0-9]*' THEN CAST(next_run_at AS INTEGER)
           ELSE created_at END
    ELSE created_at
  END,
  CASE
    WHEN last_run_at IN ('success','failed','timeout','running','queued','cancelled','skipped') THEN created_at
    ELSE updated_at
  END
FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_repair RENAME TO jobs;
CREATE INDEX IF NOT EXISTS idx_jobs_name ON jobs(name);

PRAGMA foreign_keys=ON;
