package executor

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBodyContentType(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ct := r.Header.Get("Content-Type")
		switch r.URL.Path {
		case "/force-json":
			_, _ = io.ReadAll(r.Body)
			if ct != "application/json" {
				w.WriteHeader(400)
				return
			}
		case "/form":
			if ct != "application/x-www-form-urlencoded" {
				w.WriteHeader(400)
				return
			}
		default:
			w.WriteHeader(404)
			return
		}
		w.WriteHeader(200)
	}))
	defer srv.Close()

	h := &HTTP{}
	t.Run("json content type when body is not valid json", func(t *testing.T) {
		cfg := `{
			"url":"` + srv.URL + `/force-json",
			"method":"POST",
			"body":"{not-valid-json",
			"body_content_type":"json"
		}`
		out := NewOutput(4096, nil)
		res := h.Run(context.Background(), job("http", cfg), out)
		if !res.OK {
			t.Fatalf("expected ok: %+v %s", res, out.String())
		}
	})

	t.Run("form body", func(t *testing.T) {
		cfg := `{
			"url":"` + srv.URL + `/form",
			"method":"POST",
			"body":"grant_type=client_credentials&client_id=x",
			"body_content_type":"form"
		}`
		res := h.Run(context.Background(), job("http", cfg), NewOutput(4096, nil))
		if !res.OK {
			t.Fatalf("expected ok: %+v", res)
		}
	})
}

func TestValidateBodyContentType(t *testing.T) {
	if err := validateBodyContentType("json"); err != nil {
		t.Fatal(err)
	}
	if err := validateBodyContentType("nope"); err == nil {
		t.Fatal("expected error")
	}
}
