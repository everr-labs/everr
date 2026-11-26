package datemath

import (
	"strings"
	"testing"
	"time"
)

// 2026-11-14T10:21:41Z
var now = time.Unix(1_794_651_701, 0)

func instant(t *testing.T, raw string) (string, error) {
	t.Helper()
	at, err := ResolveInstant(raw, now)
	return at.Format("2006-01-02T15:04:05.000Z07:00"), err
}

func TestInstantKeepsMillisecondsAndConvertsOffsetsToUTC(t *testing.T) {
	for raw, want := range map[string]string{
		"2026-11-14T10:21:41.730Z":      "2026-11-14T10:21:41.730Z",
		"2026-11-14T11:21:41.730+01:00": "2026-11-14T10:21:41.730Z",
		"2026-11-14T10:21:41Z":          "2026-11-14T10:21:41.000Z",
		"2026-11-14T05:21:41.5-05:00":   "2026-11-14T10:21:41.500Z",
		"2026-11-14T10:21:41.7309Z":     "2026-11-14T10:21:41.730Z",
	} {
		if got, err := instant(t, raw); err != nil || got != want {
			t.Errorf("%s = %s, %v; want %s", raw, got, err, want)
		}
	}
}

func TestInstantReadsEpochMillisecondsAndSecondsByDigitCount(t *testing.T) {
	for raw, want := range map[string]string{
		"1794651701730": "2026-11-14T10:21:41.730Z",
		"1794651701":    "2026-11-14T10:21:41.000Z",
	} {
		if got, err := instant(t, raw); err != nil || got != want {
			t.Errorf("%s = %s, %v; want %s", raw, got, err, want)
		}
	}
	for _, raw := range []string{"1", "12345", "179465170173", "17946517017300"} {
		if _, err := instant(t, raw); err == nil || !strings.Contains(err.Error(), "13 digits") {
			t.Errorf("%s: %v", raw, err)
		}
	}
}

func TestInstantResolvesDateMathAgainstNow(t *testing.T) {
	for raw, want := range map[string]string{
		"now":                           "2026-11-14T10:21:41.000Z",
		"now-1h":                        "2026-11-14T09:21:41.000Z",
		"now - 5m":                      "2026-11-14T10:16:41.000Z",
		"now-7d/d":                      "2026-11-07T00:00:00.000Z",
		"now/w":                         "2026-11-09T00:00:00.000Z",
		"now+d":                         "2026-11-15T10:21:41.000Z",
		"2026-11-14":                    "2026-11-14T00:00:00.000Z",
		"2024-01-31||+1M":               "2024-02-29T00:00:00.000Z",
		"2024-02-29||+1y/M":             "2025-02-01T00:00:00.000Z",
		"2024-06-15||-1M/y":             "2024-01-01T00:00:00.000Z",
		"2026-11-14T10:21:41.900Z||+1s": "2026-11-14T10:21:42.000Z",
	} {
		if got, err := instant(t, raw); err != nil || got != want {
			t.Errorf("%s = %s, %v; want %s", raw, got, err, want)
		}
	}
}

func TestInstantRefusesACivilTimeWithoutAZone(t *testing.T) {
	for _, raw := range []string{"2026-11-14 10:21:41", "2026-11-14T10:21:41", "2026-11-14 10:21:41.730"} {
		_, err := instant(t, raw)
		if err == nil || !strings.Contains(err.Error(), "no time zone") || !strings.Contains(err.Error(), "toUnixTimestamp64Milli(Timestamp)") {
			t.Errorf("%s: %v", raw, err)
		}
	}
}

func TestInstantGarbageNamesTheAcceptedForms(t *testing.T) {
	for _, raw := range []string{"", "yesterday", "now+1x", "now+", "now/", "now*2"} {
		_, err := instant(t, raw)
		if err == nil {
			t.Errorf("%q resolved", raw)
			continue
		}
		for _, form := range []string{"RFC 3339", "epoch", "date math"} {
			if !strings.Contains(err.Error(), form) {
				t.Errorf("%q: %v", raw, err)
			}
		}
	}
}
