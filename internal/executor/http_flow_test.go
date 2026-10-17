package executor

import (
	"net/http"
	"testing"
)

func TestLookupExtractValue(t *testing.T) {
	body := []byte(`{"id":"42","nested":{"k":"v"}}`)
	h := http.Header{}
	h.Set("X-Csrf-Token", "abc123")
	h.Add("Set-Cookie", "a=1")

	cases := []struct {
		path string
		want string
	}{
		{"body.data", `{"id":"42","nested":{"k":"v"}}`},
		{"body.json.id", "42"},
		{"body.json.nested.k", "v"},
		{"headers.x-csrf-token", "abc123"},
		{"headers.X-Csrf-Token", "abc123"},
		{"id", "42"},
		{"nested.k", "v"},
	}
	for _, c := range cases {
		got, err := lookupExtractValue(body, h, c.path)
		if err != nil {
			t.Fatalf("path %q: %v", c.path, err)
		}
		if got != c.want {
			t.Fatalf("path %q: got %q want %q", c.path, got, c.want)
		}
	}
}

func TestApplyExtractOverridesVar(t *testing.T) {
	vars := map[string]string{"name": "old"}
	body := []byte(`{"name":"new"}`)
	if err := applyExtract(body, nil, map[string]string{"name": "body.json.name"}, nil, vars); err != nil {
		t.Fatal(err)
	}
	if vars["name"] != "new" {
		t.Fatalf("got %q", vars["name"])
	}
}

func TestApplyExtractMissingPolicy(t *testing.T) {
	body := []byte(`{"name":"new"}`)

	// Default (nil policy) fails when the path is missing.
	if err := applyExtract(body, nil, map[string]string{"id": "body.json.id"}, nil, map[string]string{}); err == nil {
		t.Fatal("expected error for missing path with default policy")
	}

	// "empty" sets the variable to "".
	vars := map[string]string{}
	if err := applyExtract(body, nil, map[string]string{"id": "body.json.id"}, map[string]string{"id": "empty"}, vars); err != nil {
		t.Fatalf("empty policy: unexpected error %v", err)
	}
	if v, ok := vars["id"]; !ok || v != "" {
		t.Fatalf("empty policy: got %q, present=%v", v, ok)
	}

	// "null" sets the variable to the literal "null".
	vars = map[string]string{}
	if err := applyExtract(body, nil, map[string]string{"id": "body.json.id"}, map[string]string{"id": "null"}, vars); err != nil {
		t.Fatalf("null policy: unexpected error %v", err)
	}
	if vars["id"] != "null" {
		t.Fatalf("null policy: got %q", vars["id"])
	}
}
