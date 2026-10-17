// Package metrics exposes Prometheus text exposition and in-process counters.
package metrics

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"time"
)

// Collector holds counters updated during job execution.
type Collector struct {
	runsSuccess   atomic.Uint64
	runsFailed    atomic.Uint64
	runsTimeout   atomic.Uint64
	runsCancelled atomic.Uint64
	runsSkipped   atomic.Uint64
}

func NewCollector() *Collector { return &Collector{} }

func (c *Collector) RecordRun(status string) {
	switch status {
	case "success":
		c.runsSuccess.Add(1)
	case "failed":
		c.runsFailed.Add(1)
	case "timeout":
		c.runsTimeout.Add(1)
	case "cancelled":
		c.runsCancelled.Add(1)
	case "skipped":
		c.runsSkipped.Add(1)
	}
}

// Snapshot is gathered at scrape time from the database and live subsystems.
type Snapshot struct {
	Version        string
	UptimeSec      float64
	TotalJobs      int
	EnabledJobs    int
	FailingJobs    int
	Runs24h        int
	Failed24h      int
	SuccessRate24h float64
	ActiveRuns     int
	SSEClients     int
	MaxConcurrent  int
}

func (c *Collector) WritePrometheus(w http.ResponseWriter, snap Snapshot) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintf(w, "# HELP crondeck_info CronDeck build info.\n# TYPE crondeck_info gauge\n")
	fmt.Fprintf(w, "crondeck_info{version=%q} 1\n", snap.Version)

	fmt.Fprintf(w, "# HELP crondeck_uptime_seconds Process uptime.\n# TYPE crondeck_uptime_seconds gauge\n")
	fmt.Fprintf(w, "crondeck_uptime_seconds %.0f\n", snap.UptimeSec)

	fmt.Fprintf(w, "# HELP crondeck_jobs_total Job counts.\n# TYPE crondeck_jobs_total gauge\n")
	fmt.Fprintf(w, "crondeck_jobs_total{state=\"all\"} %d\n", snap.TotalJobs)
	fmt.Fprintf(w, "crondeck_jobs_total{state=\"enabled\"} %d\n", snap.EnabledJobs)
	fmt.Fprintf(w, "crondeck_jobs_total{state=\"failing\"} %d\n", snap.FailingJobs)

	fmt.Fprintf(w, "# HELP crondeck_runs_completed_total Runs finished since process start.\n# TYPE crondeck_runs_completed_total counter\n")
	fmt.Fprintf(w, "crondeck_runs_completed_total{status=\"success\"} %d\n", c.runsSuccess.Load())
	fmt.Fprintf(w, "crondeck_runs_completed_total{status=\"failed\"} %d\n", c.runsFailed.Load())
	fmt.Fprintf(w, "crondeck_runs_completed_total{status=\"timeout\"} %d\n", c.runsTimeout.Load())
	fmt.Fprintf(w, "crondeck_runs_completed_total{status=\"cancelled\"} %d\n", c.runsCancelled.Load())
	fmt.Fprintf(w, "crondeck_runs_completed_total{status=\"skipped\"} %d\n", c.runsSkipped.Load())

	fmt.Fprintf(w, "# HELP crondeck_runs_24h Runs created in the last 24 hours.\n# TYPE crondeck_runs_24h gauge\n")
	fmt.Fprintf(w, "crondeck_runs_24h %d\n", snap.Runs24h)
	fmt.Fprintf(w, "# HELP crondeck_runs_failed_24h Failed or timed-out runs in the last 24 hours.\n# TYPE crondeck_runs_failed_24h gauge\n")
	fmt.Fprintf(w, "crondeck_runs_failed_24h %d\n", snap.Failed24h)
	fmt.Fprintf(w, "# HELP crondeck_success_rate_24h Success rate over finished runs in the last 24 hours.\n# TYPE crondeck_success_rate_24h gauge\n")
	fmt.Fprintf(w, "crondeck_success_rate_24h %.2f\n", snap.SuccessRate24h)

	fmt.Fprintf(w, "# HELP crondeck_active_runs Currently executing runs.\n# TYPE crondeck_active_runs gauge\n")
	fmt.Fprintf(w, "crondeck_active_runs %d\n", snap.ActiveRuns)
	fmt.Fprintf(w, "# HELP crondeck_sse_clients Connected event-stream clients.\n# TYPE crondeck_sse_clients gauge\n")
	fmt.Fprintf(w, "crondeck_sse_clients %d\n", snap.SSEClients)
	fmt.Fprintf(w, "# HELP crondeck_max_concurrent_runs Configured worker pool size.\n# TYPE crondeck_max_concurrent_runs gauge\n")
	fmt.Fprintf(w, "crondeck_max_concurrent_runs %d\n", snap.MaxConcurrent)
}

func Uptime(start time.Time) float64 {
	return time.Since(start).Seconds()
}
