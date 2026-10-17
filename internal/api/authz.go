package api

import (
	"net/http"

	"github.com/honk/crondeck/internal/auth"
)

func (s *Server) sec(scope auth.Scope, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !auth.PrincipalFrom(r.Context()).Allows(scope) {
			writeError(w, http.StatusForbidden, "forbidden", "insufficient permissions", nil)
			return
		}
		h(w, r)
	}
}

func auditMeta(r *http.Request, meta any) any {
	p := auth.PrincipalFrom(r.Context())
	if p == nil {
		return meta
	}
	out := map[string]any{"auth_method": string(p.Method), "role": string(p.Role)}
	if p.TokenID != "" {
		out["token_id"] = p.TokenID
		out["token_name"] = p.TokenName
		out["token_prefix"] = p.TokenPrefix
	}
	switch m := meta.(type) {
	case nil:
	case map[string]string:
		for k, v := range m {
			out[k] = v
		}
	case map[string]any:
		for k, v := range m {
			out[k] = v
		}
	case map[string]int:
		for k, v := range m {
			out[k] = v
		}
	default:
		out["detail"] = meta
	}
	return out
}
