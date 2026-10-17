package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type JobStore struct{ db *sql.DB }

const jobCols = `id, name, description, type, schedule, timezone, config, enabled, timeout_sec, max_retries,
retry_backoff_sec, concurrency_policy, tags, depends_on, color, last_run_at, last_status, next_run_at, created_at, updated_at`

type scanner interface{ Scan(dest ...any) error }

func scanJob(s scanner) (*Job, error) {
	var (
		j                      Job
		cfg, tags, dependsOn   string
		enabled                int
		lastRun, nextRun       *int64
		createdAt, updatedAt   int64
		lastStatus             *string
	)
	if err := s.Scan(&j.ID, &j.Name, &j.Description, &j.Type, &j.Schedule, &j.Timezone, &cfg, &enabled,
		&j.TimeoutSec, &j.MaxRetries, &j.RetryBackoffSec, &j.ConcurrencyPolicy, &tags, &dependsOn, &j.Color,
		&lastRun, &lastStatus, &nextRun, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	j.Config = json.RawMessage(cfg)
	j.Enabled = enabled == 1
	if err := json.Unmarshal([]byte(tags), &j.Tags); err != nil || j.Tags == nil {
		j.Tags = []string{}
	}
	if err := json.Unmarshal([]byte(dependsOn), &j.DependsOn); err != nil || j.DependsOn == nil {
		j.DependsOn = []string{}
	}
	j.LastRunAt = fromNullMs(lastRun)
	j.NextRunAt = fromNullMs(nextRun)
	j.LastStatus = lastStatus
	j.CreatedAt = fromMs(createdAt)
	j.UpdatedAt = fromMs(updatedAt)
	return &j, nil
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (s *JobStore) Create(ctx context.Context, j *Job) error {
	now := time.Now().UTC()
	if j.ID == "" {
		j.ID = NewID()
	}
	j.CreatedAt, j.UpdatedAt = now, now
	if j.Tags == nil {
		j.Tags = []string{}
	}
	if j.DependsOn == nil {
		j.DependsOn = []string{}
	}
	if len(j.Config) == 0 {
		j.Config = json.RawMessage("{}")
	}
	tags, _ := json.Marshal(j.Tags)
	deps, _ := json.Marshal(j.DependsOn)
	_, err := s.db.ExecContext(ctx, `INSERT INTO jobs (`+jobCols+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		j.ID, j.Name, j.Description, j.Type, j.Schedule, j.Timezone, string(j.Config), b2i(j.Enabled),
		j.TimeoutSec, j.MaxRetries, j.RetryBackoffSec, j.ConcurrencyPolicy, string(tags), string(deps), j.Color,
		msPtr(j.LastRunAt), j.LastStatus, msPtr(j.NextRunAt), ms(now), ms(now))
	return err
}

func (s *JobStore) Update(ctx context.Context, j *Job) error {
	j.UpdatedAt = time.Now().UTC()
	if j.Tags == nil {
		j.Tags = []string{}
	}
	if j.DependsOn == nil {
		j.DependsOn = []string{}
	}
	tags, _ := json.Marshal(j.Tags)
	deps, _ := json.Marshal(j.DependsOn)
	res, err := s.db.ExecContext(ctx, `UPDATE jobs SET name=?, description=?, type=?, schedule=?, timezone=?, config=?,
		enabled=?, timeout_sec=?, max_retries=?, retry_backoff_sec=?, concurrency_policy=?, tags=?, depends_on=?, color=?, updated_at=?
		WHERE id=?`,
		j.Name, j.Description, j.Type, j.Schedule, j.Timezone, string(j.Config), b2i(j.Enabled), j.TimeoutSec,
		j.MaxRetries, j.RetryBackoffSec, j.ConcurrencyPolicy, string(tags), string(deps), j.Color, ms(j.UpdatedAt), j.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *JobStore) Get(ctx context.Context, id string) (*Job, error) {
	j, err := scanJob(s.db.QueryRowContext(ctx, `SELECT `+jobCols+` FROM jobs WHERE id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return j, err
}

func (s *JobStore) Delete(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM jobs WHERE id=?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *JobStore) SetEnabled(ctx context.Context, id string, enabled bool) error {
	res, err := s.db.ExecContext(ctx, `UPDATE jobs SET enabled=?, updated_at=? WHERE id=?`, b2i(enabled), ms(time.Now()), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *JobStore) SetNextRun(ctx context.Context, id string, next *time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE jobs SET next_run_at=? WHERE id=?`, msPtr(next), id)
	return err
}

func (s *JobStore) SetLastRun(ctx context.Context, id string, at time.Time, status string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE jobs SET last_run_at=?, last_status=? WHERE id=?`, ms(at), status, id)
	return err
}

type JobFilter struct {
	Query   string
	Type    string
	Status  string // last_status value, or "never"
	Tag     string
	Enabled *bool
	Sort    string // name | -name | next_run | last_run | created (default -created)
	Page    int
	PerPage int
}

func (s *JobStore) List(ctx context.Context, f JobFilter) ([]*Job, int, error) {
	where := []string{"1=1"}
	args := []any{}
	if q := strings.TrimSpace(f.Query); q != "" {
		where = append(where, "(name LIKE ? OR description LIKE ? OR tags LIKE ?)")
		like := "%" + q + "%"
		args = append(args, like, like, like)
	}
	if f.Type != "" {
		where = append(where, "type = ?")
		args = append(args, f.Type)
	}
	if f.Status == "never" {
		where = append(where, "last_status IS NULL")
	} else if f.Status != "" {
		where = append(where, "last_status = ?")
		args = append(args, f.Status)
	}
	if f.Tag != "" {
		where = append(where, "EXISTS (SELECT 1 FROM json_each(jobs.tags) WHERE json_each.value = ?)")
		args = append(args, f.Tag)
	}
	if f.Enabled != nil {
		where = append(where, "enabled = ?")
		args = append(args, b2i(*f.Enabled))
	}
	order := map[string]string{
		"name": "name COLLATE NOCASE ASC", "-name": "name COLLATE NOCASE DESC",
		"next_run": "next_run_at IS NULL, next_run_at ASC", "last_run": "last_run_at DESC",
		"created": "created_at ASC", "-created": "created_at DESC",
	}[f.Sort]
	if order == "" {
		order = "created_at DESC"
	}
	if f.PerPage <= 0 || f.PerPage > 500 {
		f.PerPage = 50
	}
	if f.Page <= 0 {
		f.Page = 1
	}
	w := strings.Join(where, " AND ")

	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM jobs WHERE `+w, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+jobCols+` FROM jobs WHERE `+w+` ORDER BY `+order+` LIMIT ? OFFSET ?`,
		append(args, f.PerPage, (f.Page-1)*f.PerPage)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*Job{}
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, j)
	}
	return out, total, rows.Err()
}

// All returns every job (used by the scheduler at boot and for export).
func (s *JobStore) All(ctx context.Context) ([]*Job, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+jobCols+` FROM jobs ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Job{}
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

func (s *JobStore) Tags(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT DISTINCT json_each.value FROM jobs, json_each(jobs.tags) ORDER BY 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
