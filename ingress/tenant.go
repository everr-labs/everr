package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/google/go-github/v67/github"
	"go.uber.org/zap"
)

type githubWebhookWithInstallation interface {
	GetInstallation() *github.Installation
}

type tenantCacheEntry struct {
	tenantID  int64
	expiresAt time.Time
}

type tenantCache struct {
	ttl time.Duration
	mu  sync.RWMutex
	m   map[int64]tenantCacheEntry
}

type tenantResolver struct {
	baseURL     *url.URL
	urlParseErr error
	secret      string
	httpClient  HTTPDoer
	cache       *tenantCache
	logger      *zap.Logger
}

// newTenantResolver creates a resolver that maps installation IDs to tenant IDs via app API.
func newTenantResolver(resolutionURL, secret string, httpClient HTTPDoer, cacheTTL time.Duration, logger *zap.Logger) *tenantResolver {
	parsedURL, parseErr := url.Parse(resolutionURL)
	return &tenantResolver{
		baseURL:     parsedURL,
		urlParseErr: parseErr,
		secret:      secret,
		httpClient:  httpClient,
		cache:       newTenantCache(cacheTTL),
		logger:      logger,
	}
}

// newTenantCache creates an optional TTL cache for installation-to-tenant lookups.
func newTenantCache(ttl time.Duration) *tenantCache {
	if ttl <= 0 {
		return nil
	}
	return &tenantCache{
		ttl: ttl,
		m:   make(map[int64]tenantCacheEntry),
	}
}

// get returns a cached tenant ID when the entry exists and has not expired.
func (c *tenantCache) get(installationID int64) (int64, bool) {
	if c == nil {
		return 0, false
	}
	now := time.Now()

	c.mu.RLock()
	entry, ok := c.m[installationID]
	c.mu.RUnlock()
	if !ok || now.After(entry.expiresAt) {
		return 0, false
	}
	return entry.tenantID, true
}

// set stores a tenant mapping in cache with a TTL-based expiration timestamp.
func (c *tenantCache) set(installationID, tenantID int64) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.m[installationID] = tenantCacheEntry{
		tenantID:  tenantID,
		expiresAt: time.Now().Add(c.ttl),
	}
	c.mu.Unlock()
}

// ResolveTenantID loads a tenant ID for an installation, using cache first and app API as fallback.
func (r *tenantResolver) ResolveTenantID(ctx context.Context, installationID int64) (int64, error) {
	if r == nil {
		r.logger.Error("tenant resolver is nil")
		return 0, errors.New("tenant resolver is nil")
	}
	if r.secret == "" {
		r.logger.Error("tenant resolution secret is empty")
		return 0, errors.New("tenant resolution secret is empty")
	}
	if r.httpClient == nil {
		r.logger.Error("tenant resolver HTTP client is nil")
		return 0, errors.New("tenant resolver HTTP client is nil")
	}
	if r.urlParseErr != nil {
		r.logger.Error("parse tenant resolution URL", zap.Error(r.urlParseErr))
		return 0, fmt.Errorf("parse tenant resolution URL: %w", r.urlParseErr)
	}
	if r.baseURL == nil {
		r.logger.Error("tenant resolution URL is empty")
		return 0, errors.New("tenant resolution URL is empty")
	}
	if tenantID, ok := r.cache.get(installationID); ok {
		r.logger.Debug("tenant ID found in cache", zap.Int64("installation_id", installationID), zap.Int64("tenant_id", tenantID))
		return tenantID, nil
	}

	reqURL := *r.baseURL
	query := reqURL.Query()
	query.Set("installation_id", strconv.FormatInt(installationID, 10))
	reqURL.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL.String(), nil)
	if err != nil {
		r.logger.Error("build tenant resolution request error", zap.Error(err))
		return 0, fmt.Errorf("build tenant resolution request: %w", err)
	}
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	req.Header.Set(headerIngressTimestamp, timestamp)
	req.Header.Set(headerIngressSignatureSHA256, signIngressRequest(r.secret, timestamp, req.Method, req.URL.RequestURI()))
	resp, err := r.httpClient.Do(req)
	if err != nil {
		r.logger.Error("tenant resolution request failed", zap.Error(err))
		return 0, fmt.Errorf("tenant resolution request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyPreview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		err := fmt.Errorf("tenant resolution status=%d body=%q", resp.StatusCode, string(bodyPreview))
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			r.logger.Error("tenant resolution failed (terminal)", zap.Int("status", resp.StatusCode), zap.String("body", string(bodyPreview)))
			return 0, &terminalError{Err: err}
		}
		r.logger.Error("tenant resolution failed", zap.Int("status", resp.StatusCode), zap.String("body", string(bodyPreview)))
		return 0, err
	}

	var payload struct {
		TenantID int64 `json:"tenant_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		r.logger.Error("decode tenant resolution response error", zap.Error(err))
		return 0, fmt.Errorf("decode tenant resolution response: %w", err)
	}

	tenantID := payload.TenantID
	if tenantID == 0 {
		r.logger.Error("tenant resolution response missing tenant id")
		return 0, errors.New("tenant resolution response missing tenant id")
	}

	r.cache.set(installationID, tenantID)
	return tenantID, nil
}

// signIngressRequest builds the HMAC digest used to authenticate ingress->app tenant resolution calls.
func signIngressRequest(secret, timestamp, method, requestURI string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write([]byte(method))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write([]byte(requestURI))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// installationIDFromWebhookEvent extracts installation.id from a parsed GitHub webhook event.
func installationIDFromWebhookEvent(event githubWebhookWithInstallation) (int64, error) {
	if event == nil {
		return 0, errMissingInstallationID
	}
	installation := event.GetInstallation()
	if installation == nil || installation.GetID() == 0 {
		return 0, errMissingInstallationID
	}
	return installation.GetID(), nil
}
