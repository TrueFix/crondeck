package api_test

import (
	"strings"
	"testing"
	"time"
)

func TestLiveOutputAndScopedJobRuns(t *testing.T) {
	c := setup(t)
	c.do("POST", "/api/auth/login", map[string]string{"key": key})
	_, a := c.do("POST", "/api/jobs", map[string]any{"name": "live", "type": "shell", "schedule": "@daily", "config": map[string]string{"command": "echo EARLY; sleep 10"}})
	_, b := c.do("POST", "/api/jobs", map[string]any{"name": "other", "type": "shell", "schedule": "@daily", "config": map[string]string{"command": "true"}})
	id := a["id"].(string)
	_, run := c.do("POST", "/api/jobs/"+id+"/run", nil)
	runID := run["id"].(string)
	found := false
	for i := 0; i < 100; i++ {
		_, state := c.do("GET", "/api/runs/"+runID, nil)
		if output, ok := state["output"].(string); ok && strings.Contains(output, "EARLY") {
			if state["status"] != "running" {
				t.Fatal("expected live snapshot before finish")
			}
			found = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !found {
		t.Fatal("opening mid-run loses output")
	}
	_, scoped := c.do("GET", "/api/jobs/"+b["id"].(string)+"/runs?job_id="+id, nil)
	if scoped["total"].(float64) != 0 {
		t.Fatal("query override escaped job scope")
	}
	c.do("POST", "/api/runs/"+runID+"/cancel", nil)
	if r, _ := c.do("GET", "/api/runs?from=garbage", nil); r.StatusCode != 422 {
		t.Fatal("invalid filter ignored")
	}
}
