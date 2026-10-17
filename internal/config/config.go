// Package config loads and validates runtime configuration from the environment.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	AdminKey          string
	SessionSecret     string
	Port              int
	DBPath            string
	Env               string
	DefaultTZ         string
	MaxConcurrentRuns int
	MaxOutputBytes    int
	RunRetentionDays  int
	AllowShell        bool
	AllowSQL          bool
	SessionTTL        time.Duration
	CORSOrigin        string
	TrustProxy        bool
	CookieSecure      bool
	MetricsEnabled    bool
	AlertWebhookURL   string
}

func (c *Config) IsProd() bool { return c.Env == "production" }

// Load reads a .env file if present (non-fatal) and then the process environment.
func Load() (*Config, error) {
	_ = godotenv.Load()

	c := &Config{
		AdminKey:          strings.TrimSpace(os.Getenv("ADMIN_KEY")),
		SessionSecret:     os.Getenv("SESSION_SECRET"),
		Port:              envInt("PORT", 8080),
		DBPath:            envStr("DB_PATH", "./data/crondeck.db"),
		Env:               envStr("APP_ENV", "development"),
		DefaultTZ:         envStr("TZ_DEFAULT", "UTC"),
		MaxConcurrentRuns: envInt("MAX_CONCURRENT_RUNS", 10),
		MaxOutputBytes:    envInt("MAX_OUTPUT_BYTES", 65536),
		RunRetentionDays:  envInt("RUN_RETENTION_DAYS", 30),
		AllowShell:        envBool("ALLOW_SHELL", true),
		AllowSQL:          envBool("ALLOW_SQL", true),
		SessionTTL:        time.Duration(envInt("SESSION_TTL_HOURS", 24)) * time.Hour,
		CORSOrigin:        os.Getenv("CORS_ORIGIN"),
		TrustProxy:        envBool("TRUST_PROXY", false),
		MetricsEnabled:    envBool("METRICS_ENABLED", true),
		AlertWebhookURL:   strings.TrimSpace(os.Getenv("ALERT_WEBHOOK_URL")),
	}
	// Secure cookies by default in production; override for plain-HTTP LAN setups.
	c.CookieSecure = envBool("COOKIE_SECURE", c.Env == "production")
	if err := c.Validate(); err != nil {
		return nil, err
	}
	if c.SessionSecret == "" {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		c.SessionSecret = hex.EncodeToString(b)
	}
	return c, nil
}

func (c *Config) Validate() error {
	if c.AdminKey == "" {
		return errors.New("ADMIN_KEY is required (generate one with: openssl rand -hex 32)")
	}
	if len(c.AdminKey) < 32 {
		return fmt.Errorf("ADMIN_KEY must be at least 32 characters (got %d)", len(c.AdminKey))
	}
	if _, err := time.LoadLocation(c.DefaultTZ); err != nil {
		return fmt.Errorf("TZ_DEFAULT invalid: %w", err)
	}
	if c.MaxConcurrentRuns < 1 {
		return errors.New("MAX_CONCURRENT_RUNS must be >= 1")
	}
	if c.MaxOutputBytes < 1024 {
		c.MaxOutputBytes = 1024
	}
	if c.Env != "production" && c.Env != "development" {
		return errors.New("APP_ENV must be 'development' or 'production'")
	}
	return nil
}

func envStr(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envBool(k string, def bool) bool {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}
