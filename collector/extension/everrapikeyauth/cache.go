package everrapikeyauth

import (
	"sync"
	"time"
)

// rateLimit is the per-key budget enforced inside the extension.
type rateLimit struct {
	enabled  bool
	max      int
	windowMs int64
}

// authResult is what the verify endpoint tells us, plus what we derive.
type authResult struct {
	tenantID string
	keyID    string
	rl       rateLimit
}

// cacheEntry stores one verification outcome.
//
// If err != nil this is a negative cache entry (verify said "no").
type cacheEntry struct {
	result    *authResult
	err       error
	expiresAt time.Time
}

// rlState tracks token-bucket-ish counters per key for rate limiting.
type rlState struct {
	count       int
	windowStart time.Time
}

type tokenCache struct {
	mu      sync.Mutex
	entries map[string]cacheEntry
	rl      map[string]*rlState
	maxSize int
	posTTL  time.Duration
	negTTL  time.Duration
	now     func() time.Time
}

func newTokenCache(maxSize int, posTTL, negTTL time.Duration) *tokenCache {
	return &tokenCache{
		entries: make(map[string]cacheEntry),
		rl:      make(map[string]*rlState),
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

// allow consumes one unit from the per-key rate budget. Returns false when
// over budget.
func (c *tokenCache) allow(keyID string, rl rateLimit) bool {
	if !rl.enabled || rl.max <= 0 || rl.windowMs <= 0 {
		return true
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	st, ok := c.rl[keyID]
	window := time.Duration(rl.windowMs) * time.Millisecond
	if !ok || now.Sub(st.windowStart) >= window {
		c.rl[keyID] = &rlState{count: 1, windowStart: now}
		return true
	}
	if st.count >= rl.max {
		return false
	}
	st.count++
	return true
}
