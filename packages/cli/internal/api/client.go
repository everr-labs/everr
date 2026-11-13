// Package api is the HTTP client for the Everr API.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"

	"github.com/everr-labs/everr/packages/cli/internal/build"
	"github.com/everr-labs/everr/packages/cli/internal/internaltelemetry"
	"github.com/everr-labs/everr/packages/cli/internal/session"
)

// Client calls the Everr API with a bearer credential.
type Client struct {
	http         *http.Client
	baseURL      string
	baseEndpoint string
	bearer       string
	// A rejected API key cannot be fixed by `cloud login`, so some endpoints
	// report a 401 differently for it.
	apiKey bool
}

// FromSession builds a client for a saved login.
func FromSession(s session.Session) (*Client, error) {
	return fromBearer(s.APIBaseURL, s.Token, false)
}

// FromToken builds a client for a raw API key (EVERR_API_KEY in CI).
func FromToken(apiBaseURL, token string) (*Client, error) {
	return fromBearer(apiBaseURL, token, true)
}

func fromBearer(apiBaseURL, token string, apiKey bool) (*Client, error) {
	bearer := "Bearer " + token
	if !validHeaderValue(bearer) {
		return nil, errors.New("invalid token for Authorization header")
	}
	baseURL := strings.TrimRight(apiBaseURL, "/")
	return &Client{
		http:         NoRedirectHTTPClient(),
		baseURL:      baseURL,
		baseEndpoint: baseURL + "/api/cli",
		bearer:       bearer,
		apiKey:       apiKey,
	}, nil
}

// NoRedirectHTTPClient returns redirects as responses instead of following
// them, so a credential is never replayed to another origin.
func NoRedirectHTTPClient() *http.Client {
	return &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func validHeaderValue(v string) bool {
	for i := 0; i < len(v); i++ {
		if c := v[i]; (c < 0x20 && c != '\t') || c == 0x7f {
			return false
		}
	}
	return true
}

// BaseURL is the installation URL without a trailing slash.
func (c *Client) BaseURL() string { return c.baseURL }

// PrintTarget writes the installation URL to stderr.
func (c *Client) PrintTarget() {
	fmt.Fprintf(os.Stderr, "Target: %s\n", c.baseURL)
}

func (c *Client) newRequest(ctx context.Context, method, rawURL string, query url.Values, body io.Reader, contentType string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, rawURL, body)
	if err != nil {
		return nil, err
	}
	if len(query) > 0 {
		req.URL.RawQuery = query.Encode()
	}
	req.Header.Set("Authorization", c.bearer)
	req.Header.Set("Content-Type", contentType)
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))
	return req, nil
}

func jsonBody(value any) (io.Reader, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

// sendChecked sends req and maps a non-2xx status to an error carrying the
// response body. requestErr prefixes transport failures; statusContext
// prefixes status failures.
func (c *Client) sendChecked(req *http.Request, requestErr, statusContext string) (*http.Response, error) {
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", requestErr, err)
	}
	if !success(resp.StatusCode) {
		text := readBodyText(resp)
		return nil, httpStatusError(resp.StatusCode, text, statusContext)
	}
	return resp, nil
}

func success(status int) bool { return status >= 200 && status < 300 }

func readBodyText(resp *http.Response) string {
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "<failed to read body>"
	}
	return string(data)
}

func httpStatusError(status int, text, context string) error {
	if status == http.StatusUnauthorized {
		return fmt.Errorf("Session expired. Run `%s cloud login` to re-authenticate.", build.CommandName())
	}
	return fmt.Errorf("%s failed with %s: %s", context, StatusString(status), text)
}

// StatusString formats a status code like "500 Internal Server Error".
func StatusString(status int) string {
	text := http.StatusText(status)
	if text == "" {
		text = "<unknown status code>"
	}
	return fmt.Sprintf("%d %s", status, text)
}

func decodeJSON(resp *http.Response, target any, errContext string) error {
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err == nil {
		err = json.Unmarshal(data, target)
	}
	if err != nil {
		return fmt.Errorf("%s: %w", errContext, err)
	}
	return nil
}

func (c *Client) get(ctx context.Context, path string, query url.Values, target any) error {
	req, err := c.newRequest(ctx, http.MethodGet, c.baseEndpoint+path, query, nil, "application/json")
	if err != nil {
		return err
	}
	resp, err := c.sendChecked(req, "CLI API request failed", "CLI API request")
	if err != nil {
		return err
	}
	return decodeJSON(resp, target, "failed to decode CLI API response as JSON")
}

// Logout revokes the session. An already-invalid session counts as revoked.
func (c *Client) Logout(ctx context.Context) error {
	body, _ := jsonBody(map[string]any{})
	req, err := c.newRequest(ctx, http.MethodPost, c.baseURL+"/api/auth/sign-out", nil, body, "application/json")
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if success(resp.StatusCode) || resp.StatusCode == http.StatusUnauthorized {
		return nil
	}
	return fmt.Errorf("Could not revoke session: %s", StatusString(resp.StatusCode))
}

// Apply reconciles the desired as-code state.
func (c *Client) Apply(ctx context.Context, request *ApplyRequest) (*ApplySummary, error) {
	body, err := jsonBody(request)
	if err != nil {
		return nil, err
	}
	req, err := c.newRequest(ctx, http.MethodPost, c.baseURL+"/api/apply", nil, body, "application/json")
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("apply request failed: %w", err)
	}
	if !success(resp.StatusCode) {
		text := readBodyText(resp)
		if resp.StatusCode == http.StatusUnauthorized && c.apiKey {
			return nil, errors.New("apply was rejected (401 Unauthorized): the API key (EVERR_API_KEY, " +
				"or the deprecated EVERR_API_TOKEN) is missing, invalid, or not " +
				"authorized to apply resources in this organization.")
		}
		return nil, httpStatusError(resp.StatusCode, text, "apply")
	}
	var summary ApplySummary
	if err := decodeJSON(resp, &summary, "failed to decode apply response"); err != nil {
		return nil, err
	}
	return &summary, nil
}

func (c *Client) GetMe(ctx context.Context) (*MeResponse, error) {
	var out MeResponse
	if err := c.get(ctx, "/me", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// PostSQL runs sql and returns the NDJSON response body.
func (c *Client) PostSQL(ctx context.Context, sql string) (_ string, err error) {
	// A client span whose context is injected into the request, so the
	// server continues this trace (CLI, server, ClickHouse).
	ctx, span := otel.Tracer("everr_api").Start(ctx, "POST /api/cli/sql",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(attribute.String("http.request.method", http.MethodPost)),
	)
	defer func() {
		if err != nil {
			// Errors carry the server's response, which often repeats the
			// query, so release builds export a fixed message.
			span.SetStatus(codes.Error, internaltelemetry.CommandError(err))
		}
		span.End()
	}()

	req, err := c.newRequest(ctx, http.MethodPost, c.baseEndpoint+"/sql", nil, strings.NewReader(sql), "text/plain")
	if err != nil {
		return "", err
	}
	resp, err := c.sendChecked(req, "CLI SQL request failed", "CLI SQL")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	span.SetAttributes(attribute.Int("http.response.status_code", resp.StatusCode))
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read CLI SQL response body: %w", err)
	}
	return string(data), nil
}

// ListResources lists live resources, filtered by kind when it is not empty
// and by repoid when it is not nil; an empty repoid selects resources created
// in the UI.
func (c *Client) ListResources(ctx context.Context, kind string, repoid *string) ([]ResourceSummary, error) {
	query := url.Values{}
	if kind != "" {
		query.Set("kind", kind)
	}
	if repoid != nil {
		query.Set("repoid", *repoid)
	}
	var out []ResourceSummary
	if err := c.get(ctx, "/resources", query, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetResource returns one resource's document.
func (c *Client) GetResource(ctx context.Context, kind, project, slug string) (json.RawMessage, error) {
	var out json.RawMessage
	return out, c.get(ctx, resourcePath(kind, project, slug), nil, &out)
}

func (c *Client) DeleteResource(ctx context.Context, kind, project, slug string) error {
	req, err := c.newRequest(ctx, http.MethodDelete, c.baseEndpoint+resourcePath(kind, project, slug), nil, nil, "application/json")
	if err != nil {
		return err
	}
	resp, err := c.sendChecked(req, "delete resource request failed", "delete resource")
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// AdoptResource moves a live resource's ownership to repoid.
func (c *Client) AdoptResource(ctx context.Context, kind, project, slug, repoid string) (*AdoptOutcome, error) {
	body, err := jsonBody(map[string]string{"repoid": repoid})
	if err != nil {
		return nil, err
	}
	req, err := c.newRequest(ctx, http.MethodPost, c.baseEndpoint+resourcePath(kind, project, slug)+"/adopt", nil, body, "application/json")
	if err != nil {
		return nil, err
	}
	resp, err := c.sendChecked(req, "adopt resource request failed", "adopt resource")
	if err != nil {
		return nil, err
	}
	var out AdoptOutcome
	if err := decodeJSON(resp, &out, "failed to decode adopt response"); err != nil {
		return nil, err
	}
	return &out, nil
}

func resourcePath(kind, project, slug string) string {
	return "/resources/" + kind + "/" + project + "/" + slug
}
