package store

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
)

var ErrNotFound = errors.New("not found")

type Store struct {
	DB       *sql.DB
	Jobs     *JobStore
	Runs     *RunStore
	Sessions *SessionStore
	Audit    *AuditStore
	Settings *SettingsStore
	Tokens   *TokenStore
	Users    *UserStore
}

func New(db *sql.DB) *Store {
	return &Store{
		DB:       db,
		Jobs:     &JobStore{db: db},
		Runs:     &RunStore{db: db},
		Sessions: &SessionStore{db: db},
		Audit:    &AuditStore{db: db},
		Settings: &SettingsStore{db: db},
		Tokens:   &TokenStore{db: db},
		Users:    &UserStore{db: db},
	}
}

var (
	idMu      sync.Mutex
	idEntropy = ulid.Monotonic(rand.Reader, 0)
)

// NewID returns a new lowercase-free, sortable ULID.
func NewID() string {
	idMu.Lock()
	defer idMu.Unlock()
	return ulid.MustNew(ulid.Timestamp(time.Now()), idEntropy).String()
}
