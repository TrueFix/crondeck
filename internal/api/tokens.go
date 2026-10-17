package api

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/honk/crondeck/internal/auth"
	"github.com/honk/crondeck/internal/store"
)

type tokenView struct {
	store.APIToken
	Revoked bool `json:"revoked"`
}

func (s *Server) listTokens(w http.ResponseWriter, r *http.Request) {
	items, err := s.Store.Tokens.List(r.Context())
	if err != nil {
		s.internalError(w, err)
		return
	}
	out := make([]tokenView, len(items))
	for i, t := range items {
		out[i] = tokenView{APIToken: *t, Revoked: t.RevokedAt != nil}
	}
	writeJSON(w, 200, out)
}

type createTokenBody struct {
	Name      string  `json:"name"`
	Role      string  `json:"role"`
	ExpiresIn *int    `json:"expires_in_days"` // optional TTL in days
}

type createTokenResponse struct {
	Token     string         `json:"token"`
	TokenInfo store.APIToken `json:"token_info"`
}

func (s *Server) createToken(w http.ResponseWriter, r *http.Request) {
	var body createTokenBody
	if !decode(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len(name) > 120 {
		writeError(w, 422, "validation_failed", "name is required (max 120 chars)", map[string]string{"name": "invalid"})
		return
	}
	role := auth.Role(strings.TrimSpace(body.Role))
	if role != auth.RoleAdmin && role != auth.RoleOperator && role != auth.RoleViewer {
		writeError(w, 422, "validation_failed", "role must be admin, operator or viewer", map[string]string{"role": "invalid"})
		return
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		s.internalError(w, err)
		return
	}
	plain := "cd_" + base64.RawURLEncoding.EncodeToString(raw)
	prefix := plain
	if len(prefix) > 12 {
		prefix = prefix[:12]
	}
	tok := &store.APIToken{Name: name, Role: string(role), TokenPrefix: prefix, CreatedAt: time.Now().UTC()}
	if body.ExpiresIn != nil && *body.ExpiresIn > 0 {
		if *body.ExpiresIn > 3650 {
			writeError(w, 422, "validation_failed", "expires_in_days max is 3650", nil)
			return
		}
		exp := time.Now().UTC().AddDate(0, 0, *body.ExpiresIn)
		tok.ExpiresAt = &exp
	}
	if err := s.Store.Tokens.Create(r.Context(), tok, s.Auth.HashToken(plain)); err != nil {
		s.internalError(w, err)
		return
	}
	s.audit_(r, "token.create", tok.ID, map[string]string{"name": name, "role": string(role)})
	writeJSON(w, 201, createTokenResponse{Token: plain, TokenInfo: *tok})
}

func (s *Server) revokeToken(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.Store.Tokens.Revoke(r.Context(), id); err != nil {
		s.storeError(w, err)
		return
	}
	s.audit_(r, "token.revoke", id, nil)
	w.WriteHeader(http.StatusNoContent)
}
