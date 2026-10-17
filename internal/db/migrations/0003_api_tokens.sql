-- API tokens for CI/automation (RBAC via role on each token).

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
  password_hash TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);

CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
  token_prefix TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   INTEGER,
  last_used_at INTEGER,
  revoked_at   INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_api_tokens_prefix ON api_tokens(token_prefix);
