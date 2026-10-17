package executor

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const maxHTTPSteps = 10

var tplVar = regexp.MustCompile(`\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}`)

type HTTPStep struct {
	Name           string            `json:"name,omitempty"`
	URL            string            `json:"url"`
	Method         string            `json:"method"`
	Headers        map[string]string `json:"headers"`
	Body             string            `json:"body"`
	BodyContentType  string            `json:"body_content_type,omitempty"`
	ExpectedStatus   []int             `json:"expected_status"`
	// Extract maps variable name -> source path:
	//   body.data — entire response body as string
	//   body.json.<path> — JSON field in the body (e.g. body.json.id)
	//   headers.<name> — response header (e.g. headers.x-csrf)
	// Legacy: bare paths (access_token, data.id) are treated as body.json paths.
	Extract map[string]string `json:"extract,omitempty"`
	// ExtractMissing maps variable name -> behavior when the path is not found:
	//   "fail" (default) — the step fails
	//   "empty" — the variable is set to an empty string
	//   "null"  — the variable is set to the literal string "null"
	ExtractMissing map[string]string `json:"extract_missing,omitempty"`
}

// Behaviors for a missing extract path.
const (
	missingFail  = "fail"
	missingEmpty = "empty"
	missingNull  = "null"
)

func normalizeMissingPolicy(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case missingEmpty:
		return missingEmpty
	case missingNull:
		return missingNull
	default:
		return missingFail
	}
}

func validateHTTPStep(s *HTTPStep, idx int) error {
	label := fmt.Sprintf("step %d", idx+1)
	if strings.TrimSpace(s.Name) != "" {
		label = fmt.Sprintf("step %q", s.Name)
	}
	s.Method = strings.ToUpper(strings.TrimSpace(s.Method))
	if s.Method == "" {
		s.Method = "GET"
	}
	if !allowedMethods[s.Method] {
		return fmt.Errorf("%s: unsupported method %q", label, s.Method)
	}
	if strings.TrimSpace(s.URL) == "" {
		return fmt.Errorf("%s: url is required", label)
	}
	if !strings.Contains(s.URL, "{{") {
		if err := requireAbsURL(s.URL); err != nil {
			return fmt.Errorf("%s: %w", label, err)
		}
	}
	for _, code := range s.ExpectedStatus {
		if code < 100 || code > 599 {
			return fmt.Errorf("%s: invalid expected status %d", label, code)
		}
	}
	for k := range s.Headers {
		if strings.TrimSpace(k) == "" || strings.ContainsAny(k, " \r\n:") {
			return fmt.Errorf("%s: invalid header name %q", label, k)
		}
	}
	if err := validateBodyContentType(s.BodyContentType); err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	for varName, path := range s.Extract {
		if strings.TrimSpace(varName) == "" || strings.TrimSpace(path) == "" {
			return fmt.Errorf("%s: extract keys and paths must be non-empty", label)
		}
		if !varNameRe.MatchString(strings.TrimSpace(varName)) {
			return fmt.Errorf("%s: extract variable %q must match [a-zA-Z_][a-zA-Z0-9_]*", label, varName)
		}
		if err := validateExtractPath(path); err != nil {
			return fmt.Errorf("%s: extract %q: %w", label, varName, err)
		}
	}
	for varName, policy := range s.ExtractMissing {
		switch strings.ToLower(strings.TrimSpace(policy)) {
		case missingFail, missingEmpty, missingNull:
		default:
			return fmt.Errorf("%s: extract %q: invalid missing policy %q (want fail, empty, or null)", label, varName, policy)
		}
	}
	return nil
}

var varNameRe = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

func validateExtractPath(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("empty path")
	}
	lower := strings.ToLower(path)
	switch {
	case lower == "body.data":
		return nil
	case strings.HasPrefix(lower, "body.json."):
		if len(path) <= len("body.json.") {
			return fmt.Errorf("body.json path requires a field after body.json.")
		}
		return nil
	case strings.HasPrefix(lower, "headers."):
		if len(path) <= len("headers.") {
			return fmt.Errorf("headers path requires a name after headers.")
		}
		return nil
	default:
		// Legacy JSON path in response body.
		return nil
	}
}

func validateHTTPSteps(steps []HTTPStep) error {
	if len(steps) == 0 {
		return nil
	}
	if len(steps) > maxHTTPSteps {
		return fmt.Errorf("at most %d http steps allowed", maxHTTPSteps)
	}
	for i := range steps {
		if err := validateHTTPStep(&steps[i], i); err != nil {
			return err
		}
	}
	return nil
}

func requireAbsURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	if u.Scheme != "http" && u.Scheme != "https" || u.Host == "" {
		return fmt.Errorf("url must be an absolute http(s) URL")
	}
	return nil
}

func interpolate(s string, vars map[string]string) string {
	if s == "" || len(vars) == 0 {
		return s
	}
	return tplVar.ReplaceAllStringFunc(s, func(m string) string {
		key := m[2 : len(m)-2]
		if v, ok := vars[key]; ok {
			return v
		}
		return m
	})
}

func missingTemplateVars(s string, vars map[string]string) []string {
	var missing []string
	for _, m := range tplVar.FindAllStringSubmatch(s, -1) {
		key := m[1]
		if _, ok := vars[key]; !ok {
			missing = append(missing, key)
		}
	}
	return missing
}

func collectMissingVars(step HTTPStep, vars map[string]string) []string {
	var all []string
	all = append(all, missingTemplateVars(step.URL, vars)...)
	all = append(all, missingTemplateVars(step.Body, vars)...)
	for _, v := range step.Headers {
		all = append(all, missingTemplateVars(v, vars)...)
	}
	seen := map[string]bool{}
	var out []string
	for _, k := range all {
		if !seen[k] {
			seen[k] = true
			out = append(out, k)
		}
	}
	return out
}

func jsonPathLookup(raw json.RawMessage, path string) (string, error) {
	path = strings.TrimSpace(path)
	path = strings.TrimPrefix(path, "$.")
	path = strings.TrimPrefix(path, "$")
	if path == "" {
		return "", fmt.Errorf("empty json path")
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return "", fmt.Errorf("response is not json: %w", err)
	}
	cur := v
	parts := strings.Split(path, ".")
	for _, p := range parts {
		if p == "" {
			continue
		}
		switch node := cur.(type) {
		case map[string]any:
			nxt, ok := node[p]
			if !ok {
				return "", fmt.Errorf("path %q: key %q not found", path, p)
			}
			cur = nxt
		case []any:
			i, err := strconv.Atoi(p)
			if err != nil || i < 0 || i >= len(node) {
				return "", fmt.Errorf("path %q: invalid index %q", path, p)
			}
			cur = node[i]
		default:
			return "", fmt.Errorf("path %q: cannot descend into %T", path, cur)
		}
	}
	return stringifyJSONValue(cur), nil
}

func stringifyJSONValue(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(t)
	case nil:
		return ""
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}

func lookupExtractValue(body []byte, headers http.Header, path string) (string, error) {
	path = strings.TrimSpace(path)
	lower := strings.ToLower(path)
	switch {
	case lower == "body.data":
		return string(body), nil
	case strings.HasPrefix(lower, "body.json."):
		// Preserve case in JSON keys after the prefix.
		idx := strings.Index(strings.ToLower(path), "body.json.")
		jsonPath := path[idx+len("body.json."):]
		return jsonPathLookup(body, jsonPath)
	case strings.HasPrefix(lower, "headers."):
		idx := strings.Index(strings.ToLower(path), "headers.")
		name := path[idx+len("headers."):]
		val, ok := headerValue(headers, name)
		if !ok {
			return "", fmt.Errorf("header %q not found", name)
		}
		return val, nil
	default:
		return jsonPathLookup(body, path)
	}
}

func headerValue(headers http.Header, name string) (string, bool) {
	if headers == nil {
		return "", false
	}
	for k, vals := range headers {
		if strings.EqualFold(k, name) && len(vals) > 0 {
			return vals[0], true
		}
	}
	return "", false
}

func applyExtract(body []byte, headers http.Header, rules map[string]string, missing map[string]string, vars map[string]string) error {
	if len(rules) == 0 {
		return nil
	}
	for name, path := range rules {
		val, err := lookupExtractValue(body, headers, path)
		if err != nil {
			switch normalizeMissingPolicy(missing[name]) {
			case missingEmpty:
				vars[name] = ""
				continue
			case missingNull:
				vars[name] = "null"
				continue
			default:
				return fmt.Errorf("extract %q: %w", name, err)
			}
		}
		vars[name] = val
	}
	return nil
}

func statusOK(code int, expected []int) bool {
	if len(expected) == 0 {
		return code >= 200 && code < 300
	}
	for _, s := range expected {
		if s == code {
			return true
		}
	}
	return false
}
