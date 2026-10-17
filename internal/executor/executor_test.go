package executor

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/honk/crondeck/internal/store"
)

func job(typ, cfg string) *store.Job {
	return &store.Job{ID: "j", Type: typ, Config: json.RawMessage(cfg)}
}

func TestHTTPExecutor(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		if r.Header.Get("X-Test") != "1" || r.Method != "POST" || string(b) != `{"a":1}` {
			w.WriteHeader(400)
			return
		}
		if r.URL.Path == "/fail" {
			w.WriteHeader(503)
			return
		}
		w.Write([]byte("pong"))
	}))
	defer srv.Close()
	h := &HTTP{}
	cfg := `{"url":"` + srv.URL + `","method":"post","headers":{"X-Test":"1"},"body":"{\"a\":1}"}`
	if err := h.Validate(json.RawMessage(cfg)); err != nil {
		t.Fatal(err)
	}
	out := NewOutput(4096, nil)
	res := h.Run(context.Background(), job("http", cfg), out)
	if !res.OK || *res.HTTPStatus != 200 || !strings.Contains(out.String(), "pong") {
		t.Fatalf("ok case: %+v %s", res, out.String())
	}
	cfg = `{"url":"` + srv.URL + `/fail","method":"POST","headers":{"X-Test":"1"},"body":"{\"a\":1}"}`
	res = h.Run(context.Background(), job("http", cfg), NewOutput(4096, nil))
	if res.OK || *res.HTTPStatus != 503 {
		t.Fatalf("fail case: %+v", res)
	}
	cfg = `{"url":"` + srv.URL + `/fail","method":"POST","headers":{"X-Test":"1"},"body":"{\"a\":1}","expected_status":[503]}`
	if res = h.Run(context.Background(), job("http", cfg), NewOutput(4096, nil)); !res.OK {
		t.Fatalf("expected status case: %+v", res)
	}
	if err := h.Validate(json.RawMessage(`{"url":"ftp://x"}`)); err == nil {
		t.Fatal("ftp accepted")
	}
}

func TestHTTPMultiStepFlow(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"access_token":"secret-abc","expires_in":3600}`))
		case "/use":
			b, _ := io.ReadAll(r.Body)
			if r.Header.Get("Authorization") != "Bearer secret-abc" {
				w.WriteHeader(401)
				return
			}
			if !strings.Contains(string(b), "secret-abc") {
				w.WriteHeader(400)
				return
			}
			w.WriteHeader(201)
			w.Write([]byte(`{"ok":true}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()

	cfg := `{
		"steps": [
			{
				"name": "Get token",
				"url": "` + srv.URL + `/token",
				"method": "POST",
				"expected_status": [200],
				"extract": { "token": "body.json.access_token" }
			},
			{
				"name": "Call API",
				"url": "` + srv.URL + `/use",
				"method": "POST",
				"headers": { "Authorization": "Bearer {{token}}" },
				"body": "{\"token\":\"{{token}}\"}",
				"expected_status": [201]
			}
		]
	}`
	h := &HTTP{}
	if err := h.Validate(json.RawMessage(cfg)); err != nil {
		t.Fatal(err)
	}
	out := NewOutput(8192, nil)
	res := h.Run(context.Background(), job("http", cfg), out)
	if !res.OK || res.HTTPStatus == nil || *res.HTTPStatus != 201 {
		t.Fatalf("flow: %+v\n%s", res, out.String())
	}
}

func TestShellExecutor(t *testing.T) {
	s := &Shell{}
	out := NewOutput(4096, nil)
	res := s.Run(context.Background(), job("shell", `{"command":"echo hello $FOO; echo err 1>&2","env":{"FOO":"bar"}}`), out)
	if !res.OK || *res.ExitCode != 0 || !strings.Contains(out.String(), "hello bar") || !strings.Contains(out.String(), "err") {
		t.Fatalf("%+v %q", res, out.String())
	}
	res = s.Run(context.Background(), job("shell", `{"command":"exit 3"}`), NewOutput(4096, nil))
	if res.OK || *res.ExitCode != 3 {
		t.Fatalf("exit code: %+v", res)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	start := time.Now()
	res = s.Run(ctx, job("shell", `{"command":"sleep 5 & sleep 5; wait"}`), NewOutput(4096, nil))
	if res.OK || time.Since(start) > 3*time.Second {
		t.Fatalf("timeout not enforced: %+v after %v", res, time.Since(start))
	}
	if err := s.Validate(json.RawMessage(`{"command":"  "}`)); err == nil {
		t.Fatal("empty command accepted")
	}
}

func TestScriptExecutor(t *testing.T) {
	s := &Script{}
	out := NewOutput(4096, nil)
	res := s.Run(context.Background(), job("script", `{"interpreter":"sh","source":"echo from-script"}`), out)
	if !res.OK || !strings.Contains(out.String(), "from-script") {
		t.Fatalf("%+v %q", res, out.String())
	}
	if err := s.Validate(json.RawMessage(`{"interpreter":"evil","source":"x"}`)); err == nil {
		t.Fatal("bad interpreter accepted")
	}
}

func TestOutputTruncation(t *testing.T) {
	var streamed int
	o := NewOutput(1024, func(c string) { streamed += len(c) })
	for i := 0; i < 100; i++ {
		o.Write([]byte(strings.Repeat("x", 99) + "\n"))
	}
	s := o.String()
	if !strings.Contains(s, "truncated") || len(s) > 1200 || streamed != 10000 {
		t.Fatalf("len=%d streamed=%d", len(s), streamed)
	}
}
