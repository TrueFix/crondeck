package notify

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
)

func (s *Service) sendEmail(ctx context.Context, cfg Config, subject, body string) error {
	if cfg.SMTPHost == "" || len(cfg.EmailTo) == 0 {
		return nil
	}
	from := cfg.EmailFrom
	if from == "" {
		from = cfg.SMTPUsername
	}
	if from == "" {
		from = "crondeck@localhost"
	}
	port := cfg.SMTPPort
	if port == 0 {
		port = 587
	}
	addr := fmt.Sprintf("%s:%d", cfg.SMTPHost, port)
	msg := buildMIME(from, cfg.EmailTo, subject, body)

	var auth smtp.Auth
	if cfg.SMTPUsername != "" {
		auth = smtp.PlainAuth("", cfg.SMTPUsername, cfg.SMTPPassword, cfg.SMTPHost)
	}

	if cfg.SMTPTLS {
		return sendMailTLS(ctx, addr, auth, from, cfg.EmailTo, msg)
	}
	return smtp.SendMail(addr, auth, from, cfg.EmailTo, []byte(msg))
}

func buildMIME(from string, to []string, subject, body string) string {
	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + strings.Join(to, ", ") + "\r\n")
	b.WriteString("Subject: " + subject + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n\r\n")
	b.WriteString(body)
	return b.String()
}

func sendMailTLS(ctx context.Context, addr string, auth smtp.Auth, from string, to []string, msg string) error {
	host, _, _ := net.SplitHostPort(addr)
	conn, err := (&tls.Dialer{}).DialContext(ctx, "tcp", addr)
	if err != nil {
		return err
	}
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()
	if auth != nil {
		if err := c.Auth(auth); err != nil {
			return err
		}
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	for _, rcpt := range to {
		if err := c.Rcpt(rcpt); err != nil {
			return err
		}
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write([]byte(msg)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}
