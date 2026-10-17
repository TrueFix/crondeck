package scheduler_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/honk/crondeck/internal/db"
	"github.com/honk/crondeck/internal/events"
	"github.com/honk/crondeck/internal/executor"
	"github.com/honk/crondeck/internal/runner"
	"github.com/honk/crondeck/internal/scheduler"
	"github.com/honk/crondeck/internal/store"
)

func TestParse(t *testing.T) {
	if _, err := scheduler.Parse("0 0 31 2 *", "UTC"); err == nil {
		t.Error("impossible date accepted")
	}
	for _, ok := range []string{"*/5 * * * *", "0 */10 * * * *", "@daily", "@every 2s", "0 9 * * MON-FRI"} {
		if _, err := scheduler.Parse(ok, "Europe/Berlin"); err != nil {
			t.Errorf("%q: %v", ok, err)
		}
	}
	for _, bad := range []string{"", "nope", "* * *", "@every 100ms", "TZ=UTC * * * * *"} {
		if _, err := scheduler.Parse(bad, "UTC"); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	if _, err := scheduler.Parse("* * * * *", "Mars/Base"); err == nil {
		t.Error("bad tz accepted")
	}
	next, _ := scheduler.NextN("0 0 * * *", "UTC", time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC), 3)
	if len(next) != 3 || next[0].Day() != 2 || next[2].Day() != 4 {
		t.Errorf("next %v", next)
	}
}

func TestIntervalPreviewPreservesPhase(t *testing.T) {
	anchor := time.Now().UTC().Truncate(time.Second).Add(37 * time.Second)
	j := &store.Job{Schedule: "@every 1m", Timezone: "UTC", NextRunAt: &anchor}
	next, err := scheduler.JobNextN(j, anchor.Add(-20*time.Second), 3)
	if err != nil || len(next) != 3 || !next[0].Equal(anchor) || !next[2].Equal(anchor.Add(2*time.Minute)) {
		t.Fatalf("phase shifted: %v %v", next, err)
	}
}

func setup(t *testing.T) (*store.Store, *runner.Runner, *scheduler.Scheduler) {
	d, err := db.Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	st := store.New(d)
	hub := events.NewHub()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := runner.New(st, hub, executor.DefaultRegistry(), runner.Options{MaxConcurrent: 4, MaxOutputBytes: 4096, AllowShell: true}, log)
	s := scheduler.New(st, r, hub, log)
	t.Cleanup(func() {
		s.Stop()
		ctx, c := context.WithTimeout(context.Background(), 2*time.Second)
		defer c()
		r.Stop(ctx)
		d.Close()
	})
	return st, r, s
}

func mkJob(t *testing.T, st *store.Store, cmd, policy, schedule string) *store.Job {
	cfg, _ := json.Marshal(map[string]string{"command": cmd})
	j := &store.Job{Name: "t", Type: "shell", Schedule: schedule, Timezone: "UTC", Config: cfg, Enabled: true,
		TimeoutSec: 10, ConcurrencyPolicy: policy}
	if err := st.Jobs.Create(context.Background(), j); err != nil {
		t.Fatal(err)
	}
	return j
}

func countRuns(st *store.Store, jobID, status string) int {
	_, n, _ := st.Runs.List(context.Background(), store.RunFilter{JobID: jobID, Status: status})
	return n
}

func TestScheduledRunsAndForbid(t *testing.T) {
	st, _, s := setup(t)
	fast := mkJob(t, st, "echo hi", "allow", "@every 1s")
	slow := mkJob(t, st, "sleep 3", "forbid", "@every 1s")
	if err := s.Load(context.Background()); err != nil {
		t.Fatal(err)
	}
	s.Start()
	time.Sleep(3500 * time.Millisecond)

	if n := countRuns(st, fast.ID, "success"); n < 2 {
		t.Fatalf("expected >=2 successful runs, got %d", n)
	}
	if n := countRuns(st, slow.ID, "skipped"); n < 1 {
		t.Fatalf("expected skipped runs for forbid policy, got %d", n)
	}
	j, _ := st.Jobs.Get(context.Background(), fast.ID)
	if j.NextRunAt == nil || j.LastStatus == nil || *j.LastStatus != "success" {
		t.Fatalf("job bookkeeping: %+v", j)
	}
}

func waitFor(t *testing.T, cond func() bool) {
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("condition not met in time")
}

func TestManualCancelTimeoutRetry(t *testing.T) {
	st, r, _ := setup(t)
	ctx := context.Background()

	j := mkJob(t, st, "sleep 10", "allow", "@daily")
	run, err := r.Trigger(j, store.TriggerManual)
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { got, _ := st.Runs.Get(ctx, run.ID); return got.Status == "running" })
	if err := r.Cancel(run.ID); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { got, _ := st.Runs.Get(ctx, run.ID); return got.Status == "cancelled" })

	j2 := mkJob(t, st, "sleep 10", "allow", "@daily")
	j2.TimeoutSec = 1
	if err := st.Jobs.Update(ctx, j2); err != nil {
		t.Fatal(err)
	}
	run2, _ := r.Trigger(j2, store.TriggerManual)
	waitFor(t, func() bool { got, _ := st.Runs.Get(ctx, run2.ID); return got.Status == "timeout" })

	j3 := mkJob(t, st, "exit 1", "allow", "@daily")
	j3.MaxRetries, j3.RetryBackoffSec = 2, 0
	_ = st.Jobs.Update(ctx, j3)
	_, _ = r.Trigger(j3, store.TriggerManual)
	waitFor(t, func() bool { return countRuns(st, j3.ID, "failed") == 3 })
	time.Sleep(200 * time.Millisecond)
	if n := countRuns(st, j3.ID, "failed"); n != 3 {
		t.Fatalf("expected exactly 3 attempts, got %d", n)
	}

	j4 := mkJob(t, st, "sleep 10", "replace", "@daily")
	a, _ := r.Trigger(j4, store.TriggerManual)
	waitFor(t, func() bool { got, _ := st.Runs.Get(ctx, a.ID); return got.Status == "running" })
	b, _ := r.Trigger(j4, store.TriggerManual)
	waitFor(t, func() bool { got, _ := st.Runs.Get(ctx, a.ID); return got.Status == "cancelled" })
	if got, _ := st.Runs.Get(ctx, a.ID); got.Error != "replaced by a newer run" {
		t.Fatalf("replace cause: %q", got.Error)
	}
	_ = r.Cancel(b.ID)
}

func TestShellBlocked(t *testing.T) {
	d, _ := db.Open(filepath.Join(t.TempDir(), "b.db"))
	defer d.Close()
	st := store.New(d)
	r := runner.New(st, events.NewHub(), executor.DefaultRegistry(), runner.Options{MaxConcurrent: 1, AllowShell: false},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	j := mkJob(t, st, "echo hi", "allow", "@daily")
	run, _ := r.Trigger(j, store.TriggerManual)
	waitFor(t, func() bool { got, _ := st.Runs.Get(context.Background(), run.ID); return got.Status == "failed" })
	r.Stop(context.Background())
}

func TestUpcomingDays(t *testing.T) {
	st, _, s := setup(t)
	mkJob(t, st, "echo", "allow", "0 * * * *") // 24/day
	mkJob(t, st, "echo", "allow", "0 9 * * *") // 1/day
	from := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	days, err := s.UpcomingDays(context.Background(), from, 3, time.UTC, 100000)
	if err != nil {
		t.Fatal(err)
	}
	if len(days) != 3 || days[0].Total != 25 || len(days[0].Jobs) != 2 || days[0].Date != "2030-01-01" {
		t.Fatalf("%+v", days)
	}
	mkJob(t, st, "echo", "allow", "@every 1s") // arithmetic path: exact counts
	days, _ = s.UpcomingDays(context.Background(), from, 3, time.UTC, 1000)
	if days[1].Total != 25+86400 || days[1].Partial {
		t.Fatalf("constant delay counts: %d partial=%v", days[1].Total, days[1].Partial)
	}
	mkJob(t, st, "echo", "allow", "* * * * * *") // every second spec -> capped
	days, _ = s.UpcomingDays(context.Background(), from, 3, time.UTC, 1000)
	if !days[0].Partial || !days[2].Partial {
		t.Fatalf("expected partial: %+v", days[0].Partial)
	}
}

// TestLoad: 200 jobs firing every second must not hit SQLITE_BUSY, lose runs or leak goroutines.
func TestLoad(t *testing.T) {
	if testing.Short() {
		t.Skip("load test skipped in -short mode")
	}
	st, r, s := setup(t)
	ctx := context.Background()
	for i := 0; i < 200; i++ {
		mkJob(t, st, "true", "forbid", "@every 1s")
	}
	if err := s.Load(ctx); err != nil {
		t.Fatal(err)
	}
	before := runtime.NumGoroutine()
	s.Start()
	time.Sleep(4200 * time.Millisecond)
	s.Stop()
	stopCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	r.Stop(stopCtx)

	_, total, err := st.Runs.List(ctx, store.RunFilter{})
	if err != nil {
		t.Fatal(err)
	}
	_, failed, _ := st.Runs.List(ctx, store.RunFilter{Status: "failed"})
	_, stuck, _ := st.Runs.List(ctx, store.RunFilter{Status: "running"})
	_, queued, _ := st.Runs.List(ctx, store.RunFilter{Status: "queued"})
	t.Logf("runs=%d failed=%d running=%d queued=%d goroutines before=%d after=%d", total, failed, stuck, queued, before, runtime.NumGoroutine())
	if total < 600 {
		t.Fatalf("expected >= 600 runs from 200 jobs over ~4s, got %d", total)
	}
	if failed > 0 || stuck > 0 || queued > 0 {
		t.Fatalf("unexpected failed=%d running=%d queued=%d", failed, stuck, queued)
	}
	time.Sleep(200 * time.Millisecond)
	if g := runtime.NumGoroutine(); g > before+20 {
		t.Fatalf("goroutine leak: before=%d after=%d", before, g)
	}
}
