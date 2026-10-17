package store_test

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/honk/crondeck/internal/db"
	"github.com/honk/crondeck/internal/store"
)

func newStore(t *testing.T) *store.Store {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return store.New(d)
}

func TestMigrateIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "x.db")
	for i := 0; i < 2; i++ {
		d, err := db.Open(path)
		if err != nil {
			t.Fatalf("open %d: %v", i, err)
		}
		d.Close()
	}
}

func TestJobCRUD(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	j := &store.Job{Name: "Ping", Type: "http", Schedule: "*/5 * * * *", Timezone: "UTC",
		Config: json.RawMessage(`{"url":"https://example.com"}`), Enabled: true, TimeoutSec: 30,
		ConcurrencyPolicy: "forbid", Tags: []string{"web", "health"}}
	if err := s.Jobs.Create(ctx, j); err != nil {
		t.Fatal(err)
	}
	got, err := s.Jobs.Get(ctx, j.ID)
	if err != nil || got.Name != "Ping" || len(got.Tags) != 2 || !got.Enabled {
		t.Fatalf("get: %+v %v", got, err)
	}
	got.Name = "Ping 2"
	if err := s.Jobs.Update(ctx, got); err != nil {
		t.Fatal(err)
	}
	list, total, err := s.Jobs.List(ctx, store.JobFilter{Query: "ping 2"})
	if err != nil || total != 1 || list[0].Name != "Ping 2" {
		t.Fatalf("list: %v %d %v", list, total, err)
	}
	if _, total, _ := s.Jobs.List(ctx, store.JobFilter{Tag: "health"}); total != 1 {
		t.Fatalf("tag filter total=%d", total)
	}
	if _, total, _ := s.Jobs.List(ctx, store.JobFilter{Tag: "nope"}); total != 0 {
		t.Fatalf("tag filter mismatch total=%d", total)
	}
	tags, _ := s.Jobs.Tags(ctx)
	if len(tags) != 2 {
		t.Fatalf("tags %v", tags)
	}
	if err := s.Jobs.SetEnabled(ctx, j.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := s.Jobs.Delete(ctx, j.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Jobs.Get(ctx, j.ID); err != store.ErrNotFound {
		t.Fatalf("expected not found, got %v", err)
	}
}

func TestRunsAndStats(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	j := &store.Job{Name: "A", Type: "shell", Schedule: "@every 1m", Timezone: "UTC", ConcurrencyPolicy: "allow", Enabled: true}
	if err := s.Jobs.Create(ctx, j); err != nil {
		t.Fatal(err)
	}
	for i, st := range []string{"success", "success", "failed", "running"} {
		now := time.Now().UTC()
		r := &store.Run{JobID: j.ID, Status: st, Trigger: "manual", StartedAt: &now}
		if st != "running" {
			d := int64(100 * (i + 1))
			r.DurationMs = &d
			r.FinishedAt = &now
		}
		if err := s.Runs.Create(ctx, r); err != nil {
			t.Fatal(err)
		}
	}
	o, err := s.Runs.Overview(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if o.Runs24h != 4 || o.RunningNow != 1 || o.Failed24h != 1 {
		t.Fatalf("overview %+v", o)
	}
	if o.SuccessRate24h < 66 || o.SuccessRate24h > 67 {
		t.Fatalf("rate %v", o.SuccessRate24h)
	}
	tl, err := s.Runs.Timeline(ctx, 24*time.Hour, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	sum := 0
	for _, b := range tl {
		sum += b.Success + b.Failed + b.Other
	}
	if sum != 4 {
		t.Fatalf("timeline sum %d", sum)
	}
	hm, _ := s.Runs.Heatmap(ctx, 365)
	if len(hm) != 1 || hm[0].Total != 4 {
		t.Fatalf("heatmap %+v", hm)
	}
	n, _ := s.Runs.FailInterrupted(ctx)
	if n != 1 {
		t.Fatalf("interrupted %d", n)
	}
	runs, total, _ := s.Runs.List(ctx, store.RunFilter{JobID: j.ID, Status: "failed"})
	if total != 2 || runs[0].JobName != "A" {
		t.Fatalf("runs %d %+v", total, runs)
	}
	top, _ := s.Runs.TopJobs(ctx, 24*time.Hour, "failures", 5)
	if len(top) != 1 || top[0].Failures != 2 {
		t.Fatalf("top %+v", top)
	}
	// cascade delete
	_ = s.Jobs.Delete(ctx, j.ID)
	if _, total, _ := s.Runs.List(ctx, store.RunFilter{}); total != 0 {
		t.Fatalf("cascade failed, %d runs left", total)
	}
}

func TestSessionsAuditSettings(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	if _, err := s.Sessions.Create(ctx, "h1", -time.Minute, "1.1.1.1", "ua", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Sessions.Create(ctx, "h2", time.Hour, "1.1.1.1", "ua", ""); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.Sessions.DeleteExpired(ctx); n != 1 {
		t.Fatalf("expired %d", n)
	}
	if _, err := s.Sessions.Get(ctx, "h2"); err != nil {
		t.Fatal(err)
	}
	_ = s.Audit.Log(ctx, "job.create", "x", "ip", map[string]any{"a": 1})
	if l, total, _ := s.Audit.List(ctx, "job", "", 1, 10); total != 1 || l[0].Action != "job.create" {
		t.Fatalf("audit %v", l)
	}
	_ = s.Settings.Set(ctx, "k", "v1")
	_ = s.Settings.Set(ctx, "k", "v2")
	if v, _ := s.Settings.Get(ctx, "k"); v != "v2" {
		t.Fatalf("settings %q", v)
	}
}
