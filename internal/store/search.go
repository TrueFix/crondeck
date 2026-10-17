package store

import (
	"context"
	"strings"
)

// JobSearchResult deliberately excludes scripts, bodies, headers and run data.
type JobSearchResult struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	Enabled bool   `json:"enabled"`
}

func (s *JobStore) Search(ctx context.Context, query string, limit int) ([]JobSearchResult, error) {
	if limit < 1 || limit > 20 {
		limit = 12
	}
	query = strings.TrimSpace(query)
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(query)
	like := "%" + escaped + "%"
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,type,enabled FROM jobs
    WHERE name LIKE ? ESCAPE '\' OR description LIKE ? ESCAPE '\' OR tags LIKE ? ESCAPE '\'
    ORDER BY name COLLATE NOCASE LIMIT ?`, like, like, like, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := []JobSearchResult{}
	for rows.Next() {
		var result JobSearchResult
		if err := rows.Scan(&result.ID, &result.Name, &result.Type, &result.Enabled); err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	return results, rows.Err()
}
