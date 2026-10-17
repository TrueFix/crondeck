// Package notify delivers alerts when jobs fail (after retries are exhausted).
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/honk/crondeck/internal/store"
)

const settingsKey = "notifications"

// Config is persisted in the settings table (JSON).
type Config struct {
	Enabled           bool     `json:"enabled"`
	DedupeMinutes     int      `json:"dedupe_minutes"`
	WebhookURL        string   `json:"webhook_url"`
	SlackWebhookURL   string   `json:"slack_webhook_url"`
	DiscordWebhookURL string   `json:"discord_webhook_url"`
	EmailEnabled      bool     `json:"email_enabled"`
	EmailTo           []string `json:"email_to"`
	EmailFrom         string   `json:"email_from"`
	SMTPHost          string   `json:"smtp_host"`
	SMTPPort          int      `json:"smtp_port"`
	SMTPUsername      string   `json:"smtp_username"`
	SMTPPassword      string   `json:"smtp_password"`
	SMTPTLS           bool     `json:"smtp_tls"`
}

// Service loads notification settings and POSTs failure payloads.
type Service struct {
	st         *store.SettingsStore
	envWebhook string
	client     *http.Client
	log        *slog.Logger
	lastAlert  sync.Map // jobID -> time.Time
}

func New(st *store.SettingsStore, envWebhook string, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{
		st:         st,
		envWebhook: strings.TrimSpace(envWebhook),
		client:     &http.Client{Timeout: 15 * time.Second},
		log:        log,
	}
}

func (s *Service) Load(ctx context.Context) (Config, error) {
	raw, err := s.st.Get(ctx, settingsKey)
	cfg := Config{DedupeMinutes: 15}
	if err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			return Config{}, err
		}
	} else if raw != "" {
		if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
			return Config{}, fmt.Errorf("parse notifications settings: %w", err)
		}
	}
	if cfg.DedupeMinutes <= 0 {
		cfg.DedupeMinutes = 15
	}
	if cfg.WebhookURL == "" && s.envWebhook != "" {
		cfg.WebhookURL = s.envWebhook
		if !cfg.Enabled {
			cfg.Enabled = true
		}
	}
	return cfg, nil
}

func (s *Service) Save(ctx context.Context, cfg Config) error {
	b, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	return s.st.Set(ctx, settingsKey, string(b))
}

func (s *Service) RunFailed(ctx context.Context, job *store.Job, run *store.Run) {
	cfg, err := s.Load(ctx)
	if err != nil {
		s.log.Warn("notifications load failed", "err", err)
		return
	}
	if !cfg.Enabled {
		return
	}
	if run.Status != store.StatusFailed && run.Status != store.StatusTimeout {
		return
	}
	if s.shouldDedupe(job.ID, cfg.DedupeMinutes) {
		s.log.Debug("notification deduped", "job", job.ID)
		return
	}
	s.deliver(ctx, cfg, job, run)
	s.lastAlert.Store(job.ID, time.Now())
}

func (s *Service) shouldDedupe(jobID string, minutes int) bool {
	if minutes <= 0 {
		return false
	}
	if v, ok := s.lastAlert.Load(jobID); ok {
		if t, ok := v.(time.Time); ok && time.Since(t) < time.Duration(minutes)*time.Minute {
			return true
		}
	}
	return false
}

func (s *Service) SendTest(ctx context.Context) error {
	cfg, err := s.Load(ctx)
	if err != nil {
		return err
	}
	if !cfg.hasTarget() {
		return fmt.Errorf("configure at least one notification channel first")
	}
	job := &store.Job{ID: "test", Name: "Notification test", Type: store.TypeHTTP}
	run := &store.Run{
		ID: "test-run", Status: store.StatusFailed, Trigger: store.TriggerManual,
		Attempt: 1, Error: "This is a test alert from CronDeck settings.",
	}
	d := int64(0)
	run.DurationMs = &d
	s.deliver(ctx, cfg, job, run)
	return nil
}

func (s *Service) deliver(ctx context.Context, cfg Config, job *store.Job, run *store.Run) {
	msg := formatMessage(job, run)
	subject := fmt.Sprintf("[CronDeck] %s failed (%s)", job.Name, run.Status)
	payload := map[string]any{
		"event": "run.failed",
		"job": map[string]any{
			"id": job.ID, "name": job.Name, "type": job.Type,
		},
		"run": map[string]any{
			"id": run.ID, "status": run.Status, "trigger": run.Trigger,
			"attempt": run.Attempt, "error": run.Error, "duration_ms": run.DurationMs,
		},
	}
	if cfg.WebhookURL != "" {
		s.postJSON(ctx, cfg.WebhookURL, payload)
	}
	if cfg.SlackWebhookURL != "" {
		s.postJSON(ctx, cfg.SlackWebhookURL, map[string]string{"text": msg})
	}
	if cfg.DiscordWebhookURL != "" {
		color := 0xE5484D
		s.postJSON(ctx, cfg.DiscordWebhookURL, map[string]any{
			"embeds": []map[string]any{{
				"title":       "CronDeck job failed",
				"description": msg,
				"color":       color,
			}},
		})
	}
	if cfg.EmailEnabled && cfg.SMTPHost != "" && len(cfg.EmailTo) > 0 {
		if err := s.sendEmail(ctx, cfg, subject, msg); err != nil {
			s.log.Warn("email notification failed", "err", err)
		}
	}
}

func (c Config) hasTarget() bool {
	if c.EmailEnabled && c.SMTPHost != "" && len(c.EmailTo) > 0 {
		return true
	}
	return strings.TrimSpace(c.WebhookURL) != "" ||
		strings.TrimSpace(c.SlackWebhookURL) != "" ||
		strings.TrimSpace(c.DiscordWebhookURL) != ""
}

func formatMessage(job *store.Job, run *store.Run) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s (%s) — %s\n", job.Name, job.Type, run.Status)
	fmt.Fprintf(&b, "Run %s · attempt %d · trigger %s\n", run.ID, run.Attempt, run.Trigger)
	if run.Error != "" {
		fmt.Fprintf(&b, "Error: %s", truncate(run.Error, 500))
	}
	return b.String()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func (s *Service) postJSON(ctx context.Context, rawURL string, body any) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Scheme != "https" && u.Scheme != "http" {
		s.log.Warn("notification skipped: invalid webhook URL")
		return
	}
	b, err := json.Marshal(body)
	if err != nil {
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(b))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "CronDeck/1.0 notifications")
	res, err := s.client.Do(req)
	if err != nil {
		s.log.Warn("notification delivery failed", "host", u.Host, "err", err)
		return
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	if res.StatusCode >= 300 {
		s.log.Warn("notification rejected", "host", u.Host, "status", res.StatusCode)
	}
}

// Redact returns a copy with secrets masked for API responses.
func Redact(c Config) Config {
	out := c
	if out.WebhookURL != "" {
		out.WebhookURL = maskURL(out.WebhookURL)
	}
	if out.SlackWebhookURL != "" {
		out.SlackWebhookURL = maskURL(out.SlackWebhookURL)
	}
	if out.DiscordWebhookURL != "" {
		out.DiscordWebhookURL = maskURL(out.DiscordWebhookURL)
	}
	if out.SMTPPassword != "" {
		out.SMTPPassword = maskToken
	}
	return out
}

const maskToken = "••••••••"

func maskURL(raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return maskToken
	}
	if u.Path == "" || u.Path == "/" {
		return u.Scheme + "://" + u.Host + "/…"
	}
	return u.Scheme + "://" + u.Host + "/…"
}

// MergeIncoming applies PUT semantics: empty string clears, mask token keeps stored value.
func MergeIncoming(in, stored Config) Config {
	out := in
	out.WebhookURL = mergeSecret(in.WebhookURL, stored.WebhookURL)
	out.SlackWebhookURL = mergeSecret(in.SlackWebhookURL, stored.SlackWebhookURL)
	out.DiscordWebhookURL = mergeSecret(in.DiscordWebhookURL, stored.DiscordWebhookURL)
	out.SMTPPassword = mergeSecret(in.SMTPPassword, stored.SMTPPassword)
	if len(in.EmailTo) == 0 && len(stored.EmailTo) > 0 {
		out.EmailTo = stored.EmailTo
	}
	return out
}

func mergeSecret(incoming, stored string) string {
	incoming = strings.TrimSpace(incoming)
	if incoming == "" {
		return ""
	}
	if incoming == maskToken || strings.HasSuffix(incoming, "/…") || strings.HasSuffix(incoming, "/...") {
		return stored
	}
	return incoming
}
