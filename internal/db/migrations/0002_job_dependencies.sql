-- Job dependency chains + chain run trigger.

ALTER TABLE jobs ADD COLUMN depends_on TEXT NOT NULL DEFAULT '[]';

PRAGMA foreign_keys=OFF;

CREATE TABLE runs_new (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('queued','running','success','failed','timeout','cancelled','skipped')),
  trigger       TEXT NOT NULL CHECK (trigger IN ('schedule','manual','retry','chain')),
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

INSERT INTO runs_new SELECT * FROM runs;

DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;

CREATE INDEX idx_runs_job_created ON runs(job_id, created_at DESC);
CREATE INDEX idx_runs_status      ON runs(status);
CREATE INDEX idx_runs_created     ON runs(created_at);

PRAGMA foreign_keys=ON;
