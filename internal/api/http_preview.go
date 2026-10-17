package api

import (
	"context"
	"net/http"
	"time"

	"github.com/honk/crondeck/internal/executor"
)

func (s *Server) httpPreview(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Step            executor.HTTPStep `json:"step"`
		Variables       map[string]string `json:"variables"`
		FollowRedirects *bool             `json:"follow_redirects"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := executor.ValidateHTTPProbeStep(in.Step); err != nil {
		writeError(w, 422, "validation_failed", err.Error(), nil)
		return
	}
	if in.Variables == nil {
		in.Variables = map[string]string{}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	res := (&executor.HTTP{}).ProbeStep(ctx, in.FollowRedirects, in.Step, in.Variables)
	writeJSON(w, 200, res)
}
