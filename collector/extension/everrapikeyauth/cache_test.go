package everrapikeyauth

import (
	"errors"
	"strconv"
	"sync"
	"testing"
	"time"
)

func TestCache_PositiveTTL(t *testing.T) {
	now := time.Unix(0, 0)
	c := newTokenCache(10, 10, time.Second, time.Second)
	c.setNow(func() time.Time { return now })

	res := &authResult{tenantID: "org_1", keyID: "k_1"}
	c.putSuccess("tok", res)

	got, ok := c.get("tok")
	if !ok || got.result != res {
		t.Fatal("expected hit")
	}

	now = now.Add(2 * time.Second)
	if _, ok := c.get("tok"); ok {
		t.Fatal("expected expiry")
	}
}

func TestCache_NegativeTTL(t *testing.T) {
	now := time.Unix(0, 0)
	c := newTokenCache(10, 10, 30*time.Second, 5*time.Second)
	c.setNow(func() time.Time { return now })

	c.putFailure("tok", errors.New("bad"))

	got, ok := c.get("tok")
	if !ok || got.err == nil {
		t.Fatal("expected negative cache hit")
	}

	now = now.Add(6 * time.Second)
	if _, ok := c.get("tok"); ok {
		t.Fatal("expected negative expiry")
	}
}

func TestCache_EvictsWhenFull(t *testing.T) {
	c := newTokenCache(2, 2, time.Minute, time.Minute)
	c.putSuccess("a", &authResult{})
	c.putSuccess("b", &authResult{})
	c.putSuccess("c", &authResult{})
	if c.posLen() > 2 {
		t.Fatalf("pos size %d > 2", c.posLen())
	}
}

// TestCache_LRU_PreservesRecentlyUsed asserts the cache is LRU, not "evict
// arbitrary" — a frequently accessed entry must survive when new entries push
// the cache past its bound.
func TestCache_LRU_PreservesRecentlyUsed(t *testing.T) {
	c := newTokenCache(3, 3, time.Minute, time.Minute)
	a := &authResult{keyID: "a"}
	b := &authResult{keyID: "b"}
	cc := &authResult{keyID: "c"}
	c.putSuccess("a", a)
	c.putSuccess("b", b)
	c.putSuccess("c", cc)

	// Touch "a" so it becomes most-recently-used; "b" is now LRU.
	if _, ok := c.get("a"); !ok {
		t.Fatal("a should be cached")
	}

	// Insert a 4th entry — "b" should be evicted, "a" must survive.
	c.putSuccess("d", &authResult{keyID: "d"})

	if _, ok := c.get("a"); !ok {
		t.Fatal("most-recently-used entry was evicted")
	}
	if _, ok := c.get("b"); ok {
		t.Fatal("least-recently-used entry should have been evicted")
	}
	if _, ok := c.get("c"); !ok {
		t.Fatal("c should still be cached")
	}
	if _, ok := c.get("d"); !ok {
		t.Fatal("d should be cached")
	}
}

// TestCache_NegativeFloodDoesNotEvictPositives is the load-bearing reason for
// the two-map design: a bad-actor stream of unique invalid tokens fills the
// negative cache but must not push out cached positives for real keys.
func TestCache_NegativeFloodDoesNotEvictPositives(t *testing.T) {
	c := newTokenCache(100, 50, time.Minute, time.Minute)
	good := &authResult{tenantID: "org_1", keyID: "k_good"}
	c.putSuccess("good", good)

	for i := 0; i < 5000; i++ {
		c.putFailure("bad-"+strconv.Itoa(i), errUnauthorized)
	}

	got, ok := c.get("good")
	if !ok || got.result != good {
		t.Fatal("positive entry must survive negative-cache flood")
	}
	if c.negLen() > 50 {
		t.Fatalf("neg cache exceeded bound: %d > 50", c.negLen())
	}
}

// TestCache_Concurrent hammers the cache from many goroutines with -race to
// catch lock/ordering bugs.
func TestCache_Concurrent(t *testing.T) {
	c := newTokenCache(256, 64, time.Minute, time.Minute)

	var wg sync.WaitGroup
	const writers, readers, ops = 16, 16, 500
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < ops; i++ {
				key := "k-" + strconv.Itoa((id*ops+i)%200)
				if i%5 == 0 {
					c.putFailure(key, errUnauthorized)
				} else {
					c.putSuccess(key, &authResult{keyID: key})
				}
			}
		}(w)
	}
	for r := 0; r < readers; r++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < ops; i++ {
				_, _ = c.get("k-" + strconv.Itoa((id*ops+i)%200))
			}
		}(r)
	}
	wg.Wait()

	if c.posLen() > 256 {
		t.Fatalf("pos cache exceeded bound under concurrent load: %d", c.posLen())
	}
	if c.negLen() > 64 {
		t.Fatalf("neg cache exceeded bound under concurrent load: %d", c.negLen())
	}
}
