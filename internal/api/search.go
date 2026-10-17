package api

import (
	"net/http"
	"strings"
	"unicode/utf8"
)

func (s *Server) searchJobs(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(query) > 256 {
		writeError(w, 422, "validation_failed", "search must be at most 256 characters", nil)
		return
	}
	results, err := s.Store.Jobs.Search(r.Context(), query, 12)
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, 200, results)
}
