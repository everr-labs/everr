package main

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"time"

	"github.com/google/go-github/v67/github"
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
	db    *sql.DB
	cache *tenantCache
}

// newTenantResolver creates a resolver that maps GitHub installation IDs to tenant IDs.
func newTenantResolver(db *sql.DB, cacheTTL time.Duration) *tenantResolver {
	return &tenantResolver{
		db:    db,
		cache: newTenantCache(cacheTTL),
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

// ResolveTenantID loads a tenant ID for an installation, using cache first and Postgres as fallback.
func (r *tenantResolver) ResolveTenantID(ctx context.Context, installationID int64) (int64, error) {
	if r == nil {
		return 0, errors.New("tenant resolver is nil")
	}
	if tenantID, ok := r.cache.get(installationID); ok {
		return tenantID, nil
	}

	const q = `
		SELECT tenant_id
		FROM github_installation_tenants
		WHERE github_installation_id = $1 AND status = 'active'
		LIMIT 1
	`
	var tenantID int64
	if err := r.db.QueryRowContext(ctx, q, installationID).Scan(&tenantID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, errTenantNotFound
		}
		return 0, err
	}
	r.cache.set(installationID, tenantID)
	return tenantID, nil
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
