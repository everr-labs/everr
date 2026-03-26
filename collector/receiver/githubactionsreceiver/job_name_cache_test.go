package githubactionsreceiver

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestJobNameCacheAddAndGet(t *testing.T) {
	c := newJobNameCache(10, 30*time.Minute)
	key := runKey{repoID: 1, runID: 100, runAttempt: 1}

	c.AddJobName(key, "build (1/2)")
	c.AddJobName(key, "build (2/2)")

	names := c.GetJobNames(key)
	require.Equal(t, []string{"build (1/2)", "build (2/2)"}, names)
}

func TestJobNameCacheGetMiss(t *testing.T) {
	c := newJobNameCache(10, 30*time.Minute)
	key := runKey{repoID: 1, runID: 100, runAttempt: 1}

	names := c.GetJobNames(key)
	require.Nil(t, names)
}

func TestJobNameCacheTTLExpiry(t *testing.T) {
	c := newJobNameCache(10, 50*time.Millisecond)
	key := runKey{repoID: 1, runID: 100, runAttempt: 1}

	c.AddJobName(key, "build (1/2)")
	require.NotNil(t, c.GetJobNames(key))

	time.Sleep(60 * time.Millisecond)
	require.Nil(t, c.GetJobNames(key))
}

func TestJobNameCacheSizeEviction(t *testing.T) {
	c := newJobNameCache(2, 30*time.Minute)
	key1 := runKey{repoID: 1, runID: 1, runAttempt: 1}
	key2 := runKey{repoID: 1, runID: 2, runAttempt: 1}
	key3 := runKey{repoID: 1, runID: 3, runAttempt: 1}

	c.AddJobName(key1, "a (1/2)")
	c.AddJobName(key2, "b (1/2)")
	c.AddJobName(key3, "c (1/2)") // should evict key1

	require.Nil(t, c.GetJobNames(key1))
	require.NotNil(t, c.GetJobNames(key2))
	require.NotNil(t, c.GetJobNames(key3))
}

func TestJobNameCacheDelete(t *testing.T) {
	c := newJobNameCache(10, 30*time.Minute)
	key := runKey{repoID: 1, runID: 100, runAttempt: 1}

	c.AddJobName(key, "build (1/2)")
	c.Delete(key)

	require.Nil(t, c.GetJobNames(key))
}

func TestJobNameCacheConcurrency(t *testing.T) {
	c := newJobNameCache(1000, 30*time.Minute)
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := runKey{repoID: 1, runID: int64(i), runAttempt: 1}
			c.AddJobName(key, fmt.Sprintf("job (%d/2)", i))
			c.GetJobNames(key)
			c.Delete(key)
		}(i)
	}
	wg.Wait()
}
