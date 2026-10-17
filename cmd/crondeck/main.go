// Command crondeck runs the CronDeck scheduler, API and embedded dashboard.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/honk/crondeck/internal/api"
	"github.com/honk/crondeck/internal/auth"
	"github.com/honk/crondeck/internal/config"
	"github.com/honk/crondeck/internal/db"
	"github.com/honk/crondeck/internal/events"
	"github.com/honk/crondeck/internal/executor"
	"github.com/honk/crondeck/internal/metrics"
	"github.com/honk/crondeck/internal/notify"
	"github.com/honk/crondeck/internal/runner"
	"github.com/honk/crondeck/internal/scheduler"
	"github.com/honk/crondeck/internal/store"
	"github.com/honk/crondeck/web"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "crondeck:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	var handler slog.Handler
	if cfg.IsProd() {
		handler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	} else {
		handler = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug})
	}
	log := slog.New(handler)

	database, err := db.Open(cfg.DBPath)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer database.Close()
	st := store.New(database)

	ctx := context.Background()
	if n, err := st.Runs.FailInterrupted(ctx); err != nil {
		return err
	} else if n > 0 {
		log.Warn("marked interrupted runs as failed", "count", n)
	}

	hub := events.NewHub()
	reg := executor.DefaultRegistry()
	met := metrics.NewCollector()
	notifySvc := notify.New(st.Settings, cfg.AlertWebhookURL, log)
	rn := runner.New(st, hub, reg, runner.Options{
		MaxConcurrent: cfg.MaxConcurrentRuns, MaxOutputBytes: cfg.MaxOutputBytes, AllowShell: cfg.AllowShell,
		AllowSQL: cfg.AllowSQL,
		Metrics: met, Notify: notifySvc,
	}, log)
	sched := scheduler.New(st, rn, hub, log)
	if err := sched.Load(ctx); err != nil {
		return fmt.Errorf("load jobs: %w", err)
	}
	sched.Start()

	authSvc := auth.New(cfg.AdminKey, cfg.SessionSecret, cfg.SessionTTL, cfg.CookieSecure, st.Sessions, st.Tokens, st.Users)

	static, err := web.FS()
	if err != nil {
		log.Warn("dashboard assets not embedded; run `make web` first", "err", err)
	}

	srv := &api.Server{Cfg: cfg, Store: st, Auth: authSvc, Runner: rn, Sched: sched, Hub: hub, Reg: reg,
		Log: log, Static: static, Start: time.Now(), Metrics: met, Notify: notifySvc}

	httpSrv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           srv.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second, // SSE handler lifts this per-connection
		IdleTimeout:       120 * time.Second,
	}

	jctx, stopJanitor := context.WithCancel(ctx)
	defer stopJanitor()
	go janitor(jctx, st, authSvc, cfg.RunRetentionDays, log)

	errCh := make(chan error, 1)
	go func() {
		log.Info("CronDeck listening", "addr", httpSrv.Addr, "env", cfg.Env, "db", cfg.DBPath, "allow_shell", cfg.AllowShell)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	select {
	case s := <-sig:
		log.Info("shutting down", "signal", s.String())
	case err := <-errCh:
		return err
	}

	sched.Stop()
	hub.Close()
	shutCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutCtx)
	rn.Stop(shutCtx)
	log.Info("bye")
	return nil
}

func janitor(ctx context.Context, st *store.Store, a *auth.Service, retentionDays int, log *slog.Logger) {
	clean := func() {
		if retentionDays > 0 {
			cut := time.Now().AddDate(0, 0, -retentionDays)
			if n, err := st.Runs.DeleteOlderThan(ctx, cut); err != nil {
				log.Error("retention cleanup", "err", err)
			} else if n > 0 {
				log.Info("retention cleanup", "deleted_runs", n)
			}
			_ = st.Audit.DeleteOlderThan(ctx, time.Now().AddDate(0, 0, -max(retentionDays, 90)))
		}
		_, _ = st.Sessions.DeleteExpired(ctx)
		a.SweepLimiter()
	}
	clean()
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			clean()
		}
	}
}
