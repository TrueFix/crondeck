package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/honk/crondeck/internal/auth"
	"github.com/honk/crondeck/internal/executor"
	"github.com/honk/crondeck/internal/runner"
	"github.com/honk/crondeck/internal/scheduler"
	"github.com/honk/crondeck/internal/store"
)

// ---------------------------------------------------------------- auth

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if !auth.CSRFOK(r) {
		writeError(w, 403, "forbidden", "missing CSRF header", nil)
		return
	}
	var in struct {
		Key      string `json:"key"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	ip := auth.ClientIP(r)
	var cookie *http.Cookie
	var wait time.Duration
	var err error
	if strings.TrimSpace(in.Username) != "" {
		cookie, wait, err = s.Auth.LoginPassword(r.Context(), in.Username, in.Password, ip, r.UserAgent())
	} else {
		cookie, wait, err = s.Auth.Login(r.Context(), in.Key, ip, r.UserAgent())
	}
	switch {
	case errors.Is(err, auth.ErrRateLimited):
		w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
		s.audit_(r, "auth.rate_limited", "", nil)
		writeError(w, 429, "rate_limited", fmt.Sprintf("Too many failed attempts. Try again in %s.", wait.Round(time.Second)), nil)
		return
	case errors.Is(err, auth.ErrInvalidKey):
		s.audit_(r, "auth.login_failed", "", nil)
		writeError(w, 401, "invalid_key", "That admin key is not valid.", nil)
		return
	case errors.Is(err, auth.ErrInvalidPassword):
		s.audit_(r, "auth.login_failed", "", map[string]string{"username": in.Username})
		writeError(w, 401, "invalid_credentials", "Invalid username or password.", nil)
		return
	case err != nil:
		s.internalError(w, err)
		return
	}
	http.SetCookie(w, cookie)
	s.audit_(r, "auth.login", "", map[string]string{"user_agent": r.UserAgent()})
	writeJSON(w, 200, map[string]any{"ok": true, "expires_at": cookie.Expires})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if !auth.CSRFOK(r) {
		writeError(w, 403, "forbidden", "missing CSRF header", nil)
		return
	}
	if s.Auth.Session(r) != nil {
		s.audit_(r, "auth.logout", "", nil)
	}
	http.SetCookie(w, s.Auth.Logout(r.Context(), r))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) logoutAll(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.Sessions.DeleteAll(r.Context()); err != nil {
		s.internalError(w, err)
		return
	}
	s.audit_(r, "auth.logout_all", "", nil)
	http.SetCookie(w, s.Auth.Logout(r.Context(), r))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	if p, ok := s.Auth.Authenticate(r); ok {
		out := map[string]any{"authenticated": true, "role": string(p.Role), "auth_method": string(p.Method)}
		if p.Session != nil {
			out["session"] = p.Session
		}
		if p.TokenID != "" {
			out["token"] = map[string]string{"id": p.TokenID, "name": p.TokenName, "prefix": p.TokenPrefix}
		}
		writeJSON(w, 200, out)
		return
	}
	writeError(w, 401, "unauthorized", "authentication required", nil)
}

func (s *Server) meta(w http.ResponseWriter, r *http.Request) {
	interps := make([]string, 0, len(executor.Interpreters))
	for k := range executor.Interpreters {
		interps = append(interps, k)
	}
	sort.Strings(interps)
	writeJSON(w, 200, map[string]any{
		"version": Version, "allow_shell": s.Cfg.AllowShell,
		"allow_sql": s.Cfg.AllowSQL, "interpreters": interps,
		"default_timezone": s.Cfg.DefaultTZ, "server_time": time.Now().UTC(),
		"uptime_sec": int(time.Since(s.Start).Seconds()), "mask": Mask,
	})
}

// ---------------------------------------------------------------- runs

func (s *Server) listRuns(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	for _, key := range []string{"from", "to"} {
		if q.Get(key) != "" && qTime(r, key) == nil {
			writeError(w, 422, "validation_failed", key+" must be an RFC3339 timestamp", nil)
			return
		}
	}
	f := store.RunFilter{JobID: q.Get("job_id"), Status: q.Get("status"), Trigger: q.Get("trigger"),
		From: qTime(r, "from"), To: qTime(r, "to"), Page: qInt(r, "page", 1), PerPage: qInt(r, "per_page", 50)}
	runs, total, err := s.Store.Runs.List(r.Context(), f)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, 200, page[*store.Run]{Items: runs, Total: total, Page: max(f.Page, 1), PerPage: f.PerPage})
}

func (s *Server) getRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.Store.Runs.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.storeError(w, err)
		return
	}
	if run.Status == store.StatusRunning || run.Status == store.StatusQueued {
		if output, ok := s.Runner.LiveOutput(run.ID); ok {
			run.Output = output
		}
	}
	writeJSON(w, 200, run)
}

func (s *Server) cancelRun(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.Runner.Cancel(id); err != nil {
		if errors.Is(err, runner.ErrNotRunning) {
			writeError(w, 409, "not_running", "this run is not active", nil)
			return
		}
		s.internalError(w, err)
		return
	}
	s.audit_(r, "run.cancel", id, nil)
	w.WriteHeader(http.StatusAccepted)
}

// ---------------------------------------------------------------- cron helpers

func (s *Server) cronPreview(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Expr     string `json:"expr"`
		Timezone string `json:"timezone"`
		Count    int    `json:"count"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Timezone == "" {
		in.Timezone = s.Cfg.DefaultTZ
	}
	if in.Count <= 0 || in.Count > 20 {
		in.Count = 5
	}
	next, err := scheduler.NextN(in.Expr, in.Timezone, time.Now(), in.Count)
	if err != nil {
		writeJSON(w, 200, map[string]any{"valid": false, "error": err.Error(), "next": []time.Time{}})
		return
	}
	writeJSON(w, 200, map[string]any{"valid": true, "error": "", "next": nonNil(next)})
}

func (s *Server) upcoming(w http.ResponseWriter, r *http.Request) {
	hours := qInt(r, "hours", 24)
	if hours < 1 || hours > 24*45 {
		hours = 24
	}
	limit := qInt(r, "per_job", 50)
	if limit < 1 || limit > 500 {
		limit = 50
	}
	now := time.Now()
	from := now
	if t := qTime(r, "from"); t != nil {
		from = *t
	}
	items, err := s.Sched.Upcoming(r.Context(), from, from.Add(time.Duration(hours)*time.Hour), limit)
	if err != nil {
		s.internalError(w, err)
		return
	}
	sort.Slice(items, func(i, j int) bool { return items[i].At.Before(items[j].At) })
	if len(items) > 2000 {
		items = items[:2000]
	}
	writeJSON(w, 200, items)
}

func (s *Server) upcomingDays(w http.ResponseWriter, r *http.Request) {
	days := qInt(r, "days", 42)
	if days < 1 || days > 62 {
		days = 42
	}
	loc, err := time.LoadLocation(r.URL.Query().Get("tz"))
	if err != nil || r.URL.Query().Get("tz") == "" {
		loc = time.UTC
	}
	from := time.Now()
	if t := qTime(r, "from"); t != nil {
		from = *t
	} else if d := r.URL.Query().Get("date"); d != "" {
		if t, err := time.ParseInLocation("2006-01-02", d, loc); err == nil {
			from = t
		}
	}
	out, err := s.Sched.UpcomingDays(r.Context(), from, days, loc, 100_000)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, 200, out)
}

// ---------------------------------------------------------------- stats

func (s *Server) statsOverview(w http.ResponseWriter, r *http.Request) {
	o, err := s.Store.Runs.Overview(r.Context())
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, 200, o)
}

func (s *Server) statsTimeline(w http.ResponseWriter, r *http.Request) {
	span, bucket := 24*time.Hour, time.Hour
	switch r.URL.Query().Get("range") {
	case "1h":
		span, bucket = time.Hour, 5*time.Minute
	case "7d":
		span, bucket = 7*24*time.Hour, 6*time.Hour
	case "30d":
		span, bucket = 30*24*time.Hour, 24*time.Hour
	}
	tl, err := s.Store.Runs.Timeline(r.Context(), span, bucket)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, 200, tl)
}

func (s *Server) statsHeatmap(w http.ResponseWriter, r *http.Request) {
	h, err := s.Store.Runs.Heatmap(r.Context(), 371)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, 200, h)
}

func (s *Server) statsTop(w http.ResponseWriter, r *http.Request) {
	order := r.URL.Query().Get("by")
	if order != "duration" {
		order = "failures"
	}
	t, err := s.Store.Runs.TopJobs(r.Context(), 7*24*time.Hour, order, max(1, min(qInt(r, "limit", 5), 50)))
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, 200, t)
}

// ---------------------------------------------------------------- SSE

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{}) // SSE is long-lived; disable server write timeout
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(200)

	ch, unsub := s.Hub.SubscribeUpdates(r.URL.Query().Get("logs") == "1")
	defer unsub()
	fmt.Fprintf(w, "retry: 3000\nevent: hello\ndata: {\"server_time\":%q}\n\n", time.Now().UTC().Format(time.RFC3339))
	if err := rc.Flush(); err != nil {
		return
	}
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			if s.Auth.Session(r) == nil {
				return
			}
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			_ = rc.Flush()
		case ev, ok := <-ch:
			if !ok {
				return
			}
			b, err := json.Marshal(ev.Data)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, b); err != nil {
				return
			}
			_ = rc.Flush()
			if ev.Type == "system.restored" {
				return
			}
		}
	}
}

// ---------------------------------------------------------------- audit & settings

func (s *Server) audit(w http.ResponseWriter, r *http.Request) {
	p, pp := qInt(r, "page", 1), qInt(r, "per_page", 50)
	items, total, err := s.Store.Audit.List(r.Context(), r.URL.Query().Get("action"), r.URL.Query().Get("target"), p, pp)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, 200, page[store.AuditEntry]{Items: items, Total: total, Page: max(p, 1), PerPage: pp})
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	n, _ := s.Store.Sessions.Count(r.Context())
	tokens, _ := s.Store.Tokens.ActiveCount(r.Context())
	p := auth.PrincipalFrom(r.Context())
	out := map[string]any{
		"run_retention_days":  s.Cfg.RunRetentionDays,
		"max_concurrent_runs": s.Cfg.MaxConcurrentRuns,
		"max_output_bytes":    s.Cfg.MaxOutputBytes,
		"allow_shell":         s.Cfg.AllowShell,
		"default_timezone":    s.Cfg.DefaultTZ,
		"session_ttl_hours":   int(s.Cfg.SessionTTL.Hours()),
		"environment":         s.Cfg.Env,
		"db_path":             s.Cfg.DBPath,
		"active_sessions":     n,
		"active_api_tokens":   tokens,
		"active_runs":         len(s.Runner.ActiveRunIDs()),
		"sse_clients":         s.Hub.Subscribers(),
		"version":             Version,
		"uptime_sec":          int(time.Since(s.Start).Seconds()),
	}
	if p != nil {
		out["role"] = string(p.Role)
		out["auth_method"] = string(p.Method)
		if p.Session != nil {
			out["current_session"] = p.Session
		}
	}
	writeJSON(w, 200, out)
}
