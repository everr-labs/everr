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
	"golang.org/x/sync/singleflight"
)

// Errors returned by Authenticate.
var (
	errMissingAuth      = errors.New("missing authorization header")
	errInvalidScheme    = errors.New("authorization scheme must be Bearer")
	errUnauthorized     = errors.New("unauthorized")
	errOriginNotAllowed = errors.New("origin not allowed for this key")
)

// verifyResponse mirrors VerifyKeyResponse on the app side.
type verifyResponse struct {
	TenantID       string   `json:"tenantId"`
	KeyID          string   `json:"keyId"`
	AllowedOrigins []string `json:"allowedOrigins"`
}

type ext struct {
	cfg    Config
	logger *zap.Logger

	httpClient   *http.Client
	cache        *tokenCache
	verifyFlight singleflight.Group

	closeOnce sync.Once
}

func newExtension(cfg *Config, settings extension.Settings) *ext {
	applied := cfg.applied()
	logger := settings.Logger
	if logger == nil {
		logger = zap.NewNop()
	}
	return &ext{
		cfg:    applied,
		logger: logger,
		httpClient: &http.Client{
			Timeout: applied.Timeout,
		},
		cache: newTokenCache(
			applied.CacheSize,
			applied.NegativeCacheSize,
			applied.CacheTTL,
			applied.NegativeCacheTTL,
		),
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

	if len(res.allowedOrigins) > 0 {
		origin := headerValue(headers, "Origin")
		if !originAllowed(origin, res.allowedOrigins) {
			e.logger.Debug(
				"rejecting request from disallowed origin",
				zap.String("key_id", res.keyID),
				zap.String("origin", origin),
			)
			return ctx, errOriginNotAllowed
		}
	}

	cl := client.FromContext(ctx)
	cl.Auth = authData{tenantID: res.tenantID, keyID: res.keyID}
	return client.NewContext(ctx, cl), nil
}

// headerValue returns the first non-empty value for name from headers,
// probing both lowercase (gRPC) and canonical (net/http) shapes before
// falling back to a case-insensitive scan.
func headerValue(headers map[string][]string, name string) string {
	canonical := http.CanonicalHeaderKey(name)
	if v := firstNonEmpty(headers[strings.ToLower(name)], headers[canonical]); v != "" {
		return v
	}
	for k, v := range headers {
		if len(v) > 0 && v[0] != "" && strings.EqualFold(k, name) {
			return v[0]
		}
	}
	return ""
}

// originAllowed reports whether origin matches any entry in allowed.
// Matching is exact and case-sensitive on scheme+host (browsers send the
// Origin header verbatim from the document origin), with the trailing slash
// stripped if present.
func originAllowed(origin string, allowed []string) bool {
	if origin == "" {
		return false
	}
	normalized := strings.TrimSuffix(origin, "/")
	for _, a := range allowed {
		if strings.TrimSuffix(a, "/") == normalized {
			return true
		}
	}
	return false
}

func bearerFrom(headers map[string][]string) (string, error) {
	// gRPC lowercases headers; net/http canonicalizes them. Probe both common
	// shapes before falling back to a case-insensitive scan.
	raw := firstNonEmpty(headers["authorization"], headers["Authorization"])
	if raw == "" {
		for k, v := range headers {
			if len(v) > 0 && v[0] != "" && strings.EqualFold(k, "authorization") {
				raw = v[0]
				break
			}
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

func firstNonEmpty(slices ...[]string) string {
	for _, s := range slices {
		if len(s) > 0 && s[0] != "" {
			return s[0]
		}
	}
	return ""
}

// lookup returns the authResult for the given token, consulting the cache
// first and falling back to the verify endpoint. Concurrent misses for the
// same token coalesce into a single verify call via singleflight; the rest
// wait for that one answer. The shared verify call uses a detached context
// with its own timeout so one caller's cancellation does not fail all the
// waiters.
func (e *ext) lookup(ctx context.Context, token string) (*authResult, error) {
	if cached, ok := e.cache.get(token); ok {
		if cached.err != nil {
			return nil, cached.err
		}
		return cached.result, nil
	}

	ch := e.verifyFlight.DoChan(token, func() (any, error) {
		// Re-check the cache: another goroutine may have populated it while
		// we were queued behind singleflight.
		if cached, ok := e.cache.get(token); ok {
			if cached.err != nil {
				return nil, cached.err
			}
			return cached.result, nil
		}
		verifyCtx, cancel := context.WithTimeout(context.Background(), e.cfg.Timeout)
		defer cancel()
		res, err := e.verify(verifyCtx, token)
		if err != nil {
			if errors.Is(err, errUnauthorized) {
				// Definitive rejection — cache the negative outcome.
				e.cache.putFailure(token, err)
				return nil, err
			}
			// Transient (network, 5xx). OTel auth maps any error we return to
			// 401 client-side, so fall back to the last-known-good cache entry
			// within a grace window so brief verify outages don't translate
			// into client-visible auth failures for keys we recently accepted.
			grace := e.cfg.CacheTTL
			if stale, ok := e.cache.peekStalePositive(token, grace); ok {
				e.logger.Warn(
					"verify endpoint unavailable; serving stale cached auth",
					zap.Error(err),
				)
				return stale, nil
			}
			return nil, err
		}
		e.cache.putSuccess(token, res)
		return res, nil
	})

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case r := <-ch:
		if r.Err != nil {
			return nil, r.Err
		}
		return r.Val.(*authResult), nil
	}
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
		e.logger.Debug(
			"verified ingest key",
			zap.String("key_id", vr.KeyID),
			zap.String("tenant_id", vr.TenantID),
		)
		return &authResult{
			tenantID:       vr.TenantID,
			keyID:          vr.KeyID,
			allowedOrigins: vr.AllowedOrigins,
		}, nil
	case http.StatusUnauthorized, http.StatusForbidden:
		e.logger.Debug("verify endpoint rejected key")
		return nil, errUnauthorized
	default:
		_, _ = io.Copy(io.Discard, resp.Body)
		e.logger.Warn(
			"verify endpoint returned unexpected status",
			zap.Int("status", resp.StatusCode),
		)
		return nil, fmt.Errorf("verify endpoint returned %d", resp.StatusCode)
	}
}
