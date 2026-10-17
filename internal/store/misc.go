package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// ---------------------------------------------------------------- sessions

type SessionStore struct{ db *sql.DB }

// Create stores a session keyed by the *hash* of the token (the raw token never touches the DB).
func (s *SessionStore) Create(ctx context.Context, hash string, ttl time.Duration, ip, ua, userID string) (*Session, error) {
	now := time.Now().UTC()
	sess := &Session{ID: hash, UserID: userID, CreatedAt: now, ExpiresAt: now.Add(ttl), IP: ip, UserAgent: ua}
	_, err := s.db.ExecContext(ctx, `INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)`,
		hash, nullStr(userID), ms(now), ms(sess.ExpiresAt), ip, ua)
	return sess, err
}

func (s *SessionStore) Get(ctx context.Context, hash string) (*Session, error) {
	var sess Session
	var c, e int64
	var userID sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT id, user_id, created_at, expires_at, ip, user_agent FROM sessions WHERE id=?`, hash).
		Scan(&sess.ID, &userID, &c, &e, &sess.IP, &sess.UserAgent)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	sess.CreatedAt, sess.ExpiresAt = fromMs(c), fromMs(e)
	if userID.Valid {
		sess.UserID = userID.String
	}
	return &sess, nil
}

func (s *SessionStore) Delete(ctx context.Context, hash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE id=?`, hash)
	return err
}

func (s *SessionStore) DeleteAll(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions`)
	return err
}

func (s *SessionStore) DeleteExpired(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at < ?`, ms(time.Now()))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *SessionStore) Count(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM sessions WHERE expires_at >= ?`, ms(time.Now())).Scan(&n)
	return n, err
}

// ---------------------------------------------------------------- audit

type AuditStore struct{ db *sql.DB }

func (s *AuditStore) Log(ctx context.Context, action, target, ip string, meta any) error {
	b := []byte("{}")
	if meta != nil {
		if m, err := json.Marshal(meta); err == nil {
			b = m
		}
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO audit_log (action, target_id, meta, ip, created_at) VALUES (?,?,?,?,?)`,
		action, target, string(b), ip, ms(time.Now()))
	return err
}

func (s *AuditStore) List(ctx context.Context, action, target string, page, perPage int) ([]AuditEntry, int, error) {
	if perPage <= 0 || perPage > 500 {
		perPage = 50
	}
	if page <= 0 {
		page = 1
	}
	where, args := "1=1", []any{}
	if action != "" {
		where += " AND action LIKE ?"
		args = append(args, action+"%")
	}
	if target != "" {
		where += " AND target_id = ?"
		args = append(args, target)
	}
	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM audit_log WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, action, target_id, meta, ip, created_at FROM audit_log WHERE `+where+
		` ORDER BY id DESC LIMIT ? OFFSET ?`, append(args, perPage, (page-1)*perPage)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var a AuditEntry
		var meta string
		var c int64
		if err := rows.Scan(&a.ID, &a.Action, &a.TargetID, &meta, &a.IP, &c); err != nil {
			return nil, 0, err
		}
		a.Meta, a.CreatedAt = json.RawMessage(meta), fromMs(c)
		out = append(out, a)
	}
	return out, total, rows.Err()
}

func (s *AuditStore) DeleteOlderThan(ctx context.Context, before time.Time) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM audit_log WHERE created_at < ?`, ms(before))
	return err
}

// ---------------------------------------------------------------- settings

type SettingsStore struct{ db *sql.DB }

func (s *SettingsStore) Get(ctx context.Context, key string) (string, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key=?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return v, err
}

func (s *SettingsStore) Set(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

func (s *SettingsStore) All(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT key, value FROM settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}
