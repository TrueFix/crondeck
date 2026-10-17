package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

type RunStore struct{ db *sql.DB }

const runCols = `r.id, r.job_id, COALESCE(j.name, ''), COALESCE(j.type, ''), r.status, r.trigger, r.attempt, r.started_at,
r.finished_at, r.duration_ms, r.exit_code, r.http_status, r.error, r.created_at`

func scanRun(s scanner, withOutput bool) (*Run, error) {
	var (
		r                   Run
		started, finished   *int64
		createdAt           int64
	)
	dest := []any{&r.ID, &r.JobID, &r.JobName, &r.JobType, &r.Status, &r.Trigger, &r.Attempt, &started, &finished,
		&r.DurationMs, &r.ExitCode, &r.HTTPStatus, &r.Error, &createdAt}
	if withOutput {
		dest = append(dest, &r.Output)
	}
	if err := s.Scan(dest...); err != nil {
		return nil, err
	}
	r.StartedAt = fromNullMs(started)
	r.FinishedAt = fromNullMs(finished)
	r.CreatedAt = fromMs(createdAt)
	return &r, nil
}

func (s *RunStore) Create(ctx context.Context, r *Run) error {
	if r.ID == "" {
		r.ID = NewID()
	}
	if r.CreatedAt.IsZero() {
		r.CreatedAt = time.Now().UTC()
	}
	if r.Attempt == 0 {
		r.Attempt = 1
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO runs (id, job_id, status, trigger, attempt, started_at, finished_at,
		duration_ms, exit_code, http_status, output, error, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		r.ID, r.JobID, r.Status, r.Trigger, r.Attempt, msPtr(r.StartedAt), msPtr(r.FinishedAt), r.DurationMs,
		r.ExitCode, r.HTTPStatus, r.Output, r.Error, ms(r.CreatedAt))
	return err
}

func (s *RunStore) MarkRunning(ctx context.Context, id string, at time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE runs SET status='running', started_at=? WHERE id=?`, ms(at), id)
	return err
}

func (s *RunStore) Finish(ctx context.Context, r *Run) error {
	_, err := s.db.ExecContext(ctx, `UPDATE runs SET status=?, finished_at=?, duration_ms=?, exit_code=?, http_status=?,
		output=?, error=? WHERE id=?`,
		r.Status, msPtr(r.FinishedAt), r.DurationMs, r.ExitCode, r.HTTPStatus, r.Output, r.Error, r.ID)
	return err
}

func (s *RunStore) Get(ctx context.Context, id string) (*Run, error) {
	r, err := scanRun(s.db.QueryRowContext(ctx, `SELECT `+runCols+`, r.output FROM runs r LEFT JOIN jobs j ON j.id = r.job_id
		WHERE r.id=?`, id), true)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return r, err
}

type RunFilter struct {
	JobID   string
	Status  string
	Trigger string
	From    *time.Time
	To      *time.Time
	Page    int
	PerPage int
}

func (s *RunStore) List(ctx context.Context, f RunFilter) ([]*Run, int, error) {
	where := []string{"1=1"}
	args := []any{}
	if f.JobID != "" {
		where = append(where, "r.job_id = ?")
		args = append(args, f.JobID)
	}
	if f.Status != "" {
		where = append(where, "r.status = ?")
		args = append(args, f.Status)
	}
	if f.Trigger != "" {
		where = append(where, "r.trigger = ?")
		args = append(args, f.Trigger)
	}
	if f.From != nil {
		where = append(where, "r.created_at >= ?")
		args = append(args, ms(*f.From))
	}
	if f.To != nil {
		where = append(where, "r.created_at <= ?")
		args = append(args, ms(*f.To))
	}
	if f.PerPage <= 0 || f.PerPage > 500 {
		f.PerPage = 50
	}
	if f.Page <= 0 {
		f.Page = 1
	}
	w := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM runs r WHERE `+w, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+runCols+` FROM runs r LEFT JOIN jobs j ON j.id = r.job_id WHERE `+w+
		` ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`, append(args, f.PerPage, (f.Page-1)*f.PerPage)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*Run{}
	for rows.Next() {
		r, err := scanRun(rows, false)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// FailInterrupted marks runs left in running/queued state (e.g. after a crash) as failed.
func (s *RunStore) FailInterrupted(ctx context.Context) (int64, error) {
	now := ms(time.Now())
	res, err := s.db.ExecContext(ctx, `UPDATE runs SET status='failed', error='interrupted by restart', finished_at=?
		WHERE status IN ('running','queued')`, now)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *RunStore) DeleteOlderThan(ctx context.Context, before time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM runs WHERE created_at < ? AND status NOT IN ('running','queued')`, ms(before))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ---------------------------------------------------------------- stats

type Overview struct {
	TotalJobs       int     `json:"total_jobs"`
	EnabledJobs     int     `json:"enabled_jobs"`
	FailingJobs     int     `json:"failing_jobs"`
	RunningNow      int     `json:"running_now"`
	Runs24h         int     `json:"runs_24h"`
	Success24h      int     `json:"success_24h"`
	Failed24h       int     `json:"failed_24h"`
	SuccessRate24h  float64 `json:"success_rate_24h"`
	SuccessRate7d   float64 `json:"success_rate_7d"`
	Runs7d          int     `json:"runs_7d"`
	AvgDurationMs7d float64 `json:"avg_duration_ms_7d"`
	PrevRuns24h     int     `json:"prev_runs_24h"`
	PrevSuccess24h  float64 `json:"prev_success_rate_24h"`
}

func rate(success, total int) float64 {
	if total == 0 {
		return 0
	}
	return float64(success) * 100 / float64(total)
}

// finished statuses counted in success-rate math
const finishedIn = `('success','failed','timeout','cancelled')`

func (s *RunStore) Overview(ctx context.Context) (*Overview, error) {
	o := &Overview{}
	now := time.Now()
	d1, d2, d7 := ms(now.Add(-24*time.Hour)), ms(now.Add(-48*time.Hour)), ms(now.Add(-7*24*time.Hour))

	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(1), COALESCE(SUM(enabled),0),
		COALESCE(SUM(CASE WHEN last_status IN ('failed','timeout') THEN 1 ELSE 0 END),0) FROM jobs`).
		Scan(&o.TotalJobs, &o.EnabledJobs, &o.FailingJobs); err != nil {
		return nil, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM runs WHERE status='running'`).Scan(&o.RunningNow); err != nil {
		return nil, err
	}
	var fin24 int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(1),
		COALESCE(SUM(CASE WHEN status='success' THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status IN ('failed','timeout') THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status IN `+finishedIn+` THEN 1 ELSE 0 END),0)
		FROM runs WHERE created_at >= ?`, d1).Scan(&o.Runs24h, &o.Success24h, &o.Failed24h, &fin24); err != nil {
		return nil, err
	}
	o.SuccessRate24h = rate(o.Success24h, fin24)

	var pSucc, pFin int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(1),
		COALESCE(SUM(CASE WHEN status='success' THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status IN `+finishedIn+` THEN 1 ELSE 0 END),0)
		FROM runs WHERE created_at >= ? AND created_at < ?`, d2, d1).Scan(&o.PrevRuns24h, &pSucc, &pFin); err != nil {
		return nil, err
	}
	o.PrevSuccess24h = rate(pSucc, pFin)

	var s7, f7 int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(1),
		COALESCE(SUM(CASE WHEN status='success' THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN status IN `+finishedIn+` THEN 1 ELSE 0 END),0),
		COALESCE(AVG(duration_ms),0)
		FROM runs WHERE created_at >= ?`, d7).Scan(&o.Runs7d, &s7, &f7, &o.AvgDurationMs7d); err != nil {
		return nil, err
	}
	o.SuccessRate7d = rate(s7, f7)
	return o, nil
}

type TimelineBucket struct {
	T       time.Time `json:"t"`
	Success int       `json:"success"`
	Failed  int       `json:"failed"`
	Other   int       `json:"other"`
}

// Timeline returns evenly sized buckets covering [now-span, now].
func (s *RunStore) Timeline(ctx context.Context, span, bucket time.Duration) ([]TimelineBucket, error) {
	now := time.Now().UTC()
	start := now.Add(-span).Truncate(bucket)
	bms := bucket.Milliseconds()
	rows, err := s.db.QueryContext(ctx, `SELECT (created_at - ?) / ? AS b,
		SUM(CASE WHEN status='success' THEN 1 ELSE 0 END),
		SUM(CASE WHEN status IN ('failed','timeout') THEN 1 ELSE 0 END),
		SUM(CASE WHEN status NOT IN ('success','failed','timeout') THEN 1 ELSE 0 END)
		FROM runs WHERE created_at >= ? GROUP BY b`, ms(start), bms, ms(start))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	n := int(now.Sub(start)/bucket) + 1
	out := make([]TimelineBucket, n)
	for i := range out {
		out[i].T = start.Add(time.Duration(i) * bucket)
	}
	for rows.Next() {
		var b int64
		var sc, fc, oc int
		if err := rows.Scan(&b, &sc, &fc, &oc); err != nil {
			return nil, err
		}
		if b >= 0 && int(b) < n {
			out[b].Success, out[b].Failed, out[b].Other = sc, fc, oc
		}
	}
	return out, rows.Err()
}

type HeatDay struct {
	Date    string `json:"date"`
	Total   int    `json:"total"`
	Failed  int    `json:"failed"`
}

func (s *RunStore) Heatmap(ctx context.Context, days int) ([]HeatDay, error) {
	since := time.Now().UTC().AddDate(0, 0, -days)
	rows, err := s.db.QueryContext(ctx, `SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') AS d, COUNT(1),
		SUM(CASE WHEN status IN ('failed','timeout') THEN 1 ELSE 0 END)
		FROM runs WHERE created_at >= ? GROUP BY d ORDER BY d`, ms(since))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HeatDay{}
	for rows.Next() {
		var h HeatDay
		if err := rows.Scan(&h.Date, &h.Total, &h.Failed); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

type JobStat struct {
	JobID       string  `json:"job_id"`
	JobName     string  `json:"job_name"`
	JobType     string  `json:"job_type"`
	Runs        int     `json:"runs"`
	Failures    int     `json:"failures"`
	AvgDuration float64 `json:"avg_duration_ms"`
	SuccessRate float64 `json:"success_rate"`
}

// TopJobs returns per-job stats over the last `since`, ordered by `order` ("failures" or "duration").
func (s *RunStore) TopJobs(ctx context.Context, since time.Duration, order string, limit int) ([]JobStat, error) {
	ob := "failures DESC, runs DESC"
	if order == "duration" {
		ob = "avg_d DESC"
	}
	rows, err := s.db.QueryContext(ctx, `SELECT r.job_id, j.name, j.type, COUNT(1) AS runs,
		SUM(CASE WHEN r.status IN ('failed','timeout') THEN 1 ELSE 0 END) AS failures,
		COALESCE(AVG(r.duration_ms),0) AS avg_d,
		SUM(CASE WHEN r.status='success' THEN 1 ELSE 0 END) AS succ
		FROM runs r JOIN jobs j ON j.id = r.job_id WHERE r.created_at >= ?
		GROUP BY r.job_id ORDER BY `+ob+` LIMIT ?`, ms(time.Now().Add(-since)), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []JobStat{}
	for rows.Next() {
		var st JobStat
		var succ int
		if err := rows.Scan(&st.JobID, &st.JobName, &st.JobType, &st.Runs, &st.Failures, &st.AvgDuration, &succ); err != nil {
			return nil, err
		}
		st.SuccessRate = rate(succ, st.Runs)
		out = append(out, st)
	}
	return out, rows.Err()
}

// JobSparkline returns the durations/status of the last n finished runs of a job (oldest first).
func (s *RunStore) JobRecent(ctx context.Context, jobID string, n int) ([]*Run, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+runCols+` FROM runs r LEFT JOIN jobs j ON j.id=r.job_id
		WHERE r.job_id=? ORDER BY r.created_at DESC LIMIT ?`, jobID, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Run{}
	for rows.Next() {
		r, err := scanRun(rows, false)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}
