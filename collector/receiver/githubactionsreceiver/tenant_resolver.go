package githubactionsreceiver

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"

	_ "github.com/lib/pq"
)

var errTenantNotFound = errors.New("tenant mapping not found for installation")

type tenantCacheEntry struct {
	tenantID  int64
	expiresAt time.Time
}

type tenantResolver struct {
	db       *sql.DB
	cacheTTL time.Duration

	cacheMu sync.RWMutex
	cache   map[int64]tenantCacheEntry
}

func newTenantResolver(postgresDSN string, cacheTTL time.Duration) (*tenantResolver, error) {
	if postgresDSN == "" {
		return nil, errMissingTenantPostgresDSN
	}
	if cacheTTL <= 0 {
		cacheTTL = time.Minute
	}

	db, err := sql.Open("postgres", postgresDSN)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}

	return &tenantResolver{
		db:       db,
		cacheTTL: cacheTTL,
		cache:    make(map[int64]tenantCacheEntry),
	}, nil
}

func (tr *tenantResolver) Close() error {
	if tr == nil || tr.db == nil {
		return nil
	}
	return tr.db.Close()
}

func (tr *tenantResolver) ResolveTenantID(ctx context.Context, installationID int64) (int64, error) {
	now := time.Now()

	tr.cacheMu.RLock()
	entry, ok := tr.cache[installationID]
	tr.cacheMu.RUnlock()
	if ok && now.Before(entry.expiresAt) {
		return entry.tenantID, nil
	}

	const q = `
		SELECT tenant_id
		FROM github_installation_tenants
		WHERE github_installation_id = $1
		LIMIT 1
	`

	var tenantID int64
	if err := tr.db.QueryRowContext(ctx, q, installationID).Scan(&tenantID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, errTenantNotFound
		}
		return 0, err
	}

	tr.cacheMu.Lock()
	tr.cache[installationID] = tenantCacheEntry{
		tenantID:  tenantID,
		expiresAt: now.Add(tr.cacheTTL),
	}
	tr.cacheMu.Unlock()

	return tenantID, nil
}
