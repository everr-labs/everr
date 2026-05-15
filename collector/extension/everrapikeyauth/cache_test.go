package everrapikeyauth

import (
	"errors"
	"testing"
	"time"
)

func TestCache_PositiveTTL(t *testing.T) {
	now := time.Unix(0, 0)
	c := newTokenCache(10, time.Second, time.Second)
	c.now = func() time.Time { return now }

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
	c := newTokenCache(10, 30*time.Second, 5*time.Second)
	c.now = func() time.Time { return now }

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
	c := newTokenCache(2, time.Minute, time.Minute)
	c.putSuccess("a", &authResult{})
	c.putSuccess("b", &authResult{})
	c.putSuccess("c", &authResult{})
	if len(c.entries) > 2 {
		t.Fatalf("size %d > 2", len(c.entries))
	}
}
