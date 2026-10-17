package executor

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"

	"github.com/honk/crondeck/internal/store"
)

type SQLConfig struct {
	Driver  string `json:"driver"` // sqlite, postgres
	DSN     string `json:"dsn"`
	Query   string `json:"query"`
	MaxRows int    `json:"max_rows"`
}

type SQL struct{}

func (s *SQL) Validate(raw json.RawMessage) error {
	var c SQLConfig
	if err := json.Unmarshal(raw, &c); err != nil {
		return fmt.Errorf("invalid sql config: %w", err)
	}
	c.Driver = strings.ToLower(strings.TrimSpace(c.Driver))
	if c.Driver != "sqlite" && c.Driver != "postgres" {
		return errors.New("driver must be sqlite or postgres")
	}
	if strings.TrimSpace(c.DSN) == "" {
		return errors.New("connection string (dsn) is required")
	}
	if strings.TrimSpace(c.Query) == "" {
		return errors.New("query is required")
	}
	if len(splitSQL(c.Query)) == 0 {
		return errors.New("query is required")
	}
	if c.MaxRows < 0 || c.MaxRows > 10000 {
		return errors.New("max_rows must be between 0 and 10000")
	}
	return nil
}

// Run executes every statement in order against the database. SELECT-style
// statements print their rows; everything else (INSERT/UPDATE/DELETE/DDL)
// prints the number of rows affected. Changes persist.
func (s *SQL) Run(ctx context.Context, job *store.Job, out *Output) Result {
	var c SQLConfig
	if err := json.Unmarshal(job.Config, &c); err != nil {
		return Result{Error: err.Error()}
	}
	db, err := openSQL(c.Driver, c.DSN)
	if err != nil {
		return Result{Error: err.Error()}
	}
	defer db.Close()

	stmts := splitSQL(c.Query)
	if len(stmts) == 0 {
		return Result{Error: "query is required"}
	}
	limit := c.MaxRows
	if limit == 0 {
		limit = 500
	}

	for idx, stmt := range stmts {
		if len(stmts) > 1 {
			out.WriteString(fmt.Sprintf("── statement %d/%d ──\n", idx+1, len(stmts)))
		}
		if isRowReturning(stmt) {
			rows, err := db.QueryContext(ctx, stmt)
			if err != nil {
				out.WriteString("✗ " + err.Error() + "\n")
				return Result{Error: err.Error()}
			}
			cols, data, truncated, err := scanRows(rows, limit)
			rows.Close()
			if err != nil {
				out.WriteString("✗ " + err.Error() + "\n")
				return Result{Error: err.Error()}
			}
			writeTable(out, cols, data)
			if truncated {
				out.WriteString(fmt.Sprintf("… stopped after %d rows\n", limit))
			}
			out.WriteString(fmt.Sprintf("%d row(s)\n", len(data)))
		} else {
			res, err := db.ExecContext(ctx, stmt)
			if err != nil {
				out.WriteString("✗ " + err.Error() + "\n")
				return Result{Error: err.Error()}
			}
			n, _ := res.RowsAffected()
			out.WriteString(fmt.Sprintf("%d row(s) affected\n", n))
		}
		if idx < len(stmts)-1 {
			out.WriteString("\n")
		}
	}
	return Result{OK: true}
}

// ---------------------------------------------------------------- test (dry-run)

// SQLStatementResult is the outcome of a single statement in a test run.
type SQLStatementResult struct {
	SQL          string     `json:"sql"`
	Kind         string     `json:"kind"` // "rows" | "exec"
	Columns      []string   `json:"columns,omitempty"`
	Rows         [][]string `json:"rows,omitempty"`
	RowCount     int        `json:"row_count"`
	Truncated    bool       `json:"truncated"`
	RowsAffected int64      `json:"rows_affected"`
	Error        string     `json:"error,omitempty"`
}

// SQLTestResult is returned to the editor's test-run preview.
type SQLTestResult struct {
	OK         bool                 `json:"ok"`
	Error      string               `json:"error,omitempty"`
	DurationMS int64                `json:"duration_ms"`
	RolledBack bool                 `json:"rolled_back"`
	Statements []SQLStatementResult `json:"statements"`
}

// TestRun executes the query inside a transaction and always rolls back, so the
// editor can preview results (rows for SELECTs, affected counts for writes)
// without persisting any change.
func (s *SQL) TestRun(ctx context.Context, c SQLConfig) SQLTestResult {
	start := time.Now()
	res := SQLTestResult{Statements: []SQLStatementResult{}}
	finish := func() SQLTestResult {
		res.DurationMS = time.Since(start).Milliseconds()
		return res
	}

	db, err := openSQL(c.Driver, c.DSN)
	if err != nil {
		res.Error = err.Error()
		return finish()
	}
	defer db.Close()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		res.Error = err.Error()
		return finish()
	}
	defer tx.Rollback() //nolint:errcheck // always discarded on purpose
	res.RolledBack = true

	stmts := splitSQL(c.Query)
	limit := c.MaxRows
	if limit == 0 || limit > 500 {
		limit = 500 // keep the preview light regardless of the job's max_rows
	}

	for _, stmt := range stmts {
		sr := SQLStatementResult{SQL: stmt}
		if isRowReturning(stmt) {
			rows, err := tx.QueryContext(ctx, stmt)
			if err != nil {
				sr.Error = err.Error()
				res.Statements = append(res.Statements, sr)
				res.Error = err.Error()
				return finish()
			}
			cols, data, truncated, err := scanRows(rows, limit)
			rows.Close()
			if err != nil {
				sr.Error = err.Error()
				res.Statements = append(res.Statements, sr)
				res.Error = err.Error()
				return finish()
			}
			sr.Kind = "rows"
			sr.Columns = cols
			sr.Rows = data
			sr.RowCount = len(data)
			sr.Truncated = truncated
		} else {
			r, err := tx.ExecContext(ctx, stmt)
			if err != nil {
				sr.Error = err.Error()
				res.Statements = append(res.Statements, sr)
				res.Error = err.Error()
				return finish()
			}
			n, _ := r.RowsAffected()
			sr.Kind = "exec"
			sr.RowsAffected = n
		}
		res.Statements = append(res.Statements, sr)
	}
	res.OK = true
	return finish()
}

// ---------------------------------------------------------------- helpers

type sqlExecer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

var _ sqlExecer = (*sql.DB)(nil)
var _ sqlExecer = (*sql.Tx)(nil)

func openSQL(driver, dsn string) (*sql.DB, error) {
	driver = strings.ToLower(strings.TrimSpace(driver))
	if driver == "sqlite" && !strings.Contains(dsn, "://") {
		dsn = "file:" + dsn + "?_pragma=busy_timeout(5000)"
	}
	return sql.Open(driverName(driver), dsn)
}

func driverName(driver string) string {
	if strings.ToLower(driver) == "postgres" {
		return "pgx"
	}
	return "sqlite"
}

func scanRows(rows *sql.Rows, limit int) (cols []string, data [][]string, truncated bool, err error) {
	cols, err = rows.Columns()
	if err != nil {
		return nil, nil, false, err
	}
	for rows.Next() {
		if len(data) >= limit {
			truncated = true
			break
		}
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err = rows.Scan(ptrs...); err != nil {
			return nil, nil, false, err
		}
		row := make([]string, len(cols))
		for i, v := range vals {
			row[i] = sqlValueString(v)
		}
		data = append(data, row)
	}
	if err == nil {
		err = rows.Err()
	}
	return cols, data, truncated, err
}

func sqlValueString(v any) string {
	switch t := v.(type) {
	case nil:
		return "NULL"
	case []byte:
		return string(t)
	case time.Time:
		return t.Format(time.RFC3339)
	default:
		return fmt.Sprint(t)
	}
}

func writeTable(out *Output, cols []string, data [][]string) {
	out.WriteString(strings.Join(cols, "\t") + "\n")
	for _, row := range data {
		out.WriteString(strings.Join(row, "\t") + "\n")
	}
}

// isRowReturning reports whether a statement is expected to return rows.
func isRowReturning(stmt string) bool {
	switch firstSQLToken(stmt) {
	case "select", "with", "values", "table", "show", "pragma", "explain", "describe", "desc":
		return true
	}
	// INSERT/UPDATE/DELETE ... RETURNING also yields rows.
	return strings.Contains(strings.ToLower(stmt), " returning ")
}

func firstSQLToken(s string) string {
	s = strings.TrimSpace(s)
	i := strings.IndexFunc(s, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '(' || r == ';'
	})
	if i < 0 {
		return strings.ToLower(s)
	}
	return strings.ToLower(s[:i])
}

// splitSQL splits a script into individual statements, honoring single/double
// quotes, line (--) and block (/* */) comments, and PostgreSQL dollar-quoting.
func splitSQL(input string) []string {
	var stmts []string
	var b strings.Builder
	runes := []rune(input)
	n := len(runes)
	var dollarTag string
	inSingle, inDouble, inLine, inBlock, inDollar := false, false, false, false, false

	flush := func() {
		if s := strings.TrimSpace(b.String()); s != "" {
			stmts = append(stmts, s)
		}
		b.Reset()
	}

	for i := 0; i < n; i++ {
		r := runes[i]
		switch {
		case inLine:
			b.WriteRune(r)
			if r == '\n' {
				inLine = false
			}
		case inBlock:
			b.WriteRune(r)
			if r == '*' && i+1 < n && runes[i+1] == '/' {
				b.WriteRune('/')
				i++
				inBlock = false
			}
		case inSingle:
			b.WriteRune(r)
			if r == '\'' {
				if i+1 < n && runes[i+1] == '\'' { // escaped ''
					b.WriteRune('\'')
					i++
				} else {
					inSingle = false
				}
			}
		case inDouble:
			b.WriteRune(r)
			if r == '"' {
				inDouble = false
			}
		case inDollar:
			if r == '$' && hasTagAt(runes, i, dollarTag) {
				b.WriteString(dollarTag)
				i += len([]rune(dollarTag)) - 1
				inDollar = false
			} else {
				b.WriteRune(r)
			}
		case r == '-' && i+1 < n && runes[i+1] == '-':
			inLine = true
			b.WriteString("--")
			i++
		case r == '/' && i+1 < n && runes[i+1] == '*':
			inBlock = true
			b.WriteString("/*")
			i++
		case r == '\'':
			inSingle = true
			b.WriteRune(r)
		case r == '"':
			inDouble = true
			b.WriteRune(r)
		case r == '$':
			if tag, ok := readDollarTag(runes, i); ok {
				dollarTag = tag
				b.WriteString(tag)
				i += len([]rune(tag)) - 1
				inDollar = true
			} else {
				b.WriteRune(r)
			}
		case r == ';':
			flush()
		default:
			b.WriteRune(r)
		}
	}
	flush()
	return stmts
}

// readDollarTag reads a "$tag$" opener starting at i (runes[i]=='$').
func readDollarTag(runes []rune, i int) (string, bool) {
	for j := i + 1; j < len(runes); j++ {
		r := runes[j]
		if r == '$' {
			return string(runes[i : j+1]), true
		}
		if !(r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return "", false
		}
	}
	return "", false
}

func hasTagAt(runes []rune, i int, tag string) bool {
	t := []rune(tag)
	if i+len(t) > len(runes) {
		return false
	}
	for k, rt := range t {
		if runes[i+k] != rt {
			return false
		}
	}
	return true
}
