package store_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/honk/crondeck/internal/store"
)

func TestFullBackupRestore(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	j := &store.Job{Name: "backup-test", Type: "http", Schedule: "@daily", Timezone: "UTC", Enabled: true,
		Config: json.RawMessage(`{"url":"https://example.com","headers":{"Authorization":"secret"}}`), ConcurrencyPolicy: "forbid", TimeoutSec: 30}
	if err := s.Jobs.Create(ctx, j); err != nil {
		t.Fatal(err)
	}
	r := &store.Run{JobID: j.ID, Status: "success", Trigger: "manual", Output: "important run output"}
	if err := s.Runs.Create(ctx, r); err != nil {
		t.Fatal(err)
	}
	inFlight := &store.Run{JobID: j.ID, Status: "running", Trigger: "schedule"}
	if err := s.Runs.Create(ctx, inFlight); err != nil {
		t.Fatal(err)
	}
	if err := s.Settings.Set(ctx, "retention", "90"); err != nil {
		t.Fatal(err)
	}
	if err := s.Audit.Log(ctx, "job.create", j.ID, "127.0.0.1", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Sessions.Create(ctx, "hash", time.Hour, "ip", "ua", ""); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "snapshot.db")
	if err := s.BackupTo(ctx, path); err != nil {
		t.Fatal(err)
	}
	if err := s.Jobs.Delete(ctx, j.ID); err != nil {
		t.Fatal(err)
	}
	_ = s.Settings.Set(ctx, "retention", "7")
	if err := s.RestoreFrom(ctx, path); err != nil {
		t.Fatal(err)
	}
	got, err := s.Jobs.Get(ctx, j.ID)
	if err != nil || string(got.Config) != string(j.Config) {
		t.Fatalf("job/secret not restored: %+v %v", got, err)
	}
	gotRun, err := s.Runs.Get(ctx, r.ID)
	if err != nil || gotRun.Output != "important run output" {
		t.Fatalf("output not restored: %+v %v", gotRun, err)
	}
	gotRun, err = s.Runs.Get(ctx, inFlight.ID)
	if err != nil || gotRun.Status != "failed" {
		t.Fatalf("in-flight run not normalized: %+v %v", gotRun, err)
	}
	if v, _ := s.Settings.Get(ctx, "retention"); v != "90" {
		t.Fatal("settings not restored")
	}
	if _, n, _ := s.Audit.List(ctx, "", "", 1, 10); n != 1 {
		t.Fatal("audit not restored")
	}
	if n, _ := s.Sessions.Count(ctx); n != 0 {
		t.Fatal("sessions must be revoked")
	}
}

func TestInvalidBackupDoesNotChangeLiveData(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	_ = s.Settings.Set(ctx, "keep", "original")
	path := filepath.Join(t.TempDir(), "bad.db")
	if err := os.WriteFile(path, []byte("not sqlite"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.RestoreFrom(ctx, path); err == nil {
		t.Fatal("invalid file accepted")
	}
	_ = os.Remove(path)
	if err := s.BackupTo(ctx, path); err != nil {
		t.Fatal(err)
	}
	// The schema matches but this row violates the destination CHECK constraint.
	bad, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = bad.Exec(`PRAGMA ignore_check_constraints=ON; INSERT INTO jobs(id,name,type,schedule,timezone,config,concurrency_policy,created_at,updated_at) VALUES('bad','bad','unsupported','@daily','UTC','{}','forbid',0,0)`)
	if err != nil {
		t.Fatal(err)
	}
	bad.Close()
	if err := s.RestoreFrom(ctx, path); err == nil {
		t.Fatal("invalid data accepted")
	}
	if v, _ := s.Settings.Get(ctx, "keep"); v != "original" {
		t.Fatal("failed restore changed live data")
	}
}
