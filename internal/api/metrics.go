package api

import (
	"net/http"

	"github.com/honk/crondeck/internal/metrics"
)

func (s *Server) prometheus(w http.ResponseWriter, r *http.Request) {
	o, err := s.Store.Runs.Overview(r.Context())
	if err != nil {
		s.internalError(w, err)
		return
	}
	snap := metrics.Snapshot{
		Version:        Version,
		UptimeSec:      metrics.Uptime(s.Start),
		TotalJobs:      o.TotalJobs,
		EnabledJobs:    o.EnabledJobs,
		FailingJobs:    o.FailingJobs,
		Runs24h:        o.Runs24h,
		Failed24h:      o.Failed24h,
		SuccessRate24h: o.SuccessRate24h,
		ActiveRuns:     len(s.Runner.ActiveRunIDs()),
		SSEClients:     s.Hub.Subscribers(),
		MaxConcurrent:  s.Cfg.MaxConcurrentRuns,
	}
	s.Metrics.WritePrometheus(w, snap)
}
