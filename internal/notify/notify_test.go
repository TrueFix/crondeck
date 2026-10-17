package notify

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/honk/crondeck/internal/db"
	"github.com/honk/crondeck/internal/store"
)

func TestRunFailedGenericWebhook(t *testing.T) {
	var mu sync.Mutex
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &got)
		mu.Lock()
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	st := store.New(database)
	ctx := context.Background()
	if err := New(st.Settings, "", nil).Save(ctx, Config{
		Enabled: true, WebhookURL: srv.URL,
	}); err != nil {
		t.Fatal(err)
	}
	n := New(st.Settings, "", nil)
	job := &store.Job{ID: "j1", Name: "Ping", Type: store.TypeHTTP}
	run := &store.Run{ID: "r1", Status: store.StatusFailed, Trigger: store.TriggerSchedule, Attempt: 2, Error: "connection refused"}
	n.RunFailed(ctx, job, run)

	mu.Lock()
	defer mu.Unlock()
	if got["event"] != "run.failed" {
		t.Fatalf("event %v", got["event"])
	}
}

func TestMergeIncomingKeepsStoredURL(t *testing.T) {
	stored := Config{WebhookURL: "https://example.com/secret-path"}
	in := Config{Enabled: true, WebhookURL: maskURL(stored.WebhookURL)}
	out := MergeIncoming(in, stored)
	if out.WebhookURL != stored.WebhookURL {
		t.Fatalf("got %q", out.WebhookURL)
	}
}
