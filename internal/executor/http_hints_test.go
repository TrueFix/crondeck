package executor

import (
	"net/http"
	"testing"
)

func TestCollectExtractHints(t *testing.T) {
	body := []byte(`{"access_token":"tok","nested":{"id":7}}`)
	h := http.Header{}
	h.Set("X-Csrf-Token", "csrf-val")
	hints := CollectExtractHints(body, h)
	paths := map[string]bool{}
	for _, hint := range hints {
		paths[hint.Path] = true
	}
	for _, want := range []string{"body.data", "body.json.access_token", "body.json.nested.id", "headers.X-Csrf-Token"} {
		if !paths[want] {
			t.Fatalf("missing hint %q in %v", want, hints)
		}
	}
}
