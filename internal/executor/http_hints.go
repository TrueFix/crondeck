package executor

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

const (
	maxHintPaths   = 48
	maxHintDepth   = 8
	maxHintPreview = 120
)

// ExtractHint suggests a variable name and source path for the flow editor.
type ExtractHint struct {
	Path               string `json:"path"`
	VariableSuggestion string `json:"variable_suggestion"`
	PreviewValue       string `json:"preview_value"`
}

// CollectExtractHints lists mappable paths from a probe response (body + headers).
func CollectExtractHints(body []byte, headers http.Header) []ExtractHint {
	var hints []ExtractHint
	if len(body) > 0 {
		hints = append(hints, ExtractHint{
			Path:               "body.data",
			VariableSuggestion: "body",
			PreviewValue:       truncatePreview(string(body)),
		})
	}
	if json.Valid(body) {
		var v any
		if json.Unmarshal(body, &v) == nil {
			walkJSONHints("", v, 0, &hints)
		}
	}
	if headers != nil {
		for k := range headers {
			path := "headers." + k
			val, _ := lookupExtractValue(body, headers, path)
			sug := suggestVarName(k)
			if sug == "" {
				sug = "header"
			}
			hints = append(hints, ExtractHint{
				Path:               path,
				VariableSuggestion: sug,
				PreviewValue:       truncatePreview(val),
			})
		}
	}
	if len(hints) > maxHintPaths {
		hints = hints[:maxHintPaths]
	}
	return hints
}

func walkJSONHints(prefix string, v any, depth int, hints *[]ExtractHint) {
	if len(*hints) >= maxHintPaths || depth > maxHintDepth {
		return
	}
	switch t := v.(type) {
	case map[string]any:
		for k, child := range t {
			path := k
			if prefix != "" {
				path = prefix + "." + k
			}
			switch child.(type) {
			case map[string]any, []any:
				walkJSONHints(path, child, depth+1, hints)
			default:
				full := "body.json." + path
				*hints = append(*hints, ExtractHint{
					Path:               full,
					VariableSuggestion: suggestVarName(path),
					PreviewValue:       truncatePreview(stringifyJSONValue(child)),
				})
			}
		}
	case []any:
		for i, child := range t {
			if i > 20 {
				break
			}
			path := strconv.Itoa(i)
			if prefix != "" {
				path = prefix + "." + strconv.Itoa(i)
			}
			switch child.(type) {
			case map[string]any, []any:
				walkJSONHints(path, child, depth+1, hints)
			default:
				full := "body.json." + path
				*hints = append(*hints, ExtractHint{
					Path:               full,
					VariableSuggestion: suggestVarName(prefix),
					PreviewValue:       truncatePreview(stringifyJSONValue(child)),
				})
			}
		}
	}
}

func suggestVarName(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	parts := strings.Split(path, ".")
	for i := len(parts) - 1; i >= 0; i-- {
		p := parts[i]
		if varNameRe.MatchString(p) {
			return p
		}
	}
	raw := strings.ReplaceAll(parts[len(parts)-1], "-", "_")
	var b strings.Builder
	for i, r := range raw {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '_' || (r >= '0' && r <= '9' && i > 0) {
			if i == 0 && r >= '0' && r <= '9' {
				b.WriteByte('_')
			}
			b.WriteRune(r)
		}
	}
	s := b.String()
	if s != "" && varNameRe.MatchString(s) {
		return s
	}
	return ""
}

func truncatePreview(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) <= maxHintPreview {
		return s
	}
	return s[:maxHintPreview] + "…"
}
