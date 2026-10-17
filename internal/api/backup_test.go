package api_test

import (
	"bytes"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/honk/crondeck/internal/auth"
)

func TestBackupEndpoints(t *testing.T) {
	c := setup(t)
	if r, _ := c.do("GET", "/api/backup", nil); r.StatusCode != 401 {
		t.Fatal("backup requires auth")
	}
	c.do("POST", "/api/auth/login", map[string]string{"key": key})
	_, job := c.do("POST", "/api/jobs", map[string]any{"name": "preserved", "type": "shell", "schedule": "@daily", "enabled": false, "config": map[string]string{"command": "echo backup"}})
	resp, err := c.c.Get(c.url + "/api/backup")
	if err != nil {
		t.Fatal(err)
	}
	b, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil || resp.StatusCode != 200 || !bytes.HasPrefix(b, []byte("SQLite format 3")) {
		t.Fatalf("bad backup: %d %v", resp.StatusCode, err)
	}

	restore := func(data []byte, csrf bool) int {
		req, _ := http.NewRequest("POST", c.url+"/api/backup/restore", bytes.NewReader(data))
		if csrf {
			req.Header.Set(auth.CSRFHeader, auth.CSRFValue)
		}
		res, err := c.c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		if res.StatusCode == 500 {
			t.Fatalf("restore 500: %s", body)
		}
		return res.StatusCode
	}
	if code := restore(b, false); code != 403 {
		t.Fatalf("csrf: %d", code)
	}
	if code := restore([]byte("junk"), true); code != 422 {
		t.Fatalf("invalid: %d", code)
	}
	_, slow := c.do("POST", "/api/jobs", map[string]any{"name": "busy", "type": "shell", "schedule": "@daily", "enabled": false, "config": map[string]string{"command": "sleep 10"}})
	_, slowRun := c.do("POST", "/api/jobs/"+slow["id"].(string)+"/run", nil)
	if code := restore(b, true); code != 409 {
		t.Fatalf("restore while running: %d", code)
	}
	c.do("POST", "/api/runs/"+slowRun["id"].(string)+"/cancel", nil)
	for i := 0; i < 100; i++ {
		_, state := c.do("GET", "/api/runs/"+slowRun["id"].(string), nil)
		if state["status"] == "cancelled" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	c.do("DELETE", "/api/jobs/"+slow["id"].(string), nil)
	// Pending/running jobs must prevent restore, with the current DB left alone.
	_, run := c.do("POST", "/api/jobs/"+job["id"].(string)+"/run", nil)
	for i := 0; i < 100; i++ {
		_, r := c.do("GET", "/api/runs/"+run["id"].(string), nil)
		if r["status"] == "success" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	c.do("DELETE", "/api/jobs/"+job["id"].(string), nil)
	if code := restore(b, true); code != 200 {
		t.Fatalf("restore: %d", code)
	}
	if r, _ := c.do("GET", "/api/jobs", nil); r.StatusCode != 401 {
		t.Fatal("restore must revoke sessions")
	}
	c.do("POST", "/api/auth/login", map[string]string{"key": key})
	if r, body := c.do("GET", "/api/jobs/"+job["id"].(string), nil); r.StatusCode != 200 || body["job"].(map[string]any)["name"] != "preserved" {
		t.Fatal("restored job missing")
	}
}
