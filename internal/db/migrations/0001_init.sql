-- All timestamps are stored as INTEGER unix epoch milliseconds (UTC).

CREATE TABLE jobs (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  type               TEXT NOT NULL CHECK (type IN ('http','shell','script')),
  schedule           TEXT NOT NULL,
  timezone           TEXT NOT NULL DEFAULT 'UTC',
  config             TEXT NOT NULL DEFAULT '{}',
  enabled            INTEGER NOT NULL DEFAULT 1,
  timeout_sec        INTEGER NOT NULL DEFAULT 300,
  max_retries        INTEGER NOT NULL DEFAULT 0,
  retry_backoff_sec  INTEGER NOT NULL DEFAULT 30,
  concurrency_policy TEXT NOT NULL DEFAULT 'forbid' CHECK (concurrency_policy IN ('allow','forbid','replace')),
  tags               TEXT NOT NULL DEFAULT '[]',
  color              TEXT NOT NULL DEFAULT '',
  last_run_at        INTEGER,
  last_status        TEXT,
  next_run_at        INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX idx_jobs_name ON jobs(name);

CREATE TABLE runs (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('queued','running','success','failed','timeout','cancelled','skipped')),
  trigger       TEXT NOT NULL CHECK (trigger IN ('schedule','manual','retry')),
  attempt       INTEGER NOT NULL DEFAULT 1,
  started_at    INTEGER,
  finished_at   INTEGER,
  duration_ms   INTEGER,
  exit_code     INTEGER,
  http_status   INTEGER,
  output        TEXT NOT NULL DEFAULT '',
  error         TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_runs_job_created ON runs(job_id, created_at DESC);
CREATE INDEX idx_runs_status      ON runs(status);
CREATE INDEX idx_runs_created     ON runs(created_at);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT NOT NULL,
  target_id   TEXT NOT NULL DEFAULT '',
  meta        TEXT NOT NULL DEFAULT '{}',
  ip          TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
