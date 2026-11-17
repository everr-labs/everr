// Package datemath resolves the time arguments commands send to the server.
package datemath

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// ResolveInstant resolves a time argument to a UTC instant with millisecond
// precision. Every command that sends a time to the server should use it.
//
// Accepted:
//  1. RFC 3339 with a zone, milliseconds kept, converted to UTC.
//  2. Epoch time as digits only: 13 digits are milliseconds, 10 are seconds.
//  3. Date math: `now`, `now-1h`, `now-7d/d`, `2024-01-01||+1M`.
//
// Refused: a civil date-time with no zone (what `everr cloud query` prints
// for a DateTime64). The server would read it in its own zone and shift the
// moment silently.
func ResolveInstant(raw string, now time.Time) (time.Time, error) {
	raw = strings.TrimSpace(raw)

	if raw != "" && strings.Trim(raw, "0123456789") == "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return time.Time{}, errors.New("epoch time is out of range")
		}
		switch len(raw) {
		case 13:
			return time.UnixMilli(value).UTC(), nil
		case 10:
			return time.Unix(value, 0).UTC(), nil
		}
		return time.Time{}, fmt.Errorf("%d digits is not an epoch time: use 13 digits for milliseconds or 10 for seconds", len(raw))
	}

	if instant, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return instant.UTC().Truncate(time.Millisecond), nil
	}

	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02T15:04:05"} {
		// A fraction after the seconds parses without being in the layout.
		if _, err := time.Parse(layout, raw); err == nil {
			return time.Time{}, errors.New("no time zone: add Z or an offset, pass epoch milliseconds, or select `toUnixTimestamp64Milli(Timestamp)`")
		}
	}

	resolved, err := Resolve(raw, now)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w; expected RFC 3339 with a zone (2026-11-14T10:21:41.730Z), epoch milliseconds or seconds, or date math (now-6h)", err)
	}
	return resolved.UTC(), nil
}

// Resolve evaluates a date math expression: `now` or an ISO-8601 date (before
// `||` when math follows), then operators `+`, `-`, and `/` (round down)
// with an optional amount and a unit (s, m, h, d, w, M, y). The anchor is
// taken in whole seconds.
func Resolve(expression string, now time.Time) (time.Time, error) {
	input := strings.Map(func(c rune) rune {
		if unicode.IsSpace(c) {
			return -1
		}
		return c
	}, expression)
	if input == "" {
		return time.Time{}, errors.New("Empty expression")
	}

	var at time.Time
	var math string
	if rest, ok := strings.CutPrefix(input, "now"); ok {
		at, math = now, rest
	} else {
		anchor, rest, _ := strings.Cut(input, "||")
		parsed, err := parseAnchor(anchor)
		if err != nil {
			return time.Time{}, err
		}
		at, math = parsed, rest
	}
	at = at.UTC().Truncate(time.Second)

	for pos := 0; pos < len(math); {
		switch op := math[pos]; op {
		case '/':
			pos++
			if pos >= len(math) {
				return time.Time{}, errors.New("Expected unit after /")
			}
			unit := math[pos]
			if !validUnit(unit) {
				return time.Time{}, fmt.Errorf("Invalid unit: %c", unit)
			}
			at = roundDown(at, unit)
			pos++
		case '+', '-':
			pos++
			start := pos
			for pos < len(math) && math[pos] >= '0' && math[pos] <= '9' {
				pos++
			}
			if pos >= len(math) {
				return time.Time{}, errors.New("Expected unit after operator")
			}
			unit := math[pos]
			if !validUnit(unit) {
				return time.Time{}, fmt.Errorf("Invalid unit: %c", unit)
			}
			amount := 1
			if digits := math[start:pos]; digits != "" {
				n, err := strconv.ParseUint(digits, 10, 32)
				if err != nil {
					return time.Time{}, fmt.Errorf("Invalid number: %s", digits)
				}
				amount = int(n)
			}
			if op == '-' {
				amount = -amount
			}
			at = add(at, amount, unit)
			pos++
		default:
			return time.Time{}, fmt.Errorf("Unexpected character: %c", op)
		}
	}
	return at, nil
}

func parseAnchor(anchor string) (time.Time, error) {
	if anchor == "" {
		return time.Time{}, errors.New("Empty anchor")
	}
	for _, layout := range []string{"2006-01-02", time.RFC3339Nano} {
		if at, err := time.Parse(layout, anchor); err == nil {
			return at, nil
		}
	}
	return time.Time{}, fmt.Errorf("Invalid date anchor: %s", anchor)
}

func validUnit(unit byte) bool { return strings.IndexByte("smhdwMy", unit) >= 0 }

func add(at time.Time, amount int, unit byte) time.Time {
	switch unit {
	case 's':
		return at.Add(time.Duration(amount) * time.Second)
	case 'm':
		return at.Add(time.Duration(amount) * time.Minute)
	case 'h':
		return at.Add(time.Duration(amount) * time.Hour)
	case 'd':
		return at.AddDate(0, 0, amount)
	case 'w':
		return at.AddDate(0, 0, 7*amount)
	case 'M':
		return addMonths(at, amount)
	default: // 'y'
		return addMonths(at, 12*amount)
	}
}

// addMonths keeps the day of the month, clamped to the target month's last
// day: 2024-01-31 plus a month is 2024-02-29.
func addMonths(at time.Time, months int) time.Time {
	year, month, day := at.Date()
	first := time.Date(year, month+time.Month(months), 1, 0, 0, 0, 0, time.UTC)
	last := first.AddDate(0, 1, -1).Day()
	clock := at.Sub(time.Date(year, month, day, 0, 0, 0, 0, time.UTC))
	return first.AddDate(0, 0, min(day, last)-1).Add(clock)
}

// roundDown rounds to the start of the unit, in UTC. Weeks start on Monday.
func roundDown(at time.Time, unit byte) time.Time {
	year, month, day := at.Date()
	switch unit {
	case 's':
		return at
	case 'm':
		return at.Truncate(time.Minute)
	case 'h':
		return at.Truncate(time.Hour)
	case 'd':
		return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
	case 'w':
		start := time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
		return start.AddDate(0, 0, -((int(start.Weekday()) + 6) % 7))
	case 'M':
		return time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
	default: // 'y'
		return time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	}
}
