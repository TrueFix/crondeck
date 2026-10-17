package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const probeBodyLimit = 256 << 10 // 256 KiB read; preview returns less

// HTTPProbeResult is returned by ProbeStep for the job editor live preview.
type HTTPProbeResult struct {
	Status      int               `json:"status"`
	StatusText  string            `json:"status_text"`
	DurationMS  int64             `json:"duration_ms"`
	Headers     map[string]string `json:"headers"`
	BodyPreview string            `json:"body_preview"`
	BodyTruncated bool            `json:"body_truncated"`
	BodyIsJSON  bool              `json:"body_is_json"`
	Hints       []ExtractHint     `json:"hints"`
	Extracted   map[string]string `json:"extracted,omitempty"`
	ExtractError string           `json:"extract_error,omitempty"`
	RequestError string           `json:"request_error,omitempty"`

	// The exact request that was (or would be) sent, after {{variable}}
	// substitution — so the user can see what actually goes out.
	ResolvedURL     string            `json:"resolved_url"`
	ResolvedMethod  string            `json:"resolved_method"`
	ResolvedHeaders map[string]string `json:"resolved_headers,omitempty"`
	ResolvedBody    string            `json:"resolved_body,omitempty"`
}

const maxPreviewBodyOut = 16 << 10

// ValidateHTTPProbeStep checks a single step before live preview (no {{var}} in URL required).
func ValidateHTTPProbeStep(step HTTPStep) error {
	return validateHTTPStep(&step, 0)
}

// ProbeStep performs one HTTP request with the same interpolation rules as job execution.
func (h *HTTP) ProbeStep(ctx context.Context, followRedirects *bool, step HTTPStep, vars map[string]string) HTTPProbeResult {
	out := NewOutput(probeBodyLimit, nil)
	start := time.Now()
	res := HTTPProbeResult{Extracted: map[string]string{}}

	m := strings.ToUpper(strings.TrimSpace(step.Method))
	if m == "" {
		m = "GET"
	}
	urlStr := interpolate(step.URL, vars)
	bodyStr := interpolate(step.Body, vars)
	headers := map[string]string{}
	for k, v := range step.Headers {
		headers[k] = interpolate(v, vars)
	}
	// Surface the resolved request regardless of what happens next.
	res.ResolvedMethod = m
	res.ResolvedURL = urlStr
	res.ResolvedBody = bodyStr
	res.ResolvedHeaders = headers

	if miss := collectMissingVars(step, vars); len(miss) > 0 {
		res.RequestError = fmt.Sprintf("missing variables: %s", strings.Join(miss, ", "))
		return res
	}
	if err := requireAbsURL(urlStr); err != nil {
		res.RequestError = err.Error()
		return res
	}

	status, respBody, respHeaders, runRes := h.doRequest(ctx, h.client(followRedirects), m, urlStr, headers, bodyStr, step.BodyContentType, out)
	res.DurationMS = time.Since(start).Milliseconds()
	if runRes.Error != "" {
		res.RequestError = runRes.Error
		if status > 0 {
			res.Status = status
		}
		return res
	}
	res.Status = status
	res.StatusText = fmt.Sprintf("%d", status)
	if respHeaders != nil {
		res.Headers = flattenHeaders(respHeaders)
	}
	truncated := len(respBody) > maxPreviewBodyOut
	preview := respBody
	if truncated {
		preview = respBody[:maxPreviewBodyOut]
	}
	res.BodyPreview = string(preview)
	res.BodyTruncated = truncated
	res.BodyIsJSON = jsonValid(respBody)
	res.Hints = CollectExtractHints(respBody, respHeaders)

	if len(step.Extract) > 0 {
		extracted := map[string]string{}
		if err := applyExtract(respBody, respHeaders, step.Extract, step.ExtractMissing, extracted); err != nil {
			res.ExtractError = err.Error()
		} else {
			res.Extracted = extracted
		}
	}
	return res
}

func flattenHeaders(h http.Header) map[string]string {
	out := map[string]string{}
	for k, vals := range h {
		if len(vals) > 0 {
			out[k] = vals[0]
		}
	}
	return out
}

func jsonValid(b []byte) bool {
	return len(b) > 0 && json.Valid(b)
}
