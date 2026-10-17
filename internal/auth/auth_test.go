package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/honk/crondeck/internal/auth"
	"github.com/honk/crondeck/internal/db"
	"github.com/honk/crondeck/internal/store"
)

const key = "0123456789abcdef0123456789abcdef"

func setup(t *testing.T, ttl time.Duration) *auth.Service {
	d, err := db.Open(filepath.Join(t.TempDir(), "a.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	st := store.New(d)
	return auth.New(key, "secret", ttl, false, st.Sessions, st.Tokens, st.Users)
}

func TestLoginFlow(t *testing.T) {
	s := setup(t, time.Hour)
	ctx := context.Background()

	if _, _, err := s.Login(ctx, "wrong", "1.2.3.4", "ua"); err != auth.ErrInvalidKey {
		t.Fatalf("want invalid, got %v", err)
	}
	c, _, err := s.Login(ctx, key, "1.2.3.4", "ua")
	if err != nil || c == nil || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode {
		t.Fatalf("login: %v %+v", err, c)
	}

	ok := s.Middleware(func(w http.ResponseWriter, code int, _ string) { w.WriteHeader(code) })(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))

	// no cookie -> 401
	rec := httptest.NewRecorder()
	ok.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != 401 {
		t.Fatalf("no cookie: %d", rec.Code)
	}
	// cookie -> 200
	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(c)
	rec = httptest.NewRecorder()
	ok.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("cookie: %d", rec.Code)
	}
	// POST without CSRF header -> 403
	req = httptest.NewRequest("POST", "/", nil)
	req.AddCookie(c)
	rec = httptest.NewRecorder()
	ok.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatalf("csrf: %d", rec.Code)
	}
	req.Header.Set(auth.CSRFHeader, auth.CSRFValue)
	rec = httptest.NewRecorder()
	ok.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("csrf ok: %d", rec.Code)
	}
	// logout invalidates
	s.Logout(ctx, req)
	rec = httptest.NewRecorder()
	ok.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("after logout: %d", rec.Code)
	}
}

func TestRateLimit(t *testing.T) {
	s := setup(t, time.Hour)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		if _, _, err := s.Login(ctx, "bad", "9.9.9.9", ""); err != auth.ErrInvalidKey {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	_, wait, err := s.Login(ctx, key, "9.9.9.9", "")
	if err != auth.ErrRateLimited || wait <= 0 {
		t.Fatalf("6th attempt should be limited even with right key: %v %v", err, wait)
	}
	// other IPs unaffected
	if _, _, err := s.Login(ctx, key, "8.8.8.8", ""); err != nil {
		t.Fatalf("other ip: %v", err)
	}
}

func TestExpiredSession(t *testing.T) {
	s := setup(t, -time.Second)
	c, _, err := s.Login(context.Background(), key, "1.1.1.1", "")
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(&http.Cookie{Name: c.Name, Value: c.Value})
	if s.Session(req) != nil {
		t.Fatal("expired session accepted")
	}
}
