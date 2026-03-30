package githubactionsreceiver

import (
	"sync"
	"time"
)

// stepTiming holds timing information for a single workflow job step.
type stepTiming struct {
	Number      int64
	Name        string
	StartedAt   time.Time
	CompletedAt time.Time
}

// jobStepTimings holds step timing information for a single job within a run.
type jobStepTimings struct {
	jobName string
	steps   []stepTiming
}

type stepTimingCacheEntry struct {
	jobs      []jobStepTimings
	createdAt time.Time
}

// stepTimingCache caches step timing data from workflow_job events so that
// eventToLogs can split combined log files by step boundaries.
type stepTimingCache struct {
	mu      sync.Mutex
	entries map[runKey]*stepTimingCacheEntry
	order   []runKey
	maxSize int
	ttl     time.Duration
}

func newStepTimingCache(maxSize int, ttl time.Duration) *stepTimingCache {
	return &stepTimingCache{
		entries: make(map[runKey]*stepTimingCacheEntry),
		order:   make([]runKey, 0),
		maxSize: maxSize,
		ttl:     ttl,
	}
}

// AddJob records step timing data for a job. Called when a workflow_job event
// arrives with completed status.
func (c *stepTimingCache) AddJob(key runKey, jobName string, steps []stepTiming) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, exists := c.entries[key]
	if !exists {
		if len(c.entries) >= c.maxSize {
			c.evictOldest()
		}
		entry = &stepTimingCacheEntry{
			createdAt: time.Now(),
		}
		c.entries[key] = entry
		c.order = append(c.order, key)
	}
	entry.jobs = append(entry.jobs, jobStepTimings{
		jobName: jobName,
		steps:   steps,
	})
}

// GetSteps returns cached step timings for all jobs in a run.
// Returns nil on cache miss or expiry.
func (c *stepTimingCache) GetSteps(key runKey) []jobStepTimings {
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
	result := make([]jobStepTimings, len(entry.jobs))
	copy(result, entry.jobs)
	return result
}

func (c *stepTimingCache) Delete(key runKey) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.deleteUnlocked(key)
}

func (c *stepTimingCache) deleteUnlocked(key runKey) {
	delete(c.entries, key)
	for i, k := range c.order {
		if k == key {
			c.order = append(c.order[:i], c.order[i+1:]...)
			break
		}
	}
}

func (c *stepTimingCache) evictOldest() {
	if len(c.order) == 0 {
		return
	}
	oldest := c.order[0]
	c.order = c.order[1:]
	delete(c.entries, oldest)
}
