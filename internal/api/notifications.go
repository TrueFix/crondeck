package api

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/honk/crondeck/internal/notify"
)

func (s *Server) getNotifications(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.Notify.Load(r.Context())
	if err != nil {
		s.internalError(w, err)
		return
	}
	writeJSON(w, 200, notify.Redact(cfg))
}

type notificationsBody struct {
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

func (s *Server) putNotifications(w http.ResponseWriter, r *http.Request) {
	var body notificationsBody
	if !decode(w, r, &body) {
		return
	}
	stored, err := s.Notify.Load(r.Context())
	if err != nil {
		s.internalError(w, err)
		return
	}
	in := notify.Config{
		Enabled: body.Enabled, DedupeMinutes: body.DedupeMinutes,
		WebhookURL: body.WebhookURL, SlackWebhookURL: body.SlackWebhookURL, DiscordWebhookURL: body.DiscordWebhookURL,
		EmailEnabled: body.EmailEnabled, EmailTo: body.EmailTo, EmailFrom: body.EmailFrom,
		SMTPHost: body.SMTPHost, SMTPPort: body.SMTPPort, SMTPUsername: body.SMTPUsername,
		SMTPPassword: body.SMTPPassword, SMTPTLS: body.SMTPTLS,
	}
	merged := notify.MergeIncoming(in, stored)
	if err := validateNotifyConfig(merged); err != nil {
		writeError(w, 400, "validation", err.Error(), nil)
		return
	}
	if err := s.Notify.Save(r.Context(), merged); err != nil {
		s.internalError(w, err)
		return
	}
	s.audit_(r, "settings.notifications.update", "", nil)
	writeJSON(w, 200, notify.Redact(merged))
}

func (s *Server) testNotifications(w http.ResponseWriter, r *http.Request) {
	if err := s.Notify.SendTest(r.Context()); err != nil {
		writeError(w, 400, "validation", err.Error(), nil)
		return
	}
	s.audit_(r, "settings.notifications.test", "", nil)
	writeJSON(w, 200, map[string]string{"status": "sent"})
}

func validateNotifyConfig(c notify.Config) error {
	if err := validateNotifyURLs(c); err != nil {
		return err
	}
	if c.EmailEnabled && c.SMTPHost == "" {
		return errors.New("smtp_host is required when email is enabled")
	}
	if c.DedupeMinutes < 0 || c.DedupeMinutes > 1440 {
		return errors.New("dedupe_minutes must be between 0 and 1440")
	}
	return nil
}

func validateNotifyURLs(c notify.Config) error {
	for _, pair := range []struct {
		label string
		raw   string
	}{
		{"webhook_url", c.WebhookURL},
		{"slack_webhook_url", c.SlackWebhookURL},
		{"discord_webhook_url", c.DiscordWebhookURL},
	} {
		if strings.TrimSpace(pair.raw) == "" {
			continue
		}
		u, err := url.Parse(strings.TrimSpace(pair.raw))
		if err != nil {
			return errors.New(pair.label + " is not a valid URL")
		}
		if u.Scheme != "https" && u.Scheme != "http" {
			return errors.New(pair.label + " must use http or https")
		}
		if u.Host == "" {
			return errors.New(pair.label + " is missing a host")
		}
	}
	return nil
}
