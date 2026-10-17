package executor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/honk/crondeck/internal/store"
)

type HTTPConfig struct {
	URL             string            `json:"url"`
	Method          string            `json:"method"`
	Headers         map[string]string `json:"headers"`
	Body              string            `json:"body"`
	BodyContentType   string            `json:"body_content_type,omitempty"`
	ExpectedStatus    []int             `json:"expected_status"`
	FollowRedirects *bool             `json:"follow_redirects"`
	Steps           []HTTPStep        `json:"steps,omitempty"`
}

var allowedMethods = map[string]bool{"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true, "HEAD": true, "OPTIONS": true}

func parseHTTP(raw json.RawMessage) (*HTTPConfig, error) {
	var c HTTPConfig
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("invalid http config: %w", err)
	}
	c.Method = strings.ToUpper(strings.TrimSpace(c.Method))
	if c.Method == "" {
		c.Method = "GET"
	}
	return &c, nil
}

type HTTP struct {
	// Client is overridable for tests.
	Client *http.Client
}

func (h *HTTP) Validate(raw json.RawMessage) error {
	c, err := parseHTTP(raw)
	if err != nil {
		return err
	}
	if len(c.Steps) > 0 {
		return validateHTTPSteps(c.Steps)
	}
	u, err := url.Parse(c.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("url must be an absolute http(s) URL")
	}
	if !allowedMethods[c.Method] {
		return fmt.Errorf("unsupported method %q", c.Method)
	}
	for _, s := range c.ExpectedStatus {
		if s < 100 || s > 599 {
			return fmt.Errorf("invalid expected status %d", s)
		}
	}
	for k := range c.Headers {
		if strings.TrimSpace(k) == "" || strings.ContainsAny(k, " \r\n:") {
			return fmt.Errorf("invalid header name %q", k)
		}
	}
	if err := validateBodyContentType(c.BodyContentType); err != nil {
		return err
	}
	return nil
}

type httpStepSpec struct {
	label          string
	url            string
	method         string
	headers        map[string]string
	body            string
	bodyContentType string
	expectedStatus  []int
	extract        map[string]string
	extractMissing map[string]string
}

func (h *HTTP) Run(ctx context.Context, job *store.Job, out *Output) Result {
	c, err := parseHTTP(job.Config)
	if err != nil {
		return Result{Error: err.Error()}
	}

	client := h.client(c.FollowRedirects)
	vars := map[string]string{}
	var lastStatus int

	steps := c.steps()
	for i, spec := range steps {
		if miss := collectMissingVars(HTTPStep{
			URL: spec.url, Method: spec.method, Headers: spec.headers, Body: spec.body,
		}, vars); len(miss) > 0 {
			return Result{Error: fmt.Sprintf("%s: missing variables: %s", spec.label, strings.Join(miss, ", "))}
		}
		urlStr := interpolate(spec.url, vars)
		bodyStr := interpolate(spec.body, vars)
		headers := map[string]string{}
		for k, v := range spec.headers {
			headers[k] = interpolate(v, vars)
		}
		if err := requireAbsURL(urlStr); err != nil {
			return Result{Error: fmt.Sprintf("%s: %v", spec.label, err)}
		}

		if len(steps) > 1 {
			out.WriteString(fmt.Sprintf("── %s ──\n", spec.label))
		}
		status, respBody, respHeaders, res := h.doRequest(ctx, client, spec.method, urlStr, headers, bodyStr, spec.bodyContentType, out)
		lastStatus = status
		if res.Error != "" {
			res.HTTPStatus = intPtr(status)
			return res
		}
		if !statusOK(status, spec.expectedStatus) {
			return Result{
				OK:         false,
				HTTPStatus: intPtr(status),
				Error:      fmt.Sprintf("%s: unexpected status %d", spec.label, status),
			}
		}
		if len(spec.extract) > 0 {
			if err := applyExtract(respBody, respHeaders, spec.extract, spec.extractMissing, vars); err != nil {
				return Result{HTTPStatus: intPtr(status), Error: fmt.Sprintf("%s: %v", spec.label, err)}
			}
			out.WriteString(fmt.Sprintf("✓ extracted %d variable(s)\n", len(spec.extract)))
		}
		if i < len(steps)-1 {
			out.WriteString("\n")
		}
	}

	ok := statusOK(lastStatus, steps[len(steps)-1].expectedStatus)
	res := Result{OK: ok, HTTPStatus: intPtr(lastStatus)}
	if !ok {
		res.Error = fmt.Sprintf("unexpected status %d", lastStatus)
	}
	return res
}

func (c *HTTPConfig) steps() []httpStepSpec {
	if len(c.Steps) > 0 {
		out := make([]httpStepSpec, len(c.Steps))
		for i, s := range c.Steps {
			label := strings.TrimSpace(s.Name)
			if label == "" {
				label = fmt.Sprintf("Step %d", i+1)
			}
			m := strings.ToUpper(strings.TrimSpace(s.Method))
			if m == "" {
				m = "GET"
			}
			out[i] = httpStepSpec{
				label:           label,
				url:             s.URL,
				method:          m,
				headers:         s.Headers,
				body:            s.Body,
				bodyContentType: s.BodyContentType,
				expectedStatus:  s.ExpectedStatus,
				extract:         s.Extract,
				extractMissing:  s.ExtractMissing,
			}
		}
		return out
	}
	return []httpStepSpec{{
		label:           "Request",
		url:             c.URL,
		method:          c.Method,
		headers:         c.Headers,
		body:            c.Body,
		bodyContentType: c.BodyContentType,
		expectedStatus:  c.ExpectedStatus,
	}}
}

func (h *HTTP) client(follow *bool) *http.Client {
	client := h.Client
	if client == nil {
		client = &http.Client{}
	}
	if follow != nil && !*follow {
		cc := *client
		cc.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		client = &cc
	}
	return client
}

func (h *HTTP) doRequest(ctx context.Context, client *http.Client, method, urlStr string, headers map[string]string, body, bodyContentType string, out *Output) (status int, respBody []byte, respHeaders http.Header, res Result) {
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, urlStr, bodyReader)
	if err != nil {
		return 0, nil, nil, Result{Error: err.Error()}
	}
	req.Header.Set("User-Agent", "CronDeck/1.0")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if body != "" && !headersHaveContentType(headers) {
		if ct := defaultContentType(bodyContentType, body); ct != "" {
			req.Header.Set("Content-Type", ct)
		}
	}

	out.WriteString(fmt.Sprintf("→ %s %s\n", method, urlStr))
	resp, err := client.Do(req)
	if err != nil {
		out.WriteString("✗ " + err.Error() + "\n")
		return 0, nil, nil, Result{Error: err.Error()}
	}
	defer resp.Body.Close()
	respHeaders = resp.Header.Clone()

	out.WriteString(fmt.Sprintf("← %s\n", resp.Status))
	keys := make([]string, 0, len(resp.Header))
	for k := range resp.Header {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		out.WriteString(fmt.Sprintf("%s: %s\n", k, strings.Join(resp.Header[k], ", ")))
	}
	out.WriteString("\n")

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil && ctx.Err() == nil {
		out.WriteString("✗ reading body: " + err.Error() + "\n")
		return resp.StatusCode, nil, respHeaders, Result{HTTPStatus: intPtr(resp.StatusCode), Error: "reading response body: " + err.Error()}
	}
	if len(raw) > 0 {
		out.Write(raw)
		if raw[len(raw)-1] != '\n' {
			out.WriteString("\n")
		}
	}
	return resp.StatusCode, raw, respHeaders, Result{}
}
