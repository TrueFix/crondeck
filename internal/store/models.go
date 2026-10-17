// Package store contains SQLite-backed repositories.
//
// IMPORTANT: the DB uses a single connection. Never issue a query while iterating
// another *sql.Rows — always read rows fully and close them first.
package store

import (
	"encoding/json"
	"time"
)

const (
	TypeHTTP   = "http"
	TypeShell  = "shell"
	TypeScript = "script"
	TypeSQL    = "sql"

	StatusQueued    = "queued"
	StatusRunning   = "running"
	StatusSuccess   = "success"
	StatusFailed    = "failed"
	StatusTimeout   = "timeout"
	StatusCancelled = "cancelled"
	StatusSkipped   = "skipped"

	TriggerSchedule = "schedule"
	TriggerManual   = "manual"
	TriggerRetry    = "retry"
	TriggerChain    = "chain"

	PolicyAllow   = "allow"
	PolicyForbid  = "forbid"
	PolicyReplace = "replace"
)

type Job struct {
	ID                string          `json:"id"`
	Name              string          `json:"name"`
	Description       string          `json:"description"`
	Type              string          `json:"type"`
	Schedule          string          `json:"schedule"`
	Timezone          string          `json:"timezone"`
	Config            json.RawMessage `json:"config"`
	Enabled           bool            `json:"enabled"`
	TimeoutSec        int             `json:"timeout_sec"`
	MaxRetries        int             `json:"max_retries"`
	RetryBackoffSec   int             `json:"retry_backoff_sec"`
	ConcurrencyPolicy string          `json:"concurrency_policy"`
	Tags              []string        `json:"tags"`
	DependsOn         []string        `json:"depends_on"`
	Color             string          `json:"color"`
	LastRunAt         *time.Time      `json:"last_run_at"`
	LastStatus        *string         `json:"last_status"`
	NextRunAt         *time.Time      `json:"next_run_at"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

type Run struct {
	ID         string     `json:"id"`
	JobID      string     `json:"job_id"`
	JobName    string     `json:"job_name,omitempty"`
	JobType    string     `json:"job_type,omitempty"`
	Status     string     `json:"status"`
	Trigger    string     `json:"trigger"`
	Attempt    int        `json:"attempt"`
	StartedAt  *time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
	DurationMs *int64     `json:"duration_ms"`
	ExitCode   *int       `json:"exit_code"`
	HTTPStatus *int       `json:"http_status"`
	Output     string     `json:"output,omitempty"`
	Error      string     `json:"error"`
	CreatedAt  time.Time  `json:"created_at"`
}

type AuditEntry struct {
	ID        int64           `json:"id"`
	Action    string          `json:"action"`
	TargetID  string          `json:"target_id"`
	Meta      json.RawMessage `json:"meta"`
	IP        string          `json:"ip"`
	CreatedAt time.Time       `json:"created_at"`
}

type Session struct {
	ID        string    `json:"-"`
	UserID    string    `json:"user_id,omitempty"`
	Username  string    `json:"username,omitempty"`
	Role      string    `json:"role,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
	IP        string    `json:"ip"`
	UserAgent string    `json:"user_agent"`
}

// ---- time helpers (unix ms <-> time) ----

func ms(t time.Time) int64 { return t.UTC().UnixMilli() }

func msPtr(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().UnixMilli()
}

func fromMs(v int64) time.Time { return time.UnixMilli(v).UTC() }

func fromNullMs(v *int64) *time.Time {
	if v == nil {
		return nil
	}
	t := fromMs(*v)
	return &t
}
