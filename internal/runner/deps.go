package runner

import (
	"context"

	"github.com/honk/crondeck/internal/deps"
	"github.com/honk/crondeck/internal/store"
)

func (r *Runner) triggerDependents(ctx context.Context, upstreamID string) {
	all, err := r.st.Jobs.All(ctx)
	if err != nil {
		r.log.Warn("load jobs for dependency chain", "err", err)
		return
	}
	byID := map[string]*store.Job{}
	for _, j := range all {
		byID[j.ID] = j
	}
	for _, j := range all {
		if !j.Enabled || len(j.DependsOn) == 0 {
			continue
		}
		hasUpstream := false
		for _, d := range j.DependsOn {
			if d == upstreamID {
				hasUpstream = true
				break
			}
		}
		if !hasUpstream || !deps.Satisfied(j, byID) {
			continue
		}
		if _, err := r.Trigger(j, store.TriggerChain); err != nil {
			r.log.Warn("chain trigger failed", "job", j.Name, "upstream", upstreamID, "err", err)
		}
	}
}
