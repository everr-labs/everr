package everrapikeyauth

import (
	"sync"
	"time"
)

// authResult is what the verify endpoint tells us.
type authResult struct {
	tenantID string
	keyID    string
}

// cacheEntry stores one verification outcome.
//
// If err != nil this is a negative cache entry (verify said "no").
type cacheEntry struct {
	result    *authResult
	err       error
	expiresAt time.Time
}

type tokenCache struct {
	mu      sync.Mutex
	entries map[string]cacheEntry
	maxSize int
	posTTL  time.Duration
	negTTL  time.Duration
	now     func() time.Time
}

func newTokenCache(maxSize int, posTTL, negTTL time.Duration) *tokenCache {
	return &tokenCache{
		entries: make(map[string]cacheEntry),
		maxSize: maxSize,
		posTTL:  posTTL,
		negTTL:  negTTL,
		now:     time.Now,
	}
}

// get returns the cached entry for token if still valid; ok==false otherwise.
func (c *tokenCache) get(token string) (cacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, found := c.entries[token]
	if !found {
		return cacheEntry{}, false
	}
	if c.now().After(e.expiresAt) {
		delete(c.entries, token)
		return cacheEntry{}, false
	}
	return e, true
}

func (c *tokenCache) putSuccess(token string, res *authResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.evictIfFull()
	c.entries[token] = cacheEntry{
		result:    res,
		expiresAt: c.now().Add(c.posTTL),
	}
}

func (c *tokenCache) putFailure(token string, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.evictIfFull()
	c.entries[token] = cacheEntry{
		err:       err,
		expiresAt: c.now().Add(c.negTTL),
	}
}

// evictIfFull drops one arbitrary entry when the map exceeds the bound. Cheap,
// not LRU; fine for v1 given short TTLs.
func (c *tokenCache) evictIfFull() {
	if len(c.entries) < c.maxSize {
		return
	}
	for k := range c.entries {
		delete(c.entries, k)
		break
	}
}
