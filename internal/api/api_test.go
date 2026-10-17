package api_test

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/honk/crondeck/internal/api"
	"github.com/honk/crondeck/internal/auth"
	"github.com/honk/crondeck/internal/config"
	"github.com/honk/crondeck/internal/db"
	"github.com/honk/crondeck/internal/events"
	"github.com/honk/crondeck/internal/executor"
	"github.com/honk/crondeck/internal/metrics"
	"github.com/honk/crondeck/internal/notify"
	"github.com/honk/crondeck/internal/runner"
	"github.com/honk/crondeck/internal/scheduler"
	"github.com/honk/crondeck/internal/store"
)

const key = "test-admin-key-test-admin-key-1234"

type client struct {
	t   *testing.T
	url string
	c   *http.Client
}

func (c *client) do(method, path string, body any) (*http.Response, map[string]any) {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = strings.NewReader(string(b))
	}
	req, _ := http.NewRequest(method, c.url+path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(auth.CSRFHeader, auth.CSRFValue)
	resp, err := c.c.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	if m == nil {
		m = map[string]any{"_raw": string(raw)}
	}
	return resp, m
}

func (c *client) doBearer(method, path, token string, body any) (*http.Response, map[string]any) {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = strings.NewReader(string(b))
	}
	req, _ := http.NewRequest(method, c.url+path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := c.c.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	if m == nil {
		m = map[string]any{"_raw": string(raw)}
	}
	return resp, m
}

func setup(t *testing.T) *client {
	d, err := db.Open(filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatal(err)
	}
	st := store.New(d)
	hub := events.NewHub()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := &config.Config{AdminKey: key, Env: "development", DefaultTZ: "UTC", MaxConcurrentRuns: 4,
		MaxOutputBytes: 8192, AllowShell: true, SessionTTL: time.Hour, RunRetentionDays: 30}
	reg := executor.DefaultRegistry()
	met := metrics.NewCollector()
	notifySvc := notify.New(st.Settings, "", log)
	rn := runner.New(st, hub, reg, runner.Options{MaxConcurrent: 4, MaxOutputBytes: 8192, AllowShell: true, Metrics: met, Notify: notifySvc}, log)
	sc := scheduler.New(st, rn, hub, log)
	sc.Start()
	cfg.MetricsEnabled = true
	cfg.AllowSQL = true
	srv := &api.Server{Cfg: cfg, Store: st, Auth: auth.New(key, "s", time.Hour, false, st.Sessions, st.Tokens, st.Users), Runner: rn,
		Sched: sc, Hub: hub, Reg: reg, Log: log, Start: time.Now(), Metrics: met, Notify: notifySvc,
		Static: fstest.MapFS{"index.html": {Data: []byte("home")}, "jobs/index.html": {Data: []byte("jobs")},
			"404.html": {Data: []byte("nf")}}}
	ts := httptest.NewServer(srv.Router())
	t.Cleanup(func() {
		ts.Close()
		sc.Stop()
		ctx, c := context.WithTimeout(context.Background(), 2*time.Second)
		defer c()
		rn.Stop(ctx)
		d.Close()
	})
	jar, _ := cookiejar.New(nil)
	return &client{t: t, url: ts.URL, c: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}}
}

func TestEndToEnd(t *testing.T) {
	c := setup(t)

	if r, _ := c.do("GET", "/api/jobs", nil); r.StatusCode != 401 {
		t.Fatalf("unauth jobs: %d", r.StatusCode)
	}
	if r, _ := c.do("POST", "/api/auth/login", map[string]string{"key": "nope"}); r.StatusCode != 401 {
		t.Fatalf("bad key: %d", r.StatusCode)
	}
	if r, _ := c.do("POST", "/api/auth/login", map[string]string{"key": key}); r.StatusCode != 200 {
		t.Fatalf("login: %d", r.StatusCode)
	}
	if r, _ := c.do("GET", "/api/auth/me", nil); r.StatusCode != 200 {
		t.Fatalf("me: %d", r.StatusCode)
	}

	// validation
	r, body := c.do("POST", "/api/jobs", map[string]any{"name": "", "type": "http", "schedule": "bad", "config": map[string]any{}})
	if r.StatusCode != 422 {
		t.Fatalf("validation: %d %v", r.StatusCode, body)
	}
	fields := body["error"].(map[string]any)["fields"].(map[string]any)
	for _, f := range []string{"name", "schedule", "config"} {
		if _, ok := fields[f]; !ok {
			t.Errorf("missing field error %q: %v", f, fields)
		}
	}

	// create shell job with a secret env var
	r, body = c.do("POST", "/api/jobs", map[string]any{"name": "echo", "type": "shell", "schedule": "0 0 * * *",
		"config": map[string]any{"command": "echo $GREETING $API_TOKEN", "env": map[string]string{"GREETING": "hi", "API_TOKEN": "s3cr3t"}},
		"tags":   []string{"ops"}})
	if r.StatusCode != 201 {
		t.Fatalf("create: %d %v", r.StatusCode, body)
	}
	id := body["id"].(string)
	env := body["config"].(map[string]any)["env"].(map[string]any)
	if env["API_TOKEN"] != api.Mask || env["GREETING"] != "hi" {
		t.Fatalf("redaction: %v", env)
	}
	if body["next_run_at"] == nil {
		t.Fatal("next_run_at not set")
	}

	// update keeping the masked secret
	r, body = c.do("PUT", "/api/jobs/"+id, map[string]any{"name": "echo2", "type": "shell", "schedule": "0 0 * * *",
		"config": map[string]any{"command": "echo $GREETING $API_TOKEN", "env": map[string]string{"GREETING": "hi", "API_TOKEN": api.Mask}},
		"tags":   []string{"ops"}})
	if r.StatusCode != 200 || body["name"] != "echo2" {
		t.Fatalf("update: %d %v", r.StatusCode, body)
	}

	// run and wait for completion
	r, body = c.do("POST", "/api/jobs/"+id+"/run", nil)
	if r.StatusCode != 202 {
		t.Fatalf("run: %d", r.StatusCode)
	}
	runID := body["id"].(string)
	var run map[string]any
	for i := 0; i < 100; i++ {
		_, run = c.do("GET", "/api/runs/"+runID, nil)
		if run["status"] == "success" {
			break
		}
		time.Sleep(30 * time.Millisecond)
	}
	if run["status"] != "success" || !strings.Contains(run["output"].(string), "hi s3cr3t") {
		t.Fatalf("run result: %v", run)
	}

	// listing, filters, detail
	if _, b := c.do("GET", "/api/jobs?tag=ops&q=echo", nil); b["total"].(float64) != 1 {
		t.Fatalf("list: %v", b)
	}
	if _, b := c.do("GET", "/api/jobs/"+id, nil); len(b["next_runs"].([]any)) != 5 || len(b["recent_runs"].([]any)) != 1 {
		t.Fatalf("detail: %v", b)
	}
	if _, b := c.do("GET", "/api/jobs/"+id+"/runs", nil); b["total"].(float64) != 1 {
		t.Fatalf("job runs: %v", b)
	}
	// toggle, duplicate
	if _, b := c.do("POST", "/api/jobs/"+id+"/toggle", nil); b["enabled"] != false || b["next_run_at"] != nil {
		t.Fatalf("toggle: %v", b)
	}
	r, b := c.do("POST", "/api/jobs/"+id+"/duplicate", nil)
	if r.StatusCode != 201 || b["name"] != "echo2 (copy)" {
		t.Fatalf("dup: %d %v", r.StatusCode, b)
	}

	// cron preview
	if _, b := c.do("POST", "/api/cron/preview", map[string]any{"expr": "*/5 * * * *", "timezone": "Asia/Kolkata"}); b["valid"] != true {
		t.Fatalf("preview: %v", b)
	}
	if _, b := c.do("POST", "/api/cron/preview", map[string]any{"expr": "61 * * * *"}); b["valid"] != false {
		t.Fatalf("preview invalid: %v", b)
	}

	// stats
	if _, b := c.do("GET", "/api/stats/overview", nil); b["total_jobs"].(float64) != 2 || b["runs_24h"].(float64) != 1 {
		t.Fatalf("overview: %v", b)
	}
	for _, p := range []string{"/api/stats/timeline?range=7d", "/api/stats/heatmap", "/api/stats/top", "/api/upcoming", "/api/audit", "/api/settings", "/api/meta", "/api/tags", "/api/export"} {
		if r, _ := c.do("GET", p, nil); r.StatusCode != 200 {
			t.Errorf("%s: %d", p, r.StatusCode)
		}
	}

	// export -> import roundtrip
	_, exp := c.do("GET", "/api/export", nil)
	if r, b := c.do("POST", "/api/import", exp); r.StatusCode != 200 || b["created"].(float64) != 2 {
		t.Fatalf("import: %d %v", r.StatusCode, b)
	}

	// bulk delete everything
	_, all := c.do("GET", "/api/jobs?per_page=100", nil)
	ids := []string{}
	for _, it := range all["items"].([]any) {
		ids = append(ids, it.(map[string]any)["id"].(string))
	}
	if _, b := c.do("POST", "/api/jobs/bulk", map[string]any{"action": "delete", "ids": ids}); b["affected"].(float64) != 4 {
		t.Fatalf("bulk: %v", b)
	}

	// CSRF enforced on mutation
	req, _ := http.NewRequest("POST", c.url+"/api/jobs", strings.NewReader("{}"))
	resp, _ := c.c.Do(req)
	if resp.StatusCode != 403 {
		t.Fatalf("csrf: %d", resp.StatusCode)
	}
	resp.Body.Close()

	// logout
	c.do("POST", "/api/auth/logout", nil)
	if r, _ := c.do("GET", "/api/jobs", nil); r.StatusCode != 401 {
		t.Fatalf("after logout: %d", r.StatusCode)
	}
}

func TestSSEAndStatic(t *testing.T) {
	c := setup(t)
	c.do("POST", "/api/auth/login", map[string]string{"key": key})
	_, job := c.do("POST", "/api/jobs", map[string]any{"name": "sse", "type": "shell", "schedule": "@daily",
		"config": map[string]any{"command": "echo streaming"}})

	req, _ := http.NewRequest("GET", c.url+"/api/events?logs=1", nil)
	resp, err := c.c.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("sse: %v", err)
	}
	defer resp.Body.Close()
	got := make(chan string, 64)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			got <- sc.Text()
		}
	}()
	time.Sleep(100 * time.Millisecond)
	c.do("POST", "/api/jobs/"+job["id"].(string)+"/run", nil)
	seen := map[string]bool{}
	timeout := time.After(5 * time.Second)
	for !seen["event: run.finished"] {
		select {
		case l := <-got:
			seen[l] = true
		case <-timeout:
			t.Fatalf("no run.finished event; saw %v", seen)
		}
	}
	if !seen["event: run.started"] || !seen["event: run.log"] {
		t.Fatalf("missing events: %v", seen)
	}

	for path, want := range map[string]int{"/": 200, "/jobs/": 200, "/jobs": 301, "/nope": 404} {
		r, b := c.do("GET", path, nil)
		if r.StatusCode != want {
			t.Errorf("%s: %d %v", path, r.StatusCode, b)
		}
	}
}

func TestAPITokenOperatorRun(t *testing.T) {
	c := setup(t)
	if r, _ := c.do("POST", "/api/auth/login", map[string]string{"key": key}); r.StatusCode != 200 {
		t.Fatal("login")
	}
	_, tok := c.do("POST", "/api/tokens", map[string]any{"name": "ci", "role": "operator"})
	plain, ok := tok["token"].(string)
	if !ok || plain == "" {
		t.Fatalf("create token: %v", tok)
	}
	r, body := c.do("POST", "/api/jobs", map[string]any{
		"name": "ping", "type": "http", "schedule": "0 0 * * *",
		"config": map[string]any{"url": "http://127.0.0.1:1", "method": "GET", "expected_status": []int{200}},
	})
	if r.StatusCode != 201 {
		t.Fatalf("create job: %d %v", r.StatusCode, body)
	}
	id := body["id"].(string)
	if r, _ = c.doBearer("POST", "/api/jobs/"+id+"/run", plain, nil); r.StatusCode != 202 {
		t.Fatalf("bearer run: %d", r.StatusCode)
	}
	if r, _ = c.doBearer("GET", "/api/tokens", plain, nil); r.StatusCode != 403 {
		t.Fatalf("operator tokens: want 403 got %d", r.StatusCode)
	}
	if r, _ = c.doBearer("GET", "/api/settings", plain, nil); r.StatusCode != 403 {
		t.Fatalf("operator settings: want 403 got %d", r.StatusCode)
	}
}

func TestRateLimitHTTP(t *testing.T) {
	c := setup(t)
	for i := 0; i < 5; i++ {
		c.do("POST", "/api/auth/login", map[string]string{"key": "x"})
	}
	r, _ := c.do("POST", "/api/auth/login", map[string]string{"key": key})
	if r.StatusCode != 429 || r.Header.Get("Retry-After") == "" {
		t.Fatalf("expected 429 with Retry-After, got %d", r.StatusCode)
	}
}
