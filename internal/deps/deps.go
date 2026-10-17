// Package deps validates job dependency graphs and readiness checks.
package deps

import (
	"fmt"
	"strings"

	"github.com/honk/crondeck/internal/store"
)

// ScheduleDependencyOnly marks jobs that run only after upstream success (no cron).
const ScheduleDependencyOnly = "@dependency"

// IsDependencyOnly returns true when the job should not register on the cron scheduler.
func IsDependencyOnly(j *store.Job) bool {
	return len(j.DependsOn) > 0
}

// NormalizeDependsOn deduplicates and trims dependency IDs.
func NormalizeDependsOn(ids []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// Validate checks dependency lists for a job being saved.
func Validate(jobID string, deps []string, byID map[string]*store.Job) error {
	deps = NormalizeDependsOn(deps)
	if len(deps) == 0 {
		return nil
	}
	if len(deps) > 10 {
		return fmt.Errorf("at most 10 upstream jobs")
	}
	for _, dep := range deps {
		if jobID != "" && dep == jobID {
			return fmt.Errorf("a job cannot depend on itself")
		}
		if _, ok := byID[dep]; !ok {
			return fmt.Errorf("unknown upstream job %q", dep)
		}
	}
	if jobID != "" && hasCycle(jobID, deps, byID) {
		return fmt.Errorf("dependency cycle detected")
	}
	return nil
}

func hasCycle(start string, deps []string, byID map[string]*store.Job) bool {
	visited := map[string]bool{}
	var walk func(id string) bool
	walk = func(id string) bool {
		if id == start {
			return true
		}
		if visited[id] {
			return false
		}
		visited[id] = true
		j := byID[id]
		if j == nil {
			return false
		}
		for _, d := range j.DependsOn {
			if walk(d) {
				return true
			}
		}
		return false
	}
	for _, d := range deps {
		if walk(d) {
			return true
		}
	}
	return false
}

// Satisfied is true when every upstream job's last finished status is success.
func Satisfied(j *store.Job, byID map[string]*store.Job) bool {
	for _, depID := range j.DependsOn {
		up := byID[depID]
		if up == nil || up.LastStatus == nil || *up.LastStatus != store.StatusSuccess {
			return false
		}
	}
	return true
}
