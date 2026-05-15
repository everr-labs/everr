package everrapikeyauth

import (
	"container/list"
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

// lruNode is what each LRU list element points at. The key is kept here so we
// can drop the map index when an element is evicted from the list tail.
type lruNode struct {
	key   string
	entry cacheEntry
}

// lru is a tiny TTL-aware LRU. Used twice inside tokenCache — once for
// positives, once for negatives.
type lru struct {
	list  *list.List
	index map[string]*list.Element
	cap   int
	ttl   time.Duration
	now   func() time.Time
}

func newLRU(cap int, ttl time.Duration, now func() time.Time) *lru {
	if cap < 1 {
		cap = 1
	}
	return &lru{
		list:  list.New(),
		index: make(map[string]*list.Element, cap),
		cap:   cap,
		ttl:   ttl,
		now:   now,
	}
}

func (l *lru) get(key string) (cacheEntry, bool) {
	el, ok := l.index[key]
	if !ok {
		return cacheEntry{}, false
	}
	n := el.Value.(*lruNode)
	if l.now().After(n.entry.expiresAt) {
		// Expired: report a miss but leave the entry in place so
		// peek-based fallbacks (e.g. transient verify outage) can still
		// see it. Size-bounded LRU eviction will reclaim the slot.
		return cacheEntry{}, false
	}
	l.list.MoveToFront(el)
	return n.entry, true
}

func (l *lru) put(key string, entry cacheEntry) {
	if el, ok := l.index[key]; ok {
		el.Value.(*lruNode).entry = entry
		l.list.MoveToFront(el)
		return
	}
	if l.list.Len() >= l.cap {
		back := l.list.Back()
		if back != nil {
			l.list.Remove(back)
			delete(l.index, back.Value.(*lruNode).key)
		}
	}
	el := l.list.PushFront(&lruNode{key: key, entry: entry})
	l.index[key] = el
}

func (l *lru) len() int { return l.list.Len() }

// peek returns the entry for key without touching LRU order or expiring it.
// Used by the stale-cache fallback in lookup.
func (l *lru) peek(key string) (cacheEntry, bool) {
	el, ok := l.index[key]
	if !ok {
		return cacheEntry{}, false
	}
	return el.Value.(*lruNode).entry, true
}

// tokenCache keeps positive and negative verification outcomes in separate
// LRU caches so a flood of bad tokens can't push out entries for legitimate
// keys.
type tokenCache struct {
	mu  sync.Mutex
	pos *lru
	neg *lru
	now func() time.Time
}

func newTokenCache(posSize, negSize int, posTTL, negTTL time.Duration) *tokenCache {
	now := time.Now
	return &tokenCache{
		pos: newLRU(posSize, posTTL, now),
		neg: newLRU(negSize, negTTL, now),
		now: now,
	}
}

// setNow swaps the clock used by both LRUs. Test-only.
func (c *tokenCache) setNow(now func() time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = now
	c.pos.now = now
	c.neg.now = now
}

// get returns the cached entry for token if still valid; ok==false otherwise.
// Positives are checked first since they're the hot path.
func (c *tokenCache) get(token string) (cacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.pos.get(token); ok {
		return e, true
	}
	if e, ok := c.neg.get(token); ok {
		return e, true
	}
	return cacheEntry{}, false
}

func (c *tokenCache) putSuccess(token string, res *authResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pos.put(token, cacheEntry{
		result:    res,
		expiresAt: c.now().Add(c.pos.ttl),
	})
}

func (c *tokenCache) putFailure(token string, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.neg.put(token, cacheEntry{
		err:       err,
		expiresAt: c.now().Add(c.neg.ttl),
	})
}

// peekStalePositive returns the last-known positive entry for token if it
// exists and is still within `grace` of its expiry. Used as a fallback when
// the verify endpoint is transiently unavailable so brief upstream outages
// don't translate into client-visible 401s for keys we recently accepted.
func (c *tokenCache) peekStalePositive(token string, grace time.Duration) (*authResult, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.pos.peek(token)
	if !ok || e.result == nil {
		return nil, false
	}
	if c.now().After(e.expiresAt.Add(grace)) {
		return nil, false
	}
	return e.result, true
}

// posLen / negLen expose sizes for tests without leaking internals.
func (c *tokenCache) posLen() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.pos.len()
}

func (c *tokenCache) negLen() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.neg.len()
}
