package api_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestSearchIsBoundedAndExcludesConfiguration(t *testing.T) {
	c := setup(t)
	if r, _ := c.do("GET", "/api/search/jobs?q=test", nil); r.StatusCode != 401 {
		t.Fatal("search must require auth")
	}
	c.do("POST", "/api/auth/login", map[string]string{"key": key})
	for i := 0; i < 16; i++ {
		c.do("POST", "/api/jobs", map[string]any{"name": fmt.Sprintf("Find %02d", i), "type": "http", "schedule": "@daily", "enabled": false, "config": map[string]string{"url": "https://example.com", "body": "private-configuration-body"}})
	}
	_, result := c.do("GET", "/api/search/jobs?q=Find", nil)
	raw := result["_raw"].(string)
	var jobs []map[string]any
	if err := json.Unmarshal([]byte(raw), &jobs); err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 12 {
		t.Fatalf("expected 12 bounded results, got %d", len(jobs))
	}
	if strings.Contains(raw, "private-configuration-body") || strings.Contains(raw, `"config"`) {
		t.Fatal("search leaked full config")
	}
	_, result = c.do("GET", "/api/search/jobs?q=Find%2015", nil)
	if err := json.Unmarshal([]byte(result["_raw"].(string)), &jobs); err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 || jobs[0]["name"] != "Find 15" {
		t.Fatal("search limited rows before filtering")
	}
	_, result = c.do("GET", "/api/search/jobs?q=%25", nil)
	if result["_raw"].(string) != "[]\n" {
		t.Fatal("wildcards should be literal search text")
	}
}
