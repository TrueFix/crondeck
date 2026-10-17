package executor

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	bodyContentAuto = "auto"
	bodyContentJSON = "json"
	bodyContentForm = "form"
	bodyContentText = "text"
	bodyContentNone = "none"
)

func normalizeBodyContentType(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", bodyContentAuto:
		return bodyContentAuto
	case bodyContentJSON, bodyContentForm, bodyContentText, bodyContentNone:
		return strings.ToLower(strings.TrimSpace(s))
	default:
		return s
	}
}

func validateBodyContentType(s string) error {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" || s == bodyContentAuto {
		return nil
	}
	switch s {
	case bodyContentJSON, bodyContentForm, bodyContentText, bodyContentNone:
		return nil
	default:
		return fmt.Errorf("invalid body_content_type %q (want auto, json, form, text, or none)", s)
	}
}

func headersHaveContentType(headers map[string]string) bool {
	for k := range headers {
		if strings.EqualFold(k, "Content-Type") {
			return true
		}
	}
	return false
}

// defaultContentType picks Content-Type when the request has a body and no Content-Type header.
func defaultContentType(bodyType, body string) string {
	switch normalizeBodyContentType(bodyType) {
	case bodyContentNone:
		return ""
	case bodyContentJSON:
		return "application/json"
	case bodyContentForm:
		return "application/x-www-form-urlencoded"
	case bodyContentText:
		return "text/plain; charset=utf-8"
	case bodyContentAuto:
		if json.Valid([]byte(body)) {
			return "application/json"
		}
		return "text/plain; charset=utf-8"
	default:
		return ""
	}
}
