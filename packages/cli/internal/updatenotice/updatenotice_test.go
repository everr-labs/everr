package updatenotice

import (
	"testing"
	"time"
)

func TestIsNewerComparesSemver(t *testing.T) {
	for _, tc := range []struct {
		latest, current string
		want            bool
	}{
		{"0.10.0", "0.9.0", true},
		{"0.9.0", "0.9.0", false},
		{"0.9.0", "0.10.0", false},
		{"1.0.0", "1.0.0-rc.1", true},
		{"v1.0.0", "0.9.0", false},
		{"garbage", "0.9.0", false},
	} {
		if got := IsNewer(tc.latest, tc.current); got != tc.want {
			t.Errorf("IsNewer(%q, %q) = %v", tc.latest, tc.current, got)
		}
	}
}

func TestCacheIsStaleAfterCheckInterval(t *testing.T) {
	now := time.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC)
	for checkedAt, want := range map[string]bool{
		"2026-01-02T11:00:00+00:00":      false,
		"2026-01-02T11:00:00.123456789Z": false,
		"2026-01-01T11:00:00+00:00":      true,
		"2099-01-01T00:00:00Z":           true,
		"not a timestamp":                true,
	} {
		if got := isStale(cacheFile{LastCheckedAt: checkedAt}, now); got != want {
			t.Errorf("isStale(%q) = %v, want %v", checkedAt, got, want)
		}
	}
}

func TestWrittenTimestampsParseBack(t *testing.T) {
	now := time.Now()
	cache := cacheFile{LastCheckedAt: now.UTC().Format(timestampLayout)}
	if isStale(cache, now) {
		t.Fatalf("fresh timestamp %q reads as stale", cache.LastCheckedAt)
	}
}
