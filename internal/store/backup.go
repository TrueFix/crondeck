package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// BackupTo uses SQLite's snapshot mechanism, including committed WAL contents.
// The caller owns the destination file and must remove it after downloading.
func (s *Store) BackupTo(ctx context.Context, path string) error {
	_, err := s.DB.ExecContext(ctx, `VACUUM main INTO ?`, path)
	return err
}

var backupTables = []string{"jobs", "runs", "audit_log", "settings", "api_tokens", "users"}

// RestoreFrom copies data into the current schema in one transaction. Uploaded
// SQL/schema is never executed. Existing sessions are revoked, not imported.
func (s *Store) RestoreFrom(ctx context.Context, path string) error {
	u := url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro&immutable=1"}
	src, err := sql.Open("sqlite", u.String())
	if err != nil {
		return err
	}
	defer src.Close()
	src.SetMaxOpenConns(1)
	var integrity string
	if err := src.QueryRowContext(ctx, `PRAGMA quick_check`).Scan(&integrity); err != nil || integrity != "ok" {
		return errors.New("not a valid SQLite backup")
	}
	// Require the exact current table schema. This rejects incompatible versions,
	// views, virtual tables, missing tables and reordered/renamed columns.
	for _, table := range append(append([]string{}, backupTables...), "schema_migrations", "sessions") {
		var expected, actual string
		if err := s.DB.QueryRowContext(ctx, `SELECT sql FROM sqlite_schema WHERE name=? AND type='table'`, table).Scan(&expected); err != nil {
			return err
		}
		if err := src.QueryRowContext(ctx, `SELECT sql FROM sqlite_schema WHERE name=? AND type='table'`, table).Scan(&actual); err != nil {
			return fmt.Errorf("backup is missing table %s", table)
		}
		if strings.Join(strings.Fields(expected), " ") != strings.Join(strings.Fields(actual), " ") {
			return fmt.Errorf("backup schema for %s does not match this version", table)
		}
	}
	var versions, current string
	if err := src.QueryRowContext(ctx, `SELECT COALESCE(group_concat(version, ','),'') FROM (SELECT version FROM schema_migrations ORDER BY version)`).Scan(&versions); err != nil {
		return err
	}
	if err := s.DB.QueryRowContext(ctx, `SELECT COALESCE(group_concat(version, ','),'') FROM (SELECT version FROM schema_migrations ORDER BY version)`).Scan(&current); err != nil {
		return err
	}
	if versions != current {
		return errors.New("backup migration version does not match")
	}
	if err := src.Close(); err != nil {
		return err
	}

	conn, err := s.DB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `ATTACH DATABASE ? AS restore_source`, u.String()); err != nil {
		return err
	}
	defer conn.ExecContext(context.Background(), `DETACH DATABASE restore_source`)
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range []string{"runs", "jobs", "audit_log", "settings", "sessions", "api_tokens", "users"} {
		if _, err := tx.ExecContext(ctx, `DELETE FROM main.`+table); err != nil {
			return err
		}
	}
	for _, table := range backupTables {
		if _, err := tx.ExecContext(ctx, `INSERT INTO main.`+table+` SELECT * FROM restore_source.`+table); err != nil {
			return fmt.Errorf("invalid backup data in %s: %w", table, err)
		}
	}
	// A snapshot may contain in-flight runs; processes cannot be resurrected.
	if _, err := tx.ExecContext(ctx, `UPDATE runs SET status='failed', error='interrupted at backup snapshot', finished_at=? WHERE status IN ('running','queued')`, time.Now().UnixMilli()); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE jobs SET next_run_at=NULL, last_status=(SELECT status FROM runs WHERE job_id=jobs.id ORDER BY created_at DESC,id DESC LIMIT 1)`); err != nil {
		return err
	}
	return tx.Commit()
}
