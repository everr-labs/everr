package everrapikeyauth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"
	"go.opentelemetry.io/collector/extension/extensionauth"
	"go.uber.org/zap"
)

// Errors returned by Authenticate.
var (
	errMissingAuth   = errors.New("missing authorization header")
	errInvalidScheme = errors.New("authorization scheme must be Bearer")
	errUnauthorized  = errors.New("unauthorized")
)

// verifyResponse mirrors VerifyKeyResponse on the app side.
type verifyResponse struct {
	TenantID string `json:"tenantId"`
	KeyID    string `json:"keyId"`
}

type ext struct {
	cfg    Config
	logger *zap.Logger

	httpClient *http.Client
	cache      *tokenCache

	closeOnce sync.Once
}

func newExtension(cfg *Config, settings extension.Settings) *ext {
	applied := cfg.applied()
	return &ext{
		cfg:    applied,
		logger: settings.Logger,
		httpClient: &http.Client{
			Timeout: applied.Timeout,
		},
		cache: newTokenCache(applied.CacheSize, applied.CacheTTL, applied.NegativeCacheTTL),
	}
}

// Compile-time interface checks.
var (
	_ extension.Extension  = (*ext)(nil)
	_ extensionauth.Server = (*ext)(nil)
)

func (e *ext) Start(_ context.Context, _ component.Host) error { return nil }

func (e *ext) Shutdown(_ context.Context) error {
	e.closeOnce.Do(func() {
		e.httpClient.CloseIdleConnections()
	})
	return nil
}

// Authenticate implements extensionauth.Server. It extracts the bearer token
// from the request headers, verifies it (with caching), and stamps tenant
// info into client.Info.Auth so downstream processors can read
// `auth.tenant_id`.
func (e *ext) Authenticate(ctx context.Context, headers map[string][]string) (context.Context, error) {
	token, err := bearerFrom(headers)
	if err != nil {
		return ctx, err
	}

	res, err := e.lookup(ctx, token)
	if err != nil {
		return ctx, err
	}

	cl := client.FromContext(ctx)
	cl.Auth = authData{tenantID: res.tenantID, keyID: res.keyID}
	return client.NewContext(ctx, cl), nil
}

func bearerFrom(headers map[string][]string) (string, error) {
	var raw string
	for k, v := range headers {
		if strings.EqualFold(k, "authorization") && len(v) > 0 {
			raw = v[0]
			break
		}
	}
	if raw == "" {
		return "", errMissingAuth
	}
	const prefix = "Bearer "
	if len(raw) <= len(prefix) || !strings.EqualFold(raw[:len(prefix)], prefix) {
		return "", errInvalidScheme
	}
	tok := strings.TrimSpace(raw[len(prefix):])
	if tok == "" {
		return "", errMissingAuth
	}
	return tok, nil
}

// lookup returns the authResult for the given token, consulting the cache
// first and falling back to the verify endpoint.
func (e *ext) lookup(ctx context.Context, token string) (*authResult, error) {
	if cached, ok := e.cache.get(token); ok {
		if cached.err != nil {
			return nil, cached.err
		}
		return cached.result, nil
	}

	res, verr := e.verify(ctx, token)
	if verr != nil {
		// Only cache definitive 401/403; transient errors should be retryable.
		if errors.Is(verr, errUnauthorized) {
			e.cache.putFailure(token, verr)
		}
		return nil, verr
	}
	e.cache.putSuccess(token, res)
	return res, nil
}

func (e *ext) verify(ctx context.Context, token string) (*authResult, error) {
	body, _ := json.Marshal(map[string]string{"key": token})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.cfg.Endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build verify request: %w", err)
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-internal-secret", string(e.cfg.SharedSecret))

	resp, err := e.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("verify request: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		var vr verifyResponse
		if err := json.NewDecoder(resp.Body).Decode(&vr); err != nil {
			return nil, fmt.Errorf("decode verify response: %w", err)
		}
		return &authResult{tenantID: vr.TenantID, keyID: vr.KeyID}, nil
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, errUnauthorized
	default:
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil, fmt.Errorf("verify endpoint returned %d", resp.StatusCode)
	}
}
