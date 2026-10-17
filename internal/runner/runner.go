// Package runner executes job attempts with a global worker pool, per-job
// concurrency policies, timeouts, retries, persistence and live events.
package runner

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/honk/crondeck/internal/events"
	"github.com/honk/crondeck/internal/executor"
	"github.com/honk/crondeck/internal/metrics"
	"github.com/honk/crondeck/internal/notify"
	"github.com/honk/crondeck/internal/store"
)

var (
	ErrNotRunning   = errors.New("run is not active")
	ErrShellBlocked = errors.New("shell and script jobs are disabled (ALLOW_SHELL=false)")
	ErrStopping     = errors.New("runner is shutting down")

	causeCancelled = errors.New("cancelled by user")
	causeReplaced  = errors.New("replaced by a newer run")
	causeShutdown  = errors.New("server shutting down")
)

type Options struct {
	MaxConcurrent  int
	MaxOutputBytes int
	AllowShell     bool
	AllowSQL       bool
	Metrics        *metrics.Collector
	Notify         *notify.Service
}

type active struct {
	runID  string
	jobID  string
	cancel context.CancelCauseFunc
	output *executor.Output
}

type Runner struct {
	st   *store.Store
	hub  *events.Hub
	reg  executor.Registry
	opts Options
	log  *slog.Logger
	sem  chan struct{}
	base context.Context
	stop context.CancelCauseFunc
	wg   sync.WaitGroup

	mu          sync.Mutex
	active      map[string]*active            // runID -> active
	byJob       map[string]map[string]*active // jobID -> runID -> active
	retries     map[*time.Timer]struct{}
	stopping    bool
	maintenance sync.RWMutex
}

var ErrBusy = errors.New("pause jobs and wait for active runs and pending retries before restoring")

// WithIdle excludes triggers while database state is replaced. It never interrupts a running job.
func (r *Runner) WithIdle(fn func() error) error {
	r.maintenance.Lock()
	defer r.maintenance.Unlock()
	r.mu.Lock()
	busy := len(r.active) > 0 || len(r.retries) > 0 || r.stopping
	r.mu.Unlock()
	if busy {
		return ErrBusy
	}
	return fn()
}

func New(st *store.Store, hub *events.Hub, reg executor.Registry, opts Options, log *slog.Logger) *Runner {
	if opts.MaxConcurrent < 1 {
		opts.MaxConcurrent = 1
	}
	base, stop := context.WithCancelCause(context.Background())
	return &Runner{
		st: st, hub: hub, reg: reg, opts: opts, log: log,
		sem: make(chan struct{}, opts.MaxConcurrent), base: base, stop: stop,
		active: map[string]*active{}, byJob: map[string]map[string]*active{}, retries: map[*time.Timer]struct{}{},
	}
}

func (r *Runner) AllowShell() bool { return r.opts.AllowShell }

// RunningCount returns how many runs are active (queued or running) for a job.
func (r *Runner) RunningCount(jobID string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.byJob[jobID])
}

// ActiveRunIDs returns all active run IDs.
func (r *Runner) ActiveRunIDs() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.active))
	for id := range r.active {
		out = append(out, id)
	}
	return out
}

// LiveOutput is a bounded, thread-safe snapshot for viewers opened mid-run or after reconnecting.
func (r *Runner) LiveOutput(id string) (string, bool) {
	r.mu.Lock()
	a := r.active[id]
	var out *executor.Output
	if a != nil {
		out = a.output
	}
	r.mu.Unlock()
	if out == nil {
		return "", false
	}
	return out.String(), true
}

// Trigger starts a new run for the job (non-blocking). It returns the created run record.
func (r *Runner) Trigger(job *store.Job, trigger string) (*store.Run, error) {
	return r.trigger(job, trigger, 1)
}

func (r *Runner) trigger(job *store.Job, trigger string, attempt int) (*store.Run, error) {
	r.maintenance.RLock()
	defer r.maintenance.RUnlock()
	return r.triggerLocked(job, trigger, attempt)
}

func (r *Runner) triggerLocked(job *store.Job, trigger string, attempt int) (*store.Run, error) {
	// A scheduled callback may have read its job before a restore or edit began.
	fresh, err := r.st.Jobs.Get(context.Background(), job.ID)
	if err != nil {
		return nil, err
	}
	job = fresh
	if trigger == store.TriggerSchedule && !job.Enabled {
		return nil, errors.New("job is paused")
	}
	now := time.Now().UTC()
	run := &store.Run{ID: store.NewID(), JobID: job.ID, JobName: job.Name, JobType: job.Type,
		Status: store.StatusQueued, Trigger: trigger, Attempt: attempt, CreatedAt: now}

	r.mu.Lock()
	if r.stopping {
		r.mu.Unlock()
		return nil, ErrStopping
	}
	existing := r.byJob[job.ID]
	if len(existing) > 0 {
		switch job.ConcurrencyPolicy {
		case store.PolicyForbid:
			r.mu.Unlock()
			run.Status = store.StatusSkipped
			run.Error = "skipped: previous run still in progress (policy: forbid)"
			run.StartedAt, run.FinishedAt = &now, &now
			zero := int64(0)
			run.DurationMs = &zero
			if err := r.st.Runs.Create(context.Background(), run); err != nil {
				return nil, err
			}
			r.hub.Publish(events.RunFinished, snapshot(run))
			return run, nil
		case store.PolicyReplace:
			for _, a := range existing {
				a.cancel(causeReplaced)
			}
		}
	}
	ctx, cancel := context.WithCancelCause(r.base)
	a := &active{runID: run.ID, jobID: job.ID, cancel: cancel}
	r.active[run.ID] = a
	if r.byJob[job.ID] == nil {
		r.byJob[job.ID] = map[string]*active{}
	}
	r.byJob[job.ID][run.ID] = a
	r.wg.Add(1)
	r.mu.Unlock()

	if err := r.st.Runs.Create(context.Background(), run); err != nil {
		r.release(a)
		cancel(nil)
		r.wg.Done()
		return nil, err
	}
	r.hub.Publish(events.RunQueued, snapshot(run))
	snap := snapshot(run)
	go r.execute(ctx, a, job, run)
	return snap, nil
}

func (r *Runner) release(a *active) {
	r.mu.Lock()
	delete(r.active, a.runID)
	if m := r.byJob[a.jobID]; m != nil {
		delete(m, a.runID)
		if len(m) == 0 {
			delete(r.byJob, a.jobID)
		}
	}
	r.mu.Unlock()
}

// Cancel stops an active run.
func (r *Runner) Cancel(runID string) error {
	r.mu.Lock()
	a, ok := r.active[runID]
	r.mu.Unlock()
	if !ok {
		return ErrNotRunning
	}
	a.cancel(causeCancelled)
	return nil
}

// CancelJob cancels all active runs of a job (used when a job is deleted).
func (r *Runner) CancelJob(jobID string) {
	r.mu.Lock()
	for _, a := range r.byJob[jobID] {
		a.cancel(causeCancelled)
	}
	r.mu.Unlock()
}

func (r *Runner) execute(ctx context.Context, a *active, job *store.Job, run *store.Run) {
	defer r.wg.Done()
	retryNeeded := false
	defer func() {
		r.maintenance.RLock()
		defer r.maintenance.RUnlock()
		r.release(a)
		if retryNeeded {
			r.scheduleRetry(job.ID, run.Attempt+1, job.RetryBackoffSec)
		}
	}()
	defer a.cancel(nil)
	bg := context.Background()

	finish := func(status, errMsg string, res executor.Result, out string, started *time.Time) {
		end := time.Now().UTC()
		run.Status, run.Error, run.Output = status, errMsg, out
		run.FinishedAt = &end
		run.ExitCode, run.HTTPStatus = res.ExitCode, res.HTTPStatus
		if started != nil {
			d := end.Sub(*started).Milliseconds()
			run.DurationMs = &d
		}
		if err := r.st.Runs.Finish(bg, run); err != nil {
			r.log.Error("persist run", "run", run.ID, "err", err)
		}
		if err := r.st.Jobs.SetLastRun(bg, job.ID, end, status); err != nil && !errors.Is(err, store.ErrNotFound) {
			r.log.Error("update job last run", "job", job.ID, "err", err)
		}
		r.hub.Publish(events.RunFinished, snapshot(run))
		r.log.Info("run finished", "job", job.Name, "run", run.ID, "status", status, "attempt", run.Attempt)
		if r.opts.Metrics != nil {
			r.opts.Metrics.RecordRun(status)
		}
		retryNeeded = (status == store.StatusFailed || status == store.StatusTimeout) && run.Attempt <= job.MaxRetries
		if r.opts.Notify != nil && !retryNeeded &&
			(status == store.StatusFailed || status == store.StatusTimeout) {
			go r.opts.Notify.RunFailed(bg, job, run)
		}
		if status == store.StatusSuccess && !retryNeeded {
			go r.triggerDependents(bg, job.ID)
		}
	}

	if (job.Type == store.TypeShell || job.Type == store.TypeScript) && !r.opts.AllowShell {
		finish(store.StatusFailed, ErrShellBlocked.Error(), executor.Result{}, "", nil)
		return
	}
	if job.Type == store.TypeSQL && !r.opts.AllowSQL {
		finish(store.StatusFailed, "sql jobs are disabled (ALLOW_SQL=false)", executor.Result{}, "", nil)
		return
	}
	ex, err := r.reg.Get(job.Type)
	if err != nil {
		finish(store.StatusFailed, err.Error(), executor.Result{}, "", nil)
		return
	}

	// Wait for a worker slot (cancellable while queued).
	select {
	case r.sem <- struct{}{}:
	case <-ctx.Done():
		finish(statusFromCause(ctx, store.StatusCancelled), causeMsg(ctx), executor.Result{}, "", nil)
		return
	}
	defer func() { <-r.sem }()
	if ctx.Err() != nil {
		finish(store.StatusCancelled, causeMsg(ctx), executor.Result{}, "", nil)
		return
	}

	started := time.Now().UTC()
	run.Status, run.StartedAt = store.StatusRunning, &started
	if err := r.st.Runs.MarkRunning(bg, run.ID, started); err != nil {
		r.log.Error("mark running", "run", run.ID, "err", err)
	}
	r.hub.Publish(events.RunStarted, snapshot(run))

	timeout := time.Duration(job.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 24 * time.Hour
	}
	tctx, tcancel := context.WithTimeout(ctx, timeout)
	defer tcancel()

	runID := run.ID
	out := executor.NewOutput(r.opts.MaxOutputBytes, func(chunk string) {
		if !r.hub.WantsLogs() {
			return
		}
		r.hub.Publish(events.RunLog, map[string]string{"run_id": runID, "job_id": job.ID, "chunk": chunk})
	})
	r.mu.Lock()
	a.output = out
	r.mu.Unlock()

	res := func() (res executor.Result) {
		defer func() {
			if p := recover(); p != nil {
				r.log.Error("executor panic", "job", job.ID, "panic", p)
				res = executor.Result{Error: "internal error: executor panicked"}
			}
		}()
		return ex.Run(tctx, job, out)
	}()

	status, msg := store.StatusSuccess, ""
	switch {
	case ctx.Err() != nil: // cancelled / replaced / shutdown
		status, msg = store.StatusCancelled, causeMsg(ctx)
	case errors.Is(tctx.Err(), context.DeadlineExceeded):
		status, msg = store.StatusTimeout, "timed out after "+timeout.String()
	case !res.OK:
		status, msg = store.StatusFailed, res.Error
	}
	finish(status, msg, res, out.String(), &started)
}

// snapshot copies a run for publishing (events are marshalled on other goroutines).
func snapshot(run *store.Run) *store.Run {
	cp := *run
	cp.Output = ""
	return &cp
}

func statusFromCause(ctx context.Context, def string) string {
	if ctx.Err() != nil {
		return store.StatusCancelled
	}
	return def
}

func causeMsg(ctx context.Context) string {
	if c := context.Cause(ctx); c != nil && !errors.Is(c, context.Canceled) {
		return c.Error()
	}
	return "cancelled"
}

func (r *Runner) scheduleRetry(jobID string, attempt, backoffSec int) {
	if backoffSec < 0 {
		backoffSec = 0
	}
	// linear backoff: backoff * (attempt-1)
	delay := time.Duration(backoffSec*(attempt-1)) * time.Second
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopping {
		return
	}
	var t *time.Timer
	t = time.AfterFunc(delay, func() {
		r.maintenance.RLock()
		defer r.maintenance.RUnlock()
		r.mu.Lock()
		delete(r.retries, t)
		stopping := r.stopping
		r.mu.Unlock()
		if stopping {
			return
		}
		job, err := r.st.Jobs.Get(context.Background(), jobID)
		if err != nil {
			return // job deleted
		}
		if _, err := r.triggerLocked(job, store.TriggerRetry, attempt); err != nil {
			r.log.Warn("retry trigger failed", "job", jobID, "err", err)
		}
	})
	r.retries[t] = struct{}{}
}

// Stop prevents new runs, waits for active runs until ctx expires, then cancels the rest.
func (r *Runner) Stop(ctx context.Context) {
	r.mu.Lock()
	r.stopping = true
	for t := range r.retries {
		t.Stop()
	}
	r.retries = map[*time.Timer]struct{}{}
	r.mu.Unlock()

	done := make(chan struct{})
	go func() { r.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
		r.stop(causeShutdown)
		<-done
	}
}
