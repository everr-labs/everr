package githubactionsreceiver

import (
	"sync"
	"time"
)

type runKey struct {
	repoID     int64
	runID      int64
	runAttempt int
}

type cacheEntry struct {
	jobNames  []string
	createdAt time.Time
}

type jobNameCache struct {
	mu      sync.Mutex
	entries map[runKey]*cacheEntry
	order   []runKey
	maxSize int
	ttl     time.Duration
}

func newJobNameCache(maxSize int, ttl time.Duration) *jobNameCache {
	return &jobNameCache{
		entries: make(map[runKey]*cacheEntry),
		order:   make([]runKey, 0),
		maxSize: maxSize,
		ttl:     ttl,
	}
}

func (c *jobNameCache) AddJobName(key runKey, jobName string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, exists := c.entries[key]
	if !exists {
		if len(c.entries) >= c.maxSize {
			c.evictOldest()
		}
		entry = &cacheEntry{
			createdAt: time.Now(),
		}
		c.entries[key] = entry
		c.order = append(c.order, key)
	}
	entry.jobNames = append(entry.jobNames, jobName)
}

func (c *jobNameCache) GetJobNames(key runKey) []string {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, exists := c.entries[key]
	if !exists {
		return nil
	}
	if time.Since(entry.createdAt) > c.ttl {
		c.deleteUnlocked(key)
		return nil
	}
	result := make([]string, len(entry.jobNames))
	copy(result, entry.jobNames)
	return result
}

func (c *jobNameCache) Delete(key runKey) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.deleteUnlocked(key)
}

func (c *jobNameCache) deleteUnlocked(key runKey) {
	delete(c.entries, key)
	for i, k := range c.order {
		if k == key {
			c.order = append(c.order[:i], c.order[i+1:]...)
			break
		}
	}
}

func (c *jobNameCache) evictOldest() {
	if len(c.order) == 0 {
		return
	}
	oldest := c.order[0]
	c.order = c.order[1:]
	delete(c.entries, oldest)
}
