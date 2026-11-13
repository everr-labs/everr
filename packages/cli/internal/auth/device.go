package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"

	"github.com/everr-labs/everr/packages/cli/internal/api"
	"github.com/everr-labs/everr/packages/cli/internal/session"
)

const deviceClientID = "everr-desktop"

// DeviceAuthorization is a started OAuth device authorization.
type DeviceAuthorization struct {
	DeviceCode      string
	UserCode        string
	VerificationURL *url.URL
	ExpiresIn       time.Duration
	Interval        time.Duration
}

// Prompt shows the user where to confirm the code.
type Prompt func(verificationURL *url.URL, userCode string)

// AuthorizeWithPrompt runs the device flow against apiBaseURL and returns the
// new session once the user confirms.
func AuthorizeWithPrompt(ctx context.Context, apiBaseURL string, prompt Prompt) (session.Session, error) {
	client := api.NoRedirectHTTPClient()
	authorization, err := startDeviceAuthorization(ctx, client, apiBaseURL)
	if err != nil {
		return session.Session{}, err
	}
	prompt(authorization.VerificationURL, authorization.UserCode)
	token, err := completeDeviceAuthorization(ctx, client, apiBaseURL, authorization)
	if err != nil {
		return session.Session{}, err
	}
	if strings.TrimSpace(token) == "" {
		return session.Session{}, errors.New("received an empty access token")
	}
	return session.Session{APIBaseURL: apiBaseURL, Token: token}, nil
}

func postJSON(ctx context.Context, client *http.Client, rawURL string, body any) (*http.Response, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))
	return client.Do(req)
}

func startDeviceAuthorization(ctx context.Context, client *http.Client, apiBaseURL string) (*DeviceAuthorization, error) {
	resp, err := postJSON(ctx, client, apiBaseURL+"/api/auth/device/code",
		map[string]string{"client_id": deviceClientID, "scope": "openid"})
	if err != nil {
		return nil, fmt.Errorf("failed to start CLI device authorization: %w", err)
	}
	defer resp.Body.Close()
	data, readErr := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body := string(data)
		if readErr != nil {
			body = "<failed to read body>"
		}
		return nil, fmt.Errorf("device authorization failed with %s: %s", api.StatusString(resp.StatusCode), body)
	}

	var raw struct {
		DeviceCode              *string `json:"device_code"`
		UserCode                *string `json:"user_code"`
		VerificationURI         *string `json:"verification_uri"`
		VerificationURIComplete *string `json:"verification_uri_complete"`
		ExpiresIn               *uint64 `json:"expires_in"`
		Interval                *uint64 `json:"interval"`
	}
	err = readErr
	if err == nil {
		err = json.Unmarshal(data, &raw)
	}
	if err == nil && (raw.DeviceCode == nil || raw.UserCode == nil || raw.VerificationURI == nil || raw.ExpiresIn == nil) {
		err = errors.New("missing required fields")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to parse device authorization response: %w", err)
	}

	rawURL := *raw.VerificationURI
	if raw.VerificationURIComplete != nil {
		rawURL = *raw.VerificationURIComplete
	}
	verificationURL, err := url.Parse(rawURL)
	if err != nil || verificationURL.Scheme == "" {
		return nil, fmt.Errorf("Invalid device verification URL: %s", rawURL)
	}
	if verificationURL.Scheme != "http" && verificationURL.Scheme != "https" {
		return nil, errors.New("Device verification URL must use HTTP(S)")
	}
	interval := uint64(5)
	if raw.Interval != nil {
		interval = *raw.Interval
	}
	return &DeviceAuthorization{
		DeviceCode:      *raw.DeviceCode,
		UserCode:        *raw.UserCode,
		VerificationURL: verificationURL,
		ExpiresIn:       time.Duration(*raw.ExpiresIn) * time.Second,
		Interval:        time.Duration(interval) * time.Second,
	}, nil
}

// slowDownStep is how much a slow_down answer lengthens the polling interval.
var slowDownStep = 5 * time.Second

// pollDeviceAuthorization returns the access token, or the OAuth error code
// the server answered with.
func pollDeviceAuthorization(ctx context.Context, client *http.Client, apiBaseURL string, authorization *DeviceAuthorization) (token, code string, err error) {
	resp, err := postJSON(ctx, client, apiBaseURL+"/api/auth/device/token", map[string]string{
		"grant_type":  "urn:ietf:params:oauth:grant-type:device_code",
		"device_code": authorization.DeviceCode,
		"client_id":   deviceClientID,
	})
	if err != nil {
		return "", "", fmt.Errorf("failed while polling for CLI access token: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		var body struct {
			AccessToken *string `json:"access_token"`
		}
		if err == nil {
			err = json.Unmarshal(data, &body)
		}
		if err == nil && body.AccessToken == nil {
			err = errors.New("missing field `access_token`")
		}
		if err != nil {
			return "", "", fmt.Errorf("failed to parse authentication response: %w", err)
		}
		return *body.AccessToken, "", nil
	}

	var body struct {
		Error *string `json:"error"`
	}
	// An empty code would read as success.
	if err == nil && json.Unmarshal(data, &body) == nil && body.Error != nil && *body.Error != "" {
		return "", *body.Error, nil
	}
	return "", "unknown_error", nil
}

func completeDeviceAuthorization(ctx context.Context, client *http.Client, apiBaseURL string, authorization *DeviceAuthorization) (string, error) {
	deadline := time.Now().Add(authorization.ExpiresIn)
	interval := authorization.Interval
	for {
		if !time.Now().Before(deadline) {
			return "", errors.New("device authentication expired before completion")
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(interval):
		}
		token, code, err := pollDeviceAuthorization(ctx, client, apiBaseURL, authorization)
		switch {
		case err != nil:
			return "", err
		case code == "":
			return token, nil
		case code == "authorization_pending":
		case code == "slow_down":
			interval += slowDownStep
		case code == "access_denied":
			return "", errors.New("device authentication was denied")
		case code == "expired_token":
			return "", errors.New("device authentication token expired")
		default:
			return "", fmt.Errorf("device authentication failed: %s", code)
		}
	}
}
