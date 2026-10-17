package api

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/honk/crondeck/internal/auth"
	"github.com/honk/crondeck/internal/store"
)

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	items, err := s.Store.Users.List(r.Context())
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, 200, items)
}

type createUserBody struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var body createUserBody
	if !decode(w, r, &body) {
		return
	}
	username := strings.TrimSpace(body.Username)
	if username == "" || utf8.RuneCountInString(username) > 64 {
		writeError(w, 422, "validation_failed", "username required (max 64 chars)", map[string]string{"username": "invalid"})
		return
	}
	if len(body.Password) < 12 {
		writeError(w, 422, "validation_failed", "password must be at least 12 characters", map[string]string{"password": "too short"})
		return
	}
	role := auth.Role(strings.TrimSpace(body.Role))
	if role != auth.RoleAdmin && role != auth.RoleOperator && role != auth.RoleViewer {
		writeError(w, 422, "validation_failed", "invalid role", map[string]string{"role": "invalid"})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		s.internalError(w, err)
		return
	}
	u := &store.User{Username: username, Role: string(role)}
	if err := s.Store.Users.Create(r.Context(), u, string(hash)); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeError(w, 409, "conflict", "username already exists", nil)
			return
		}
		s.internalError(w, err)
		return
	}
	s.audit_(r, "user.create", u.ID, map[string]string{"username": username, "role": string(role)})
	writeJSON(w, 201, u)
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	n, _ := s.Store.Users.Count(r.Context())
	if n == 1 {
		writeError(w, 409, "conflict", "cannot delete the last user account", nil)
		return
	}
	if err := s.Store.Users.Delete(r.Context(), id); err != nil {
		s.storeError(w, err)
		return
	}
	s.audit_(r, "user.delete", id, nil)
	w.WriteHeader(http.StatusNoContent)
}
