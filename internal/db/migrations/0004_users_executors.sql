-- Session → user link, job types docker + sql.

ALTER TABLE sessions ADD COLUMN user_id TEXT;

PRAGMA foreign_keys=OFF;

CREATE TABLE jobs_new (
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

-- depends_on was added at the end of jobs in 0002; list columns explicitly (SELECT * misaligned rows).
INSERT INTO jobs_new (
  id, name, description, type, schedule, timezone, config, enabled, timeout_sec, max_retries,
  retry_backoff_sec, concurrency_policy, tags, depends_on, color, last_run_at, last_status, next_run_at, created_at, updated_at
)
SELECT
  id, name, description, type, schedule, timezone, config, enabled, timeout_sec, max_retries,
  retry_backoff_sec, concurrency_policy, tags, depends_on, color, last_run_at, last_status, next_run_at, created_at, updated_at
FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;
CREATE INDEX idx_jobs_name ON jobs(name);

PRAGMA foreign_keys=ON;
