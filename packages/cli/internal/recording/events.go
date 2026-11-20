package recording

// The rrweb events of a read, put back together from its Segment rows.
//
// A Segment Body is a JSON array of events; an event too large for one
// Segment is split into pieces across rows. Anything a read lacks (a missing
// index, a Body that is not JSON, a Segment stored twice with different
// bodies, an event with pieces missing) is a gap: the page read from the
// events is marked incomplete.

import (
	"cmp"
	"maps"
	"math"
	"slices"
	"strconv"
	"strings"
)

// event is an rrweb event: `type` and `timestamp` are numbers, `data` an
// object or an array.
type event struct {
	kind      float64
	timestamp float64
	data      Json
}

func toEvent(value Json) (event, bool) {
	kind, ok := value.get("type").num()
	if !ok {
		return event{}, false
	}
	timestamp, ok := value.get("timestamp").num()
	if !ok {
		return event{}, false
	}
	data, ok := value.take("data")
	if !ok || (data.kind != jsonObj && data.kind != jsonArr) {
		return event{}, false
	}
	return event{kind: kind, timestamp: timestamp, data: data}, true
}

// reassemble gives the events of the rows in time order, and whether the read
// has a gap. The Bodies may hold at most budget values between them; one past
// that is a Body that is not JSON.
//
// The SDK numbers Segments as it sends them, and a Clip can send an older
// Generation after a newer one, so the Segment index orders the pieces of an
// event and finds gaps, not the page's history. Events of equal time stay in
// Segment order.
//
// An `earlier` row names a Segment from before the Clip: it can sit between
// two read ones, so its index is no hole. It holds no events and is otherwise
// skipped.
func reassemble(rows []row, budget int) ([]event, bool) {
	gap := false

	// A Segment stored twice counts once; twice with different bodies is a gap.
	segments := make([]row, 0, len(rows))
	seen := make(map[uint64]int, len(rows))
	var earlier []uint64
	for _, r := range rows {
		if r.earlier {
			earlier = append(earlier, r.segmentIndex)
			continue
		}
		if at, ok := seen[r.segmentIndex]; ok {
			gap = gap || segments[at].body != r.body
			continue
		}
		seen[r.segmentIndex] = len(segments)
		segments = append(segments, r)
	}
	slices.SortStableFunc(segments, func(a, b row) int {
		switch {
		case a.segmentIndex < b.segmentIndex:
			return -1
		case a.segmentIndex > b.segmentIndex:
			return 1
		}
		return 0
	})
	// Between two read indexes, a hole is an index no earlier Segment holds.
	earlier = slices.Compact(slices.Sorted(slices.Values(earlier)))
	for i := 1; i < len(segments); i++ {
		low, high := segments[i-1].segmentIndex, segments[i].segmentIndex
		if high-low <= 1 {
			continue
		}
		from, _ := slices.BinarySearch(earlier, low+1)
		to, _ := slices.BinarySearch(earlier, high)
		if uint64(to-from) < high-low-1 {
			gap = true
		}
	}

	type slot struct {
		parts    map[int]string
		count    int
		hasCount bool
	}
	var events []event
	open := map[string]*slot{}
	for _, segment := range segments {
		if segment.pieces == "" {
			value, ok := parseJSON(segment.body, &budget)
			if !ok {
				gap = true
				continue
			}
			if value.kind == jsonArr {
				for _, item := range value.items {
					if e, ok := toEvent(item.value); ok {
						events = append(events, e)
					}
				}
			}
			continue
		}
		s := open[segment.eventIndex]
		if s == nil {
			s = &slot{parts: map[int]string{}}
			open[segment.eventIndex] = s
		}
		if piece, ok := jsIndex(segment.piece); ok {
			s.parts[piece] = segment.body
		}
		s.count, s.hasCount = jsIndex(segment.pieces)
		if s.hasCount && s.count == len(s.parts) {
			delete(open, segment.eventIndex)
			var whole strings.Builder
			for _, piece := range slices.Sorted(maps.Keys(s.parts)) {
				whole.WriteString(s.parts[piece])
			}
			value, ok := parseJSON(whole.String(), &budget)
			if !ok {
				gap = true
				continue
			}
			if e, ok := toEvent(value); ok {
				events = append(events, e)
			}
		}
	}
	slices.SortStableFunc(events, func(a, b event) int { return cmp.Compare(a.timestamp, b.timestamp) })
	return events, gap || len(open) > 0
}

// jsIndex is JavaScript's `Number(text)` as an index: "" is 0, anything else
// a whole number or nothing.
func jsIndex(text string) (int, bool) {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0, true
	}
	n, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsInf(n, 0) || math.IsNaN(n) || n < 0 || n != math.Trunc(n) || n > math.MaxInt32 {
		return 0, false
	}
	return int(n), true
}
