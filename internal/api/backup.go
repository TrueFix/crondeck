package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/honk/crondeck/internal/runner"
)

func (s *Server) backupTemp() (*os.File, error) {
	// Keep large snapshots on the data volume, not in RAM-backed /tmp.
	return os.CreateTemp(filepath.Dir(s.Cfg.DBPath), ".crondeck-backup-*.db")
}

func (s *Server) fullBackup(w http.ResponseWriter, r *http.Request) {
	f, err := s.backupTemp()
	if err != nil {
		s.internalError(w, err)
		return
	}
	name := f.Name()
	f.Close()
	defer os.Remove(name)
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	if err := s.Store.BackupTo(r.Context(), name); err != nil {
		s.internalError(w, err)
		return
	}
	s.audit_(r, "system.backup", "", nil)
	w.Header().Set("Content-Type", "application/vnd.sqlite3")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", `attachment; filename="crondeck-full-`+time.Now().UTC().Format("20060102-150405")+`.db"`)
	http.ServeFile(w, r, name)
}

func (s *Server) restoreBackup(w http.ResponseWriter, r *http.Request) {
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(5 * time.Minute))
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	f, err := s.backupTemp()
	if err != nil {
		s.internalError(w, err)
		return
	}
	name := f.Name()
	defer os.Remove(name)
	_, err = io.Copy(f, r.Body)
	closeErr := f.Close()
	if err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			writeError(w, 413, "too_large", "backup exceeds 256 MiB", nil)
		} else {
			writeError(w, 400, "invalid_backup", "could not read backup upload", nil)
		}
		return
	}
	if closeErr != nil {
		s.internalError(w, closeErr)
		return
	}
	path, err := filepath.Abs(name)
	if err != nil {
		s.internalError(w, err)
		return
	}
	err = s.Runner.WithIdle(func() error {
		if err := s.Store.RestoreFrom(r.Context(), path); err != nil {
			return err
		}
		// Finish rescheduling even if the browser disconnected after the commit.
		return s.Sched.Reload(context.Background())
	})
	if errors.Is(err, runner.ErrBusy) {
		writeError(w, 409, "busy", err.Error(), nil)
		return
	}
	if err != nil {
		writeError(w, 422, "invalid_backup", err.Error(), nil)
		return
	}
	s.audit_(r, "system.restore", "", nil)
	s.Hub.Publish("system.restored", map[string]bool{"ok": true})
	writeJSON(w, 200, map[string]any{"ok": true, "message": "Full backup restored. Sign in again with this server's ADMIN_KEY."})
}
