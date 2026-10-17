package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/honk/crondeck/internal/executor"
)

// sqlPreview runs the query inside a transaction and rolls it back, so the
// editor can preview results without persisting changes.
func (s *Server) sqlPreview(w http.ResponseWriter, r *http.Request) {
	if !s.Cfg.AllowSQL {
		writeError(w, 403, "forbidden", "SQL jobs are disabled on this server (ALLOW_SQL=false)", nil)
		return
	}
	var in struct {
		Driver  string `json:"driver"`
		DSN     string `json:"dsn"`
		Query   string `json:"query"`
		MaxRows int    `json:"max_rows"`
		JobID   string `json:"job_id"`
	}
	if !decode(w, r, &in) {
		return
	}

	// When editing an existing job the DSN comes back masked; recover the stored
	// one so the test can actually connect.
	if in.DSN == Mask && in.JobID != "" {
		if job, err := s.Store.Jobs.Get(r.Context(), in.JobID); err == nil && job.Type == "sql" {
			var stored struct {
				DSN string `json:"dsn"`
			}
			if json.Unmarshal(job.Config, &stored) == nil {
				in.DSN = stored.DSN
			}
		}
	}
	if in.DSN == Mask {
		writeError(w, 422, "validation_failed", "re-enter the connection string to run a test", nil)
		return
	}

	cfg := executor.SQLConfig{Driver: in.Driver, DSN: in.DSN, Query: in.Query, MaxRows: in.MaxRows}
	raw, _ := json.Marshal(cfg)
	if err := (&executor.SQL{}).Validate(raw); err != nil {
		writeError(w, 422, "validation_failed", err.Error(), nil)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	res := (&executor.SQL{}).TestRun(ctx, cfg)
	writeJSON(w, 200, res)
}
