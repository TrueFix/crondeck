package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/honk/crondeck/internal/deps"
	"github.com/honk/crondeck/internal/events"
	"github.com/honk/crondeck/internal/runner"
	"github.com/honk/crondeck/internal/scheduler"
	"github.com/honk/crondeck/internal/store"
)

type jobInput struct {
	Name              string          `json:"name"`
	Description       string          `json:"description"`
	Type              string          `json:"type"`
	Schedule          string          `json:"schedule"`
	Timezone          string          `json:"timezone"`
	Config            json.RawMessage `json:"config"`
	Enabled           *bool           `json:"enabled"`
	TimeoutSec        *int            `json:"timeout_sec"`
	MaxRetries        *int            `json:"max_retries"`
	RetryBackoffSec   *int            `json:"retry_backoff_sec"`
	ConcurrencyPolicy string          `json:"concurrency_policy"`
	Tags              []string        `json:"tags"`
	DependsOn         []string        `json:"depends_on"`
	Color             string          `json:"color"`
}

var tagRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,31}$`)

// toJob validates input and applies it on top of base (nil for create).
func (s *Server) toJob(in *jobInput, base *store.Job) (*store.Job, map[string]string) {
	f := map[string]string{}
	j := &store.Job{}
	if base != nil {
		cp := *base
		j = &cp
	} else {
		j.Enabled, j.TimeoutSec, j.ConcurrencyPolicy, j.Timezone = true, 300, store.PolicyForbid, s.Cfg.DefaultTZ
		j.RetryBackoffSec = 30
	}
	j.Name = strings.TrimSpace(in.Name)
	j.Description = strings.TrimSpace(in.Description)
	j.Type = in.Type
	j.Schedule = strings.Join(strings.Fields(in.Schedule), " ")
	if in.Timezone != "" {
		j.Timezone = in.Timezone
	}
	if in.Enabled != nil {
		j.Enabled = *in.Enabled
	}
	if in.TimeoutSec != nil {
		j.TimeoutSec = *in.TimeoutSec
	}
	if in.MaxRetries != nil {
		j.MaxRetries = *in.MaxRetries
	}
	if in.RetryBackoffSec != nil {
		j.RetryBackoffSec = *in.RetryBackoffSec
	}
	if in.ConcurrencyPolicy != "" {
		j.ConcurrencyPolicy = in.ConcurrencyPolicy
	}
	j.Color = in.Color
	j.Tags = []string{}
	seen := map[string]bool{}
	for _, t := range in.Tags {
		t = strings.TrimSpace(t)
		if t == "" || seen[t] {
			continue
		}
		if !tagRe.MatchString(t) {
			f["tags"] = "tags may contain letters, digits, _ . : - (max 32 chars)"
			break
		}
		seen[t] = true
		j.Tags = append(j.Tags, t)
	}
	if len(j.Tags) > 20 {
		f["tags"] = "at most 20 tags"
	}

	if j.Name == "" {
		f["name"] = "name is required"
	} else if len(j.Name) > 120 {
		f["name"] = "name must be at most 120 characters"
	}
	if len(j.Description) > 2000 {
		f["description"] = "description too long"
	}
	if _, err := time.LoadLocation(j.Timezone); err != nil {
		f["timezone"] = "unknown timezone"
	}
	j.DependsOn = deps.NormalizeDependsOn(in.DependsOn)
	if len(j.DependsOn) > 0 && strings.TrimSpace(j.Schedule) == "" {
		j.Schedule = deps.ScheduleDependencyOnly
	}
	if j.Schedule == deps.ScheduleDependencyOnly {
		if len(j.DependsOn) == 0 {
			f["depends_on"] = "pick at least one upstream job for @dependency schedule"
		}
	} else if j.Schedule != "" {
		if _, err := scheduler.Parse(j.Schedule, j.Timezone); err != nil {
			f["schedule"] = err.Error()
		}
	} else {
		f["schedule"] = "schedule is required"
	}
	if j.TimeoutSec < 1 || j.TimeoutSec > 86400 {
		f["timeout_sec"] = "timeout must be between 1 and 86400 seconds"
	}
	if j.MaxRetries < 0 || j.MaxRetries > 10 {
		f["max_retries"] = "retries must be between 0 and 10"
	}
	if j.RetryBackoffSec < 0 || j.RetryBackoffSec > 3600 {
		f["retry_backoff_sec"] = "backoff must be between 0 and 3600 seconds"
	}
	switch j.ConcurrencyPolicy {
	case store.PolicyAllow, store.PolicyForbid, store.PolicyReplace:
	default:
		f["concurrency_policy"] = "must be allow, forbid or replace"
	}
	if len(j.Color) > 32 {
		f["color"] = "invalid color"
	}

	ex, err := s.Reg.Get(j.Type)
	if err != nil {
		f["type"] = "type must be http, shell, script or sql"
	} else {
		if (j.Type == store.TypeShell || j.Type == store.TypeScript) && !s.Cfg.AllowShell {
			f["type"] = "shell and script jobs are disabled on this server (ALLOW_SHELL=false)"
		}
		if j.Type == store.TypeSQL && !s.Cfg.AllowSQL {
			f["type"] = "sql jobs are disabled on this server (ALLOW_SQL=false)"
		}
		cfg := in.Config
		if len(cfg) == 0 || string(cfg) == "null" {
			cfg = json.RawMessage("{}")
		}
		if base != nil && base.Type == j.Type {
			cfg = unredact(j.Type, cfg, base.Config)
		}
		if err := ex.Validate(cfg); err != nil {
			f["config"] = err.Error()
		}
		// re-marshal to compact & normalise
		var anyCfg any
		if json.Unmarshal(cfg, &anyCfg) == nil {
			cfg, _ = json.Marshal(anyCfg)
		}
		j.Config = cfg
	}
	if len(f) > 0 {
		return nil, f
	}
	return j, nil
}

func (s *Server) upstreamBlockedBy(ctx context.Context, id string) (bool, string) {
	all, err := s.Store.Jobs.All(ctx)
	if err != nil {
		return false, ""
	}
	for _, j := range all {
		for _, d := range j.DependsOn {
			if d == id {
				return true, j.Name
			}
		}
	}
	return false, ""
}

func (s *Server) validateDepends(ctx context.Context, j *store.Job) map[string]string {
	all, err := s.Store.Jobs.All(ctx)
	if err != nil {
		return map[string]string{"depends_on": "could not validate dependencies"}
	}
	byID := map[string]*store.Job{}
	for _, x := range all {
		byID[x.ID] = x
	}
	if err := deps.Validate(j.ID, j.DependsOn, byID); err != nil {
		return map[string]string{"depends_on": err.Error()}
	}
	return nil
}

type jobView struct {
	*store.Job
	Running int `json:"running"`
}

func (s *Server) view(j *store.Job) jobView {
	cp := *j
	cp.Config = redact(j.Type, j.Config)
	return jobView{Job: &cp, Running: s.Runner.RunningCount(j.ID)}
}

func (s *Server) listJobs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.JobFilter{Query: q.Get("q"), Type: q.Get("type"), Status: q.Get("status"), Tag: q.Get("tag"),
		Sort: q.Get("sort"), Page: qInt(r, "page", 1), PerPage: qInt(r, "per_page", 50)}
	if v := q.Get("enabled"); v == "true" || v == "false" {
		b := v == "true"
		f.Enabled = &b
	}
	jobs, total, err := s.Store.Jobs.List(r.Context(), f)
	if err != nil {
		s.internalError(w, err)
		return
	}
	items := make([]jobView, len(jobs))
	for i, j := range jobs {
		items[i] = s.view(j)
	}
	writeJSON(w, 200, page[jobView]{Items: items, Total: total, Page: max(f.Page, 1), PerPage: f.PerPage})
}

func (s *Server) createJob(w http.ResponseWriter, r *http.Request) {
	var in jobInput
	if !decode(w, r, &in) {
		return
	}
	j, fields := s.toJob(&in, nil)
	if fields != nil {
		writeError(w, 422, "validation_failed", "please fix the highlighted fields", fields)
		return
	}
	if j.ID == "" {
		j.ID = store.NewID()
	}
	if depFields := s.validateDepends(r.Context(), j); depFields != nil {
		writeError(w, 422, "validation_failed", "please fix the highlighted fields", depFields)
		return
	}
	if err := s.Store.Jobs.Create(r.Context(), j); err != nil {
		s.internalError(w, err)
		return
	}
	s.reschedule(j)
	s.audit_(r, "job.create", j.ID, map[string]string{"name": j.Name, "type": j.Type})
	s.Hub.Publish(events.JobUpdated, map[string]string{"id": j.ID})
	j, _ = s.Store.Jobs.Get(r.Context(), j.ID)
	writeJSON(w, 201, s.view(j))
}

func (s *Server) reschedule(j *store.Job) {
	if err := s.Sched.Upsert(j); err != nil {
		s.Log.Warn("schedule job", "job", j.ID, "err", err)
	}
}

func (s *Server) getJob(w http.ResponseWriter, r *http.Request) {
	j, err := s.Store.Jobs.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.storeError(w, err)
		return
	}
	var next []time.Time
	if j.Enabled {
		next, _ = scheduler.JobNextN(j, time.Now(), 5)
	}
	recent, err := s.Store.Runs.JobRecent(r.Context(), j.ID, 30)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"job": s.view(j), "next_runs": nonNil(next), "recent_runs": recent})
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func (s *Server) updateJob(w http.ResponseWriter, r *http.Request) {
	base, err := s.Store.Jobs.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.storeError(w, err)
		return
	}
	var in jobInput
	if !decode(w, r, &in) {
		return
	}
	j, fields := s.toJob(&in, base)
	if fields != nil {
		writeError(w, 422, "validation_failed", "please fix the highlighted fields", fields)
		return
	}
	if depFields := s.validateDepends(r.Context(), j); depFields != nil {
		writeError(w, 422, "validation_failed", "please fix the highlighted fields", depFields)
		return
	}
	if err := s.Store.Jobs.Update(r.Context(), j); err != nil {
		s.storeError(w, err)
		return
	}
	s.reschedule(j)
	s.audit_(r, "job.update", j.ID, map[string]string{"name": j.Name})
	s.Hub.Publish(events.JobUpdated, map[string]string{"id": j.ID})
	j, _ = s.Store.Jobs.Get(r.Context(), j.ID)
	writeJSON(w, 200, s.view(j))
}

func (s *Server) deleteJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	j, err := s.Store.Jobs.Get(r.Context(), id)
	if err != nil {
		s.storeError(w, err)
		return
	}
	if blocked, name := s.upstreamBlockedBy(r.Context(), id); blocked {
		writeError(w, 409, "conflict", "cannot delete: job is required by "+name, nil)
		return
	}
	s.Sched.Remove(id)
	s.Runner.CancelJob(id)
	if err := s.Store.Jobs.Delete(r.Context(), id); err != nil {
		s.storeError(w, err)
		return
	}
	s.audit_(r, "job.delete", id, map[string]string{"name": j.Name})
	s.Hub.Publish(events.JobDeleted, map[string]string{"id": id})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) runJob(w http.ResponseWriter, r *http.Request) {
	j, err := s.Store.Jobs.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.storeError(w, err)
		return
	}
	run, err := s.Runner.Trigger(j, store.TriggerManual)
	if err != nil {
		if errors.Is(err, runner.ErrStopping) {
			writeError(w, 503, "unavailable", err.Error(), nil)
			return
		}
		s.internalError(w, err)
		return
	}
	s.audit_(r, "job.run", j.ID, map[string]string{"name": j.Name, "run_id": run.ID})
	writeJSON(w, 202, run)
}

func (s *Server) toggleJob(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	j, err := s.Store.Jobs.Get(ctx, chi.URLParam(r, "id"))
	if err != nil {
		s.storeError(w, err)
		return
	}
	j.Enabled = !j.Enabled
	if err := s.Store.Jobs.SetEnabled(ctx, j.ID, j.Enabled); err != nil {
		s.storeError(w, err)
		return
	}
	s.reschedule(j)
	action := "job.disable"
	if j.Enabled {
		action = "job.enable"
	}
	s.audit_(r, action, j.ID, map[string]string{"name": j.Name})
	s.Hub.Publish(events.JobUpdated, map[string]string{"id": j.ID})
	j, _ = s.Store.Jobs.Get(ctx, j.ID)
	writeJSON(w, 200, s.view(j))
}

func (s *Server) duplicateJob(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	src, err := s.Store.Jobs.Get(ctx, chi.URLParam(r, "id"))
	if err != nil {
		s.storeError(w, err)
		return
	}
	cp := *src
	cp.ID, cp.Name, cp.Enabled = "", truncate(src.Name+" (copy)", 120), false
	cp.LastRunAt, cp.LastStatus, cp.NextRunAt = nil, nil, nil
	if err := s.Store.Jobs.Create(ctx, &cp); err != nil {
		s.internalError(w, err)
		return
	}
	s.audit_(r, "job.duplicate", cp.ID, map[string]string{"from": src.ID, "name": cp.Name})
	s.Hub.Publish(events.JobUpdated, map[string]string{"id": cp.ID})
	writeJSON(w, 201, s.view(&cp))
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func (s *Server) jobRuns(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	q.Set("job_id", chi.URLParam(r, "id"))
	r.URL.RawQuery = q.Encode()
	s.listRuns(w, r)
}

type bulkInput struct {
	Action string   `json:"action"` // enable | disable | delete | run
	IDs    []string `json:"ids"`
}

func (s *Server) bulkJobs(w http.ResponseWriter, r *http.Request) {
	var in bulkInput
	if !decode(w, r, &in) {
		return
	}
	if len(in.IDs) == 0 || len(in.IDs) > 500 {
		writeError(w, 422, "validation_failed", "ids must contain 1-500 items", nil)
		return
	}
	switch in.Action {
	case "enable", "disable", "run", "delete":
	default:
		writeError(w, 422, "validation_failed", "action must be enable, disable, delete or run", nil)
		return
	}
	ctx := r.Context()
	done := 0
	for _, id := range in.IDs {
		j, err := s.Store.Jobs.Get(ctx, id)
		if err != nil {
			continue
		}
		switch in.Action {
		case "enable", "disable":
			j.Enabled = in.Action == "enable"
			if s.Store.Jobs.SetEnabled(ctx, id, j.Enabled) == nil {
				s.reschedule(j)
				done++
			}
		case "delete":
			s.Sched.Remove(id)
			s.Runner.CancelJob(id)
			if s.Store.Jobs.Delete(ctx, id) == nil {
				s.Hub.Publish(events.JobDeleted, map[string]string{"id": id})
				done++
			}
		case "run":
			if _, err := s.Runner.Trigger(j, store.TriggerManual); err == nil {
				done++
			}
		default:
			writeError(w, 422, "validation_failed", "action must be enable, disable, delete or run", nil)
			return
		}
	}
	s.audit_(r, "job.bulk_"+in.Action, "", map[string]any{"ids": in.IDs, "affected": done})
	s.Hub.Publish(events.JobUpdated, map[string]string{})
	writeJSON(w, 200, map[string]int{"affected": done})
}

func (s *Server) tags(w http.ResponseWriter, r *http.Request) {
	t, err := s.Store.Jobs.Tags(r.Context())
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, 200, t)
}

// ---------------------------------------------------------------- import/export

type exportFile struct {
	Version    string       `json:"version"`
	ExportedAt time.Time    `json:"exported_at"`
	Jobs       []*store.Job `json:"jobs"`
}

func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.Store.Jobs.All(r.Context())
	if err != nil {
		s.internalError(w, err)
		return
	}
	s.audit_(r, "jobs.export", "", map[string]int{"count": len(jobs)})
	w.Header().Set("Content-Disposition", `attachment; filename="crondeck-export-`+time.Now().Format("20060102-150405")+`.json"`)
	writeJSON(w, 200, exportFile{Version: Version, ExportedAt: time.Now().UTC(), Jobs: jobs})
}

func (s *Server) importJobs(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var in struct {
		Version    string            `json:"version"`
		ExportedAt *time.Time        `json:"exported_at"`
		Jobs       []json.RawMessage `json:"jobs"`
	}
	if !decode(w, r, &in) {
		return
	}
	created, errs := 0, []string{}
	for i, raw := range in.Jobs {
		var ji jobInput
		dec := json.NewDecoder(strings.NewReader(string(raw)))
		if err := dec.Decode(&ji); err != nil {
			errs = append(errs, "job "+itoa(i)+": invalid JSON")
			continue
		}
		j, fields := s.toJob(&ji, nil)
		if fields != nil {
			msg := "job " + itoa(i) + " (" + ji.Name + "): "
			for k, v := range fields {
				msg += k + ": " + v + "; "
			}
			errs = append(errs, msg)
			continue
		}
		if j.ID == "" {
			j.ID = store.NewID()
		}
		if depFields := s.validateDepends(r.Context(), j); depFields != nil {
			errs = append(errs, "job "+itoa(i)+" ("+ji.Name+"): "+depFields["depends_on"])
			continue
		}
		if err := s.Store.Jobs.Create(r.Context(), j); err != nil {
			errs = append(errs, "job "+itoa(i)+": "+err.Error())
			continue
		}
		s.reschedule(j)
		created++
	}
	s.audit_(r, "jobs.import", "", map[string]int{"created": created, "failed": len(errs)})
	s.Hub.Publish(events.JobUpdated, map[string]string{})
	writeJSON(w, 200, map[string]any{"created": created, "errors": errs})
}

func itoa(i int) string { return strconv.Itoa(i) }
