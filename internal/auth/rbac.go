package auth

import (
	"context"

	"github.com/honk/crondeck/internal/store"
)

type Role string

const (
	RoleAdmin    Role = "admin"
	RoleOperator Role = "operator"
	RoleViewer   Role = "viewer"
)

type Scope string

const (
	ScopeJobsRead       Scope = "jobs:read"
	ScopeJobsWrite      Scope = "jobs:write"
	ScopeJobsRun        Scope = "jobs:run"
	ScopeRunsRead       Scope = "runs:read"
	ScopeRunsWrite      Scope = "runs:write"
	ScopeStatsRead      Scope = "stats:read"
	ScopeSettingsRead   Scope = "settings:read"
	ScopeSettingsWrite  Scope = "settings:write"
	ScopeSystem         Scope = "system:write"
	ScopeAuditRead      Scope = "audit:read"
	ScopeTokensManage   Scope = "tokens:write"
)

var roleScopes = map[Role][]Scope{
	RoleAdmin: {
		ScopeJobsRead, ScopeJobsWrite, ScopeJobsRun,
		ScopeRunsRead, ScopeRunsWrite,
		ScopeStatsRead,
		ScopeSettingsRead, ScopeSettingsWrite,
		ScopeSystem, ScopeAuditRead, ScopeTokensManage,
	},
	RoleOperator: {
		ScopeJobsRead, ScopeJobsWrite, ScopeJobsRun,
		ScopeRunsRead, ScopeRunsWrite,
		ScopeStatsRead,
	},
	RoleViewer: {
		ScopeJobsRead, ScopeRunsRead, ScopeStatsRead,
	},
}

func (r Role) Allows(scope Scope) bool {
	for _, s := range roleScopes[r] {
		if s == scope {
			return true
		}
	}
	return false
}

type AuthMethod string

const (
	AuthSession AuthMethod = "session"
	AuthToken   AuthMethod = "token"
)

// Principal is the authenticated caller (browser session or API token).
type Principal struct {
	Role       Role
	Method     AuthMethod
	Session    *store.Session
	TokenID    string
	TokenName  string
	TokenPrefix string
}

func (p *Principal) Allows(scope Scope) bool {
	if p == nil {
		return false
	}
	return p.Role.Allows(scope)
}

type principalKey struct{}

func WithPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

func PrincipalFrom(ctx context.Context) *Principal {
	p, _ := ctx.Value(principalKey{}).(*Principal)
	return p
}

// FromContext returns the session when the caller used cookie auth (nil for tokens).
func FromContext(ctx context.Context) *store.Session {
	p := PrincipalFrom(ctx)
	if p == nil {
		return nil
	}
	return p.Session
}
