package runner

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/honk/crondeck/internal/db"
	"github.com/honk/crondeck/internal/deps"
	"github.com/honk/crondeck/internal/events"
	"github.com/honk/crondeck/internal/executor"
	"github.com/honk/crondeck/internal/store"
)

func TestChainTriggerOnSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	database, err := db.Open(filepath.Join(t.TempDir(), "chain.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	st := store.New(database)
	ctx := context.Background()
	cfg, _ := jsonHTTPConfig(srv.URL)

	up := &store.Job{
		Name: "upstream", Type: store.TypeHTTP, Schedule: "@every 1h", Timezone: "UTC",
		Config: cfg, Enabled: true, TimeoutSec: 30, ConcurrencyPolicy: store.PolicyForbid,
	}
	if err := st.Jobs.Create(ctx, up); err != nil {
		t.Fatal(err)
	}
	down := &store.Job{
		Name: "downstream", Type: store.TypeHTTP, Schedule: deps.ScheduleDependencyOnly, Timezone: "UTC",
		Config: cfg, Enabled: true, TimeoutSec: 30, ConcurrencyPolicy: store.PolicyForbid,
		DependsOn: []string{up.ID},
	}
	if err := st.Jobs.Create(ctx, down); err != nil {
		t.Fatal(err)
	}

	hub := events.NewHub()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	r := New(st, hub, executor.DefaultRegistry(), Options{MaxConcurrent: 2, MaxOutputBytes: 4096, AllowShell: false}, log)

	if _, err := r.Trigger(up, store.TriggerManual); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		runs, _, _ := st.Runs.List(ctx, store.RunFilter{JobID: down.ID, PerPage: 5})
		if len(runs) > 0 && runs[0].Trigger == store.TriggerChain && runs[0].Status == store.StatusSuccess {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("downstream chain run not observed")
}

func jsonHTTPConfig(url string) ([]byte, error) {
	return []byte(`{"url":"` + url + `","method":"GET","expected_status":[200]}`), nil
}
