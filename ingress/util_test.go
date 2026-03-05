package main

import (
	"testing"
	"time"
)

func TestIsRetryableStatus(t *testing.T) {
	t.Parallel()

	if !isRetryableStatus(408) || !isRetryableStatus(429) || !isRetryableStatus(500) || !isRetryableStatus(503) {
		t.Fatalf("expected retryable status")
	}
	if isRetryableStatus(400) || isRetryableStatus(404) {
		t.Fatalf("expected terminal status")
	}
}

func TestRetryDelayBounds(t *testing.T) {
	t.Parallel()

	for attempt := 1; attempt <= 12; attempt++ {
		d := retryDelay(attempt)
		if d < time.Second {
			t.Fatalf("delay too small: %s", d)
		}
		if d > 18*time.Minute {
			t.Fatalf("delay too large: %s", d)
		}
	}
}
