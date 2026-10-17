// Package auth implements static-ADMIN_KEY login, DB-backed sessions and a failed-login limiter.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/honk/crondeck/internal/store"
	"golang.org/x/crypto/bcrypt"
)

const (
	CookieName  = "crondeck_session"
	CSRFHeader  = "X-Requested-With"
	CSRFValue   = "crondeck"
	maxFailures = 5
	failWindow  = 15 * time.Minute
)

var (
	ErrInvalidKey      = errors.New("invalid admin key")
	ErrInvalidPassword = errors.New("invalid username or password")
	ErrRateLimited     = errors.New("too many failed attempts, try again later")
)

type Service struct {
	adminKey []byte
	secret   []byte
	ttl      time.Duration
	secure   bool
	sessions *store.SessionStore
	tokens   *store.TokenStore
	users    *store.UserStore
	limiter  *Limiter
}

func New(adminKey, secret string, ttl time.Duration, secure bool, sessions *store.SessionStore, tokens *store.TokenStore, users *store.UserStore) *Service {
	return &Service{
		adminKey: []byte(adminKey), secret: []byte(secret), ttl: ttl, secure: secure,
		sessions: sessions, tokens: tokens, users: users, limiter: NewLimiter(maxFailures, failWindow),
	}
}

// HashToken derives the stored lookup key for a bearer token (same scheme as session cookies).
func (s *Service) HashToken(token string) string {
	return s.hash(token)
}

// hash binds the token to the server secret so a leaked DB alone can't forge cookies.
func (s *Service) hash(token string) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte(token))
	return hex.EncodeToString(m.Sum(nil))
}

// CheckKey compares in constant time. Comparing SHA-256 digests keeps the
// comparison length-independent so key length isn't leaked either.
func (s *Service) CheckKey(key string) bool {
	a := sha256.Sum256([]byte(key))
	b := sha256.Sum256(s.adminKey)
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

// Login validates the key, applies rate limiting and returns a cookie on success.
// The returned retryAfter is non-zero when rate-limited.
func (s *Service) Login(ctx context.Context, key, ip, ua string) (*http.Cookie, time.Duration, error) {
	if wait := s.limiter.Blocked(ip); wait > 0 {
		return nil, wait, ErrRateLimited
	}
	if !s.CheckKey(key) {
		s.limiter.Fail(ip)
		return nil, 0, ErrInvalidKey
	}
	s.limiter.Reset(ip)
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, 0, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	if len(ua) > 300 {
		ua = ua[:300]
	}
	sess, err := s.sessions.Create(ctx, s.hash(token), s.ttl, ip, ua, "")
	if err != nil {
		return nil, 0, err
	}
	return s.cookie(token, sess.ExpiresAt), 0, nil
}

// LoginPassword validates a local user password and returns a session cookie.
func (s *Service) LoginPassword(ctx context.Context, username, password, ip, ua string) (*http.Cookie, time.Duration, error) {
	if s.users == nil {
		return nil, 0, ErrInvalidPassword
	}
	if wait := s.limiter.Blocked(ip); wait > 0 {
		return nil, wait, ErrRateLimited
	}
	u, hash, err := s.users.GetByUsername(ctx, strings.TrimSpace(username))
	if err != nil || hash == "" {
		s.limiter.Fail(ip)
		return nil, 0, ErrInvalidPassword
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		s.limiter.Fail(ip)
		return nil, 0, ErrInvalidPassword
	}
	s.limiter.Reset(ip)
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, 0, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	if len(ua) > 300 {
		ua = ua[:300]
	}
	sess, err := s.sessions.Create(ctx, s.hash(token), s.ttl, ip, ua, u.ID)
	if err != nil {
		return nil, 0, err
	}
	sess.Username, sess.Role = u.Username, u.Role
	return s.cookie(token, sess.ExpiresAt), 0, nil
}

func (s *Service) cookie(value string, exp time.Time) *http.Cookie {
	c := &http.Cookie{
		Name: CookieName, Value: value, Path: "/", HttpOnly: true,
		Secure: s.secure, SameSite: http.SameSiteStrictMode,
	}
	if exp.IsZero() {
		c.MaxAge = -1
		c.Expires = time.Unix(0, 0)
	} else {
		c.Expires = exp
		c.MaxAge = int(time.Until(exp).Seconds())
	}
	return c
}

func (s *Service) Logout(ctx context.Context, r *http.Request) *http.Cookie {
	if c, err := r.Cookie(CookieName); err == nil && c.Value != "" {
		_ = s.sessions.Delete(ctx, s.hash(c.Value))
	}
	return s.cookie("", time.Time{})
}

// Session returns the active session for the request or nil.
func (s *Service) Session(r *http.Request) *store.Session {
	c, err := r.Cookie(CookieName)
	if err != nil || c.Value == "" || len(c.Value) > 128 {
		return nil
	}
	h := s.hash(c.Value)
	sess, err := s.sessions.Get(r.Context(), h)
	if err != nil {
		return nil
	}
	if time.Now().After(sess.ExpiresAt) {
		_ = s.sessions.Delete(r.Context(), h)
		return nil
	}
	return sess
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
}

// Authenticate resolves a Bearer API token or session cookie (Bearer wins when both are sent).
func (s *Service) Authenticate(r *http.Request) (*Principal, bool) {
	raw := bearerToken(r)
	if raw != "" && s.tokens != nil {
		if p, ok := s.authenticateToken(r, raw); ok {
			return p, true
		}
		return nil, false
	}
	if sess := s.Session(r); sess != nil {
		if p := s.principalFromSession(r.Context(), sess); p != nil {
			return p, true
		}
		return nil, false
	}
	return nil, false
}

func (s *Service) principalFromSession(ctx context.Context, sess *store.Session) *Principal {
	if sess.UserID == "" {
		return &Principal{Role: RoleAdmin, Method: AuthSession, Session: sess}
	}
	if s.users == nil {
		return nil
	}
	u, err := s.users.Get(ctx, sess.UserID)
	if err != nil {
		return nil
	}
	role := Role(u.Role)
	if role != RoleAdmin && role != RoleOperator && role != RoleViewer {
		role = RoleViewer
	}
	sess.Username, sess.Role = u.Username, u.Role
	return &Principal{Role: role, Method: AuthSession, Session: sess}
}

func (s *Service) authenticateToken(r *http.Request, raw string) (*Principal, bool) {
	if !strings.HasPrefix(raw, "cd_") || len(raw) < 20 {
		return nil, false
	}
	tok, err := s.tokens.GetByHash(r.Context(), s.hash(raw))
	if err != nil {
		return nil, false
	}
	now := time.Now().UTC()
	if tok.RevokedAt != nil {
		return nil, false
	}
	if tok.ExpiresAt != nil && now.After(*tok.ExpiresAt) {
		return nil, false
	}
	_ = s.tokens.Touch(r.Context(), tok.ID)
	role := Role(tok.Role)
	if role != RoleAdmin && role != RoleOperator && role != RoleViewer {
		role = RoleViewer
	}
	return &Principal{
		Role: role, Method: AuthToken, TokenID: tok.ID, TokenName: tok.Name, TokenPrefix: tok.TokenPrefix,
	}, true
}

// Middleware requires a valid session or API token. CSRF applies to cookie sessions only.
func (s *Service) Middleware(onUnauthorized func(w http.ResponseWriter, code int, msg string)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, ok := s.Authenticate(r)
			if !ok {
				onUnauthorized(w, http.StatusUnauthorized, "authentication required")
				return
			}
			if p.Method == AuthSession && !CSRFOK(r) {
				onUnauthorized(w, http.StatusForbidden, "missing CSRF header")
				return
			}
			next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), p)))
		})
	}
}

func CSRFOK(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	return r.Header.Get(CSRFHeader) == CSRFValue
}

// ClientIP returns the remote IP (chi's RealIP middleware rewrites RemoteAddr when behind a proxy).
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return host
}

// ---------------------------------------------------------------- limiter

type Limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string][]time.Time
	now    func() time.Time
}

func NewLimiter(max int, window time.Duration) *Limiter {
	return &Limiter{max: max, window: window, hits: map[string][]time.Time{}, now: time.Now}
}

func (l *Limiter) prune(ip string) []time.Time {
	cut := l.now().Add(-l.window)
	h := l.hits[ip]
	i := 0
	for i < len(h) && h[i].Before(cut) {
		i++
	}
	h = h[i:]
	if len(h) == 0 {
		delete(l.hits, ip)
	} else {
		l.hits[ip] = h
	}
	return h
}

// Blocked returns how long the IP must wait, or 0.
func (l *Limiter) Blocked(ip string) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	h := l.prune(ip)
	if len(h) >= l.max {
		return h[0].Add(l.window).Sub(l.now())
	}
	return 0
}

func (l *Limiter) Fail(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.prune(ip)
	l.hits[ip] = append(l.hits[ip], l.now())
}

func (l *Limiter) Reset(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, ip)
}

// Sweep removes stale entries; call periodically.
func (l *Limiter) Sweep() {
	l.mu.Lock()
	defer l.mu.Unlock()
	for ip := range l.hits {
		l.prune(ip)
	}
}

func (s *Service) SweepLimiter() { s.limiter.Sweep() }
