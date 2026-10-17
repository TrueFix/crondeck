package api

import (
	"encoding/json"
	"strings"
)

// Mask is shown instead of secret values. Sending it back unchanged on update keeps the stored value.
const Mask = "••••••••"

var sensitiveWords = []string{"authorization", "cookie", "token", "secret", "password", "passwd", "api-key", "apikey", "api_key", "private"}

func isSensitive(name string) bool {
	n := strings.ToLower(name)
	for _, w := range sensitiveWords {
		if strings.Contains(n, w) {
			return true
		}
	}
	return false
}

// mapField returns which config key holds a name->value map of possibly sensitive entries.
func mapField(typ string) string {
	switch typ {
	case "http":
		return "headers"
	case "sql":
		return "dsn"
	default:
		return "env"
	}
}

// redact masks sensitive header / env values in a job config for API responses.
func redact(typ string, cfg json.RawMessage) json.RawMessage {
	var m map[string]any
	if json.Unmarshal(cfg, &m) != nil {
		return cfg
	}
	if typ == "sql" {
		if dsn, ok := m["dsn"].(string); ok && dsn != "" {
			m["dsn"] = Mask
			out, _ := json.Marshal(m)
			return out
		}
		return cfg
	}
	field := mapField(typ)
	inner, ok := m[field].(map[string]any)
	if !ok {
		return cfg
	}
	changed := false
	for k, v := range inner {
		if s, ok := v.(string); ok && s != "" && isSensitive(k) {
			inner[k] = Mask
			changed = true
		}
	}
	if !changed {
		return cfg
	}
	out, err := json.Marshal(m)
	if err != nil {
		return cfg
	}
	return out
}

// unredact replaces Mask placeholders in an incoming config with the stored values.
func unredact(typ string, incoming, stored json.RawMessage) json.RawMessage {
	var in, old map[string]any
	if json.Unmarshal(incoming, &in) != nil || json.Unmarshal(stored, &old) != nil {
		return incoming
	}
	if typ == "sql" {
		if s, ok := in["dsn"].(string); ok && s == Mask {
			if ov, ok := old["dsn"]; ok {
				in["dsn"] = ov
			}
			out, _ := json.Marshal(in)
			return out
		}
		return incoming
	}
	field := mapField(typ)
	inInner, ok1 := in[field].(map[string]any)
	oldInner, ok2 := old[field].(map[string]any)
	if !ok1 || !ok2 {
		return incoming
	}
	changed := false
	for k, v := range inInner {
		if s, ok := v.(string); ok && s == Mask {
			if ov, ok := oldInner[k]; ok {
				inInner[k] = ov
			} else {
				delete(inInner, k)
			}
			changed = true
		}
	}
	if !changed {
		return incoming
	}
	out, err := json.Marshal(in)
	if err != nil {
		return incoming
	}
	return out
}
