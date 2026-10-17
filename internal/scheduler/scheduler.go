// Package scheduler wraps robfig/cron and keeps cron entries in sync with jobs.
package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/robfig/cron/v3"

	"github.com/honk/crondeck/internal/deps"
	"github.com/honk/crondeck/internal/events"
	"github.com/honk/crondeck/internal/runner"
	"github.com/honk/crondeck/internal/store"
)

var parser = cron.NewParser(cron.SecondOptional | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor)

// Parse validates a cron expression in the given timezone.
// Supports 5 fields, 6 fields (leading seconds) and descriptors (@daily, @every 5m...).
func Parse(expr, tz string) (cron.Schedule, error) {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return nil, fmt.Errorf("schedule is required")
	}
	if strings.HasPrefix(expr, "TZ=") || strings.HasPrefix(expr, "CRON_TZ=") {
		return nil, fmt.Errorf("set the timezone field instead of a TZ= prefix")
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, fmt.Errorf("invalid timezone %q", tz)
	}
	if rest, ok := strings.CutPrefix(expr, "@every "); ok {
		// robfig silently rounds sub-second intervals up; reject them explicitly instead.
		d, err := time.ParseDuration(strings.TrimSpace(rest))
		if err != nil {
			return nil, fmt.Errorf("invalid @every duration: %w", err)
		}
		if d < time.Second {
			return nil, fmt.Errorf("@every interval must be at least 1s")
		}
	}
	s, err := parser.Parse("CRON_TZ=" + loc.String() + " " + expr)
	if err != nil {
		return nil, err
	}
	if s.Next(time.Now()).IsZero() {
		return nil, fmt.Errorf("schedule has no possible future activation")
	}
	return s, nil
}

// NextN returns the next n activation times after `from`.
func NextN(expr, tz string, from time.Time, n int) ([]time.Time, error) {
	s, err := Parse(expr, tz)
	if err != nil {
		return nil, err
	}
	out := make([]time.Time, 0, n)
	t := from
	for i := 0; i < n; i++ {
		t = s.Next(t)
		if t.IsZero() {
			break
		}
		out = append(out, t)
	}
	return out, nil
}

// JobNextN preserves the registered phase of @every jobs instead of shifting it on each preview request.
func JobNextN(j *store.Job, from time.Time, n int) ([]time.Time, error) {
	s, err := Parse(j.Schedule, j.Timezone)
	if err != nil {
		return nil, err
	}
	t := from
	out := make([]time.Time, 0, n)
	for i := 0; i < n; i++ {
		t = nextActivation(j, s, t)
		if t.IsZero() {
			break
		}
		out = append(out, t)
	}
	return out, nil
}

func nextActivation(j *store.Job, s cron.Schedule, after time.Time) time.Time {
	if cd, ok := s.(cron.ConstantDelaySchedule); ok && j.NextRunAt != nil {
		anchor := *j.NextRunAt
		if anchor.After(after) {
			return anchor
		}
		steps := after.Sub(anchor)/cd.Delay + 1
		return anchor.Add(steps * cd.Delay)
	}
	return s.Next(after)
}

type Scheduler struct {
	c       *cron.Cron
	st      *store.Store
	run     *runner.Runner
	hub     *events.Hub
	log     *slog.Logger
	mu      sync.Mutex
	entries map[string]cron.EntryID
}

func New(st *store.Store, r *runner.Runner, hub *events.Hub, log *slog.Logger) *Scheduler {
	return &Scheduler{
		c:  cron.New(cron.WithParser(parser), cron.WithChain(cron.Recover(cron.DiscardLogger))),
		st: st, run: r, hub: hub, log: log, entries: map[string]cron.EntryID{},
	}
}

// Load registers all enabled jobs. Call before Start.
func (s *Scheduler) Load(ctx context.Context) error {
	jobs, err := s.st.Jobs.All(ctx)
	if err != nil {
		return err
	}
	for _, j := range jobs {
		if err := s.Upsert(j); err != nil {
			s.log.Warn("job has invalid schedule; skipped", "job", j.Name, "err", err)
		}
	}
	return nil
}

// Reload discards all old entries, including jobs absent from the restored database.
func (s *Scheduler) Reload(ctx context.Context) error {
	s.mu.Lock()
	for _, id := range s.entries {
		s.c.Remove(id)
	}
	s.entries = map[string]cron.EntryID{}
	s.mu.Unlock()
	return s.Load(ctx)
}

func (s *Scheduler) Start() { s.c.Start() }

// Stop stops firing new entries (running runs are handled by the runner).
func (s *Scheduler) Stop() { <-s.c.Stop().Done() }

// Upsert (re)registers a job. Disabled jobs are removed and get next_run_at = NULL.
func (s *Scheduler) Upsert(j *store.Job) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id, ok := s.entries[j.ID]; ok {
		s.c.Remove(id)
		delete(s.entries, j.ID)
	}
	ctx := context.Background()
	if !j.Enabled || deps.IsDependencyOnly(j) {
		_ = s.st.Jobs.SetNextRun(ctx, j.ID, nil)
		return nil
	}
	sched, err := Parse(j.Schedule, j.Timezone)
	if err != nil {
		_ = s.st.Jobs.SetNextRun(ctx, j.ID, nil)
		return err
	}
	jobID := j.ID
	id := s.c.Schedule(sched, cron.FuncJob(func() { s.fire(jobID) }))
	s.entries[j.ID] = id
	next := sched.Next(time.Now())
	_ = s.st.Jobs.SetNextRun(ctx, j.ID, &next)
	return nil
}

func (s *Scheduler) Remove(jobID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id, ok := s.entries[jobID]; ok {
		s.c.Remove(id)
		delete(s.entries, jobID)
	}
}

func (s *Scheduler) fire(jobID string) {
	ctx := context.Background()
	job, err := s.st.Jobs.Get(ctx, jobID)
	if err != nil {
		s.Remove(jobID)
		return
	}
	// update next run first so the UI is accurate while the run executes
	s.mu.Lock()
	if id, ok := s.entries[jobID]; ok {
		next := s.c.Entry(id).Schedule.Next(time.Now())
		_ = s.st.Jobs.SetNextRun(ctx, jobID, &next)
		job.NextRunAt = &next
	}
	s.mu.Unlock()
	if !job.Enabled {
		return
	}
	if _, err := s.run.Trigger(job, store.TriggerSchedule); err != nil {
		s.log.Warn("scheduled trigger failed", "job", job.Name, "err", err)
	}
	// Run events already refresh job state. A schedule tick isn't a configuration change.
}

// Upcoming returns scheduled activations within the window for all registered jobs.
type Upcoming struct {
	JobID   string    `json:"job_id"`
	JobName string    `json:"job_name"`
	JobType string    `json:"job_type"`
	At      time.Time `json:"at"`
}

// DayJobs is one job's activations on a given calendar day.
type DayJobs struct {
	JobID   string    `json:"job_id"`
	JobName string    `json:"job_name"`
	JobType string    `json:"job_type"`
	Count   int       `json:"count"`
	First   time.Time `json:"first"`
	Last    time.Time `json:"last"`
}

type Day struct {
	Date    string    `json:"date"`
	Total   int       `json:"total"`
	Partial bool      `json:"partial"` // a very frequent job hit the iteration cap on/before this day
	Jobs    []DayJobs `json:"jobs"`
}

// UpcomingDays buckets activations per calendar day (in loc) over [from, from+days).
// Each job is capped at maxPerJob iterations to bound CPU for every-second schedules.
func (s *Scheduler) UpcomingDays(ctx context.Context, from time.Time, days int, loc *time.Location, maxPerJob int) ([]Day, error) {
	jobs, err := s.st.Jobs.All(ctx)
	if err != nil {
		return nil, err
	}
	start := time.Date(from.In(loc).Year(), from.In(loc).Month(), from.In(loc).Day(), 0, 0, 0, 0, loc)
	end := start.AddDate(0, 0, days)
	out := make([]Day, days)
	index := map[string]int{}
	for i := range out {
		d := start.AddDate(0, 0, i).Format("2006-01-02")
		out[i] = Day{Date: d, Jobs: []DayJobs{}}
		index[d] = i
	}
	for _, j := range jobs {
		if !j.Enabled || deps.IsDependencyOnly(j) {
			continue
		}
		sched, err := Parse(j.Schedule, j.Timezone)
		if err != nil {
			continue
		}
		perDay := map[int]*DayJobs{}
		if cd, ok := sched.(cron.ConstantDelaySchedule); ok {
			// @every schedules: count arithmetically instead of iterating (cheap for any frequency).
			first := nextActivation(j, sched, start.Add(-time.Nanosecond))
			for i := range out {
				ds := start.AddDate(0, 0, i)
				de := start.AddDate(0, 0, i+1)
				lo, hi := ceilSteps(first, ds, cd.Delay), ceilSteps(first, de, cd.Delay)
				if hi > lo {
					perDay[i] = &DayJobs{JobID: j.ID, JobName: j.Name, JobType: j.Type, Count: int(hi - lo),
						First: first.Add(time.Duration(lo) * cd.Delay), Last: first.Add(time.Duration(hi-1) * cd.Delay)}
				}
			}
			for i, dj := range perDay {
				out[i].Jobs = append(out[i].Jobs, *dj)
				out[i].Total += dj.Count
			}
			continue
		}
		t := start.Add(-time.Nanosecond)
		capped := true
		for n := 0; n < maxPerJob; n++ {
			t = nextActivation(j, sched, t)
			if t.IsZero() || !t.Before(end) {
				capped = false
				break
			}
			i := index[t.In(loc).Format("2006-01-02")]
			dj := perDay[i]
			if dj == nil {
				dj = &DayJobs{JobID: j.ID, JobName: j.Name, JobType: j.Type, First: t}
				perDay[i] = dj
			}
			dj.Count++
			dj.Last = t
		}
		for i, dj := range perDay {
			out[i].Jobs = append(out[i].Jobs, *dj)
			out[i].Total += dj.Count
		}
		if capped {
			if ci, ok := index[t.In(loc).Format("2006-01-02")]; ok {
				for k := ci; k < len(out); k++ {
					out[k].Partial = true
				}
			}
		}
	}
	for i := range out {
		sort.Slice(out[i].Jobs, func(a, b int) bool { return out[i].Jobs[a].First.Before(out[i].Jobs[b].First) })
	}
	return out, nil
}

// ceilSteps returns the smallest k >= 0 such that first + k*step >= t.
func ceilSteps(first, t time.Time, step time.Duration) int64 {
	if !t.After(first) {
		return 0
	}
	d := t.Sub(first)
	return int64((d + step - 1) / step)
}

func (s *Scheduler) Upcoming(ctx context.Context, from, to time.Time, perJobLimit int) ([]Upcoming, error) {
	jobs, err := s.st.Jobs.All(ctx)
	if err != nil {
		return nil, err
	}
	out := []Upcoming{}
	for _, j := range jobs {
		if !j.Enabled || deps.IsDependencyOnly(j) {
			continue
		}
		sched, err := Parse(j.Schedule, j.Timezone)
		if err != nil {
			continue
		}
		t := from
		for i := 0; i < perJobLimit; i++ {
			t = sched.Next(t)
			if t.IsZero() || t.After(to) {
				break
			}
			out = append(out, Upcoming{JobID: j.ID, JobName: j.Name, JobType: j.Type, At: t})
		}
	}
	return out, nil
}
