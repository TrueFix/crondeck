package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type APIToken struct {
	ID          string     `json:"id"`
	UserID      string     `json:"user_id,omitempty"`
	Name        string     `json:"name"`
	Role        string     `json:"role"`
	TokenPrefix string     `json:"token_prefix"`
	ExpiresAt   *time.Time `json:"expires_at"`
	LastUsedAt  *time.Time `json:"last_used_at"`
	RevokedAt   *time.Time `json:"revoked_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

type TokenStore struct{ db *sql.DB }

func (s *TokenStore) Create(ctx context.Context, t *APIToken, tokenHash string) error {
	if t.ID == "" {
		t.ID = NewID()
	}
	if t.CreatedAt.IsZero() {
		t.CreatedAt = time.Now().UTC()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO api_tokens (id, user_id, name, role, token_prefix, token_hash,
		expires_at, last_used_at, revoked_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
		t.ID, nullStr(t.UserID), t.Name, t.Role, t.TokenPrefix, tokenHash,
		msPtr(t.ExpiresAt), msPtr(t.LastUsedAt), msPtr(t.RevokedAt), ms(t.CreatedAt))
	return err
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *TokenStore) GetByHash(ctx context.Context, hash string) (*APIToken, error) {
	t, err := scanToken(s.db.QueryRowContext(ctx, `SELECT id, COALESCE(user_id,''), name, role, token_prefix,
		expires_at, last_used_at, revoked_at, created_at FROM api_tokens WHERE token_hash=?`, hash))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

func scanToken(row scanner) (*APIToken, error) {
	var t APIToken
	var expP, lastP, revP *int64
	var createdAt int64
	if err := row.Scan(&t.ID, &t.UserID, &t.Name, &t.Role, &t.TokenPrefix, &expP, &lastP, &revP, &createdAt); err != nil {
		return nil, err
	}
	t.ExpiresAt = fromNullMs(expP)
	t.LastUsedAt = fromNullMs(lastP)
	t.RevokedAt = fromNullMs(revP)
	t.CreatedAt = fromMs(createdAt)
	return &t, nil
}

func (s *TokenStore) List(ctx context.Context) ([]*APIToken, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(user_id,''), name, role, token_prefix,
		expires_at, last_used_at, revoked_at, created_at FROM api_tokens ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*APIToken{}
	for rows.Next() {
		t, err := scanToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *TokenStore) Revoke(ctx context.Context, id string) error {
	now := time.Now().UTC()
	res, err := s.db.ExecContext(ctx, `UPDATE api_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL`, ms(now), id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *TokenStore) Touch(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE api_tokens SET last_used_at=? WHERE id=?`, ms(time.Now().UTC()), id)
	return err
}

func (s *TokenStore) ActiveCount(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM api_tokens WHERE revoked_at IS NULL AND
		(expires_at IS NULL OR expires_at > ?)`, ms(time.Now())).Scan(&n)
	return n, err
}
