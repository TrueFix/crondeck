// Package api exposes the REST + SSE interface and serves the embedded dashboard.
package api

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/honk/crondeck/internal/auth"
	"github.com/honk/crondeck/internal/config"
	"github.com/honk/crondeck/internal/events"
	"github.com/honk/crondeck/internal/executor"
	"github.com/honk/crondeck/internal/metrics"
	"github.com/honk/crondeck/internal/notify"
	"github.com/honk/crondeck/internal/runner"
	"github.com/honk/crondeck/internal/scheduler"
	"github.com/honk/crondeck/internal/store"
)

const Version = "1.0.0"

type Server struct {
	Cfg         *config.Config
	Store       *store.Store
	Auth        *auth.Service
	Runner      *runner.Runner
	Sched       *scheduler.Scheduler
	Hub         *events.Hub
	Reg         executor.Registry
	Log         *slog.Logger
	Static      fs.FS // built dashboard (may be nil in dev)
	Start       time.Time
	Metrics     *metrics.Collector
	Notify      *notify.Service
	maintenance sync.RWMutex
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	if s.Cfg.TrustProxy {
		r.Use(middleware.RealIP)
	}
	r.Use(middleware.Recoverer)
	r.Use(s.requestLog)
	r.Use(securityHeaders)
	r.Use(middleware.Compress(5, "text/html", "text/css", "text/javascript", "application/javascript", "application/json", "image/svg+xml", "text/plain"))
	if !s.Cfg.IsProd() && s.Cfg.CORSOrigin != "" {
		r.Use(s.cors)
	}

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	if s.Cfg.MetricsEnabled && s.Metrics != nil {
		r.Get("/metrics", s.prometheus)
	}

	r.Route("/api", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				limit := int64(1 << 20)
				if r.URL.Path == "/api/backup/restore" {
					limit = 256 << 20
				}
				if r.URL.Path == "/api/import" {
					limit = 10 << 20
				}
				maxBody(limit)(next).ServeHTTP(w, r)
			})
		})
		r.Post("/auth/login", s.login)
		r.Post("/auth/logout", s.logout)
		r.Get("/auth/me", s.me)

		r.Group(func(r chi.Router) {
			r.Use(s.maintenanceGate)
			r.Use(s.Auth.Middleware(writeErrorSimple))

			r.Get("/meta", s.sec(auth.ScopeJobsRead, s.meta))

			r.Get("/jobs", s.sec(auth.ScopeJobsRead, s.listJobs))
			r.Post("/jobs", s.sec(auth.ScopeJobsWrite, s.createJob))
			r.Get("/jobs/{id}", s.sec(auth.ScopeJobsRead, s.getJob))
			r.Put("/jobs/{id}", s.sec(auth.ScopeJobsWrite, s.updateJob))
			r.Delete("/jobs/{id}", s.sec(auth.ScopeJobsWrite, s.deleteJob))
			r.Post("/jobs/{id}/run", s.sec(auth.ScopeJobsRun, s.runJob))
			r.Post("/jobs/{id}/toggle", s.sec(auth.ScopeJobsWrite, s.toggleJob))
			r.Post("/jobs/{id}/duplicate", s.sec(auth.ScopeJobsWrite, s.duplicateJob))
			r.Get("/jobs/{id}/runs", s.sec(auth.ScopeRunsRead, s.jobRuns))
			r.Post("/jobs/bulk", s.sec(auth.ScopeJobsWrite, s.bulkJobs))
			r.Get("/tags", s.sec(auth.ScopeJobsRead, s.tags))
			r.Get("/search/jobs", s.sec(auth.ScopeJobsRead, s.searchJobs))

			r.Get("/runs", s.sec(auth.ScopeRunsRead, s.listRuns))
			r.Get("/runs/{id}", s.sec(auth.ScopeRunsRead, s.getRun))
			r.Post("/runs/{id}/cancel", s.sec(auth.ScopeRunsWrite, s.cancelRun))

			r.Post("/cron/preview", s.sec(auth.ScopeJobsRead, s.cronPreview))
			r.Post("/http/preview", s.sec(auth.ScopeJobsWrite, s.httpPreview))
			r.Post("/sql/preview", s.sec(auth.ScopeJobsWrite, s.sqlPreview))
			r.Get("/upcoming", s.sec(auth.ScopeStatsRead, s.upcoming))
			r.Get("/upcoming/days", s.sec(auth.ScopeStatsRead, s.upcomingDays))

			r.Get("/stats/overview", s.sec(auth.ScopeStatsRead, s.statsOverview))
			r.Get("/stats/timeline", s.sec(auth.ScopeStatsRead, s.statsTimeline))
			r.Get("/stats/heatmap", s.sec(auth.ScopeStatsRead, s.statsHeatmap))
			r.Get("/stats/top", s.sec(auth.ScopeStatsRead, s.statsTop))

			r.Get("/events", s.sec(auth.ScopeStatsRead, s.events))

			r.Get("/backup", s.sec(auth.ScopeSystem, s.fullBackup))
			r.Post("/backup/restore", s.sec(auth.ScopeSystem, s.restoreBackup))
			r.Post("/auth/logout-all", s.sec(auth.ScopeSystem, s.logoutAll))
			r.Get("/audit", s.sec(auth.ScopeAuditRead, s.audit))
			r.Get("/settings", s.sec(auth.ScopeSettingsRead, s.getSettings))
			r.Get("/settings/notifications", s.sec(auth.ScopeSettingsRead, s.getNotifications))
			r.Put("/settings/notifications", s.sec(auth.ScopeSettingsWrite, s.putNotifications))
			r.Post("/settings/notifications/test", s.sec(auth.ScopeSettingsWrite, s.testNotifications))
			r.Get("/export", s.sec(auth.ScopeSystem, s.export))
			r.Post("/import", s.sec(auth.ScopeSystem, s.importJobs))

			r.Get("/tokens", s.sec(auth.ScopeTokensManage, s.listTokens))
			r.Post("/tokens", s.sec(auth.ScopeTokensManage, s.createToken))
			r.Delete("/tokens/{id}", s.sec(auth.ScopeTokensManage, s.revokeToken))

			r.Get("/users", s.sec(auth.ScopeSystem, s.listUsers))
			r.Post("/users", s.sec(auth.ScopeSystem, s.createUser))
			r.Delete("/users/{id}", s.sec(auth.ScopeSystem, s.deleteUser))
		})
		r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, 404, "not_found", "endpoint not found", nil)
		})
	})

	if s.Static != nil {
		r.Handle("/*", staticHandler(s.Static))
	}
	return r
}

func (s *Server) maintenanceGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/events" {
			next.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/api/backup/restore" {
			s.maintenance.Lock()
			defer s.maintenance.Unlock()
		} else {
			s.maintenance.RLock()
			defer s.maintenance.RUnlock()
		}
		next.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------- middleware

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "+
			"img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") == s.Cfg.CORSOrigin {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", s.Cfg.CORSOrigin)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Set("Access-Control-Allow-Headers", "Content-Type, X-Requested-With")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			h.Set("Vary", "Origin")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func maxBody(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, n)
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (s *Server) requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api/events" {
			next.ServeHTTP(w, r)
			return
		}
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)
		s.Log.Debug("http", "method", r.Method, "path", r.URL.Path, "status", ww.Status(), "dur", time.Since(start))
	})
}

// ---------------------------------------------------------------- helpers

type apiError struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string, fields map[string]string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: msg, Fields: fields}})
}

func writeErrorSimple(w http.ResponseWriter, status int, msg string) {
	code := "unauthorized"
	if status == http.StatusForbidden {
		code = "forbidden"
	}
	writeError(w, status, code, msg, nil)
}

func (s *Server) internalError(w http.ResponseWriter, err error) {
	s.Log.Error("internal error", "err", err)
	writeError(w, 500, "internal", "internal server error", nil)
}

func (s *Server) storeError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, 404, "not_found", "resource not found", nil)
		return
	}
	s.internalError(w, err)
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeError(w, 413, "too_large", "request body too large", nil)
		} else {
			writeError(w, 400, "bad_request", "invalid JSON: "+err.Error(), nil)
		}
		return false
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		writeError(w, 400, "bad_request", "request must contain exactly one JSON object", nil)
		return false
	}
	return true
}

func qInt(r *http.Request, k string, def int) int {
	if v, err := strconv.Atoi(r.URL.Query().Get(k)); err == nil {
		return v
	}
	return def
}

func qTime(r *http.Request, k string) *time.Time {
	v := r.URL.Query().Get(k)
	if v == "" {
		return nil
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return &t
	}
	return nil
}

type page[T any] struct {
	Items   []T `json:"items"`
	Total   int `json:"total"`
	Page    int `json:"page"`
	PerPage int `json:"per_page"`
}

func (s *Server) audit_(r *http.Request, action, target string, meta any) {
	if err := s.Store.Audit.Log(r.Context(), action, target, auth.ClientIP(r), auditMeta(r, meta)); err != nil {
		s.Log.Warn("audit log failed", "err", err)
	}
}
