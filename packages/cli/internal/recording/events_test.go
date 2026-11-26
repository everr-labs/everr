package recording

import (
	"strings"
	"testing"
)

func TestReassemblePutsASplitEventBackTogether(t *testing.T) {
	rows := pieceRows(1, "7", toJSON(t, obj{"type": 4, "timestamp": 5, "data": obj{"href": "x"}}), 3)
	events, gap := reassemble(rows, maxValues)
	if gap || len(events) != 1 {
		t.Fatalf("gap %v, %d events", gap, len(events))
	}
	if href, _ := events[0].data.get("href").str(); events[0].timestamp != 5 || href != "x" {
		t.Fatalf("event = %+v", events[0])
	}
}

func TestReassembleOrdersEventsByTimeAndKeepsSegmentOrderForEqualTimes(t *testing.T) {
	at := func(timestamp int64, tag string) obj {
		return obj{"type": 5, "timestamp": timestamp, "data": obj{"tag": tag}}
	}
	events, gap := reassemble([]row{
		segRow(0, body(t, at(30, "late"), at(40, "last"))),
		segRow(1, body(t, at(10, "early"), at(20, "tie-first"))),
		segRow(2, body(t, at(20, "tie-second"))),
	}, maxValues)
	if gap {
		t.Fatal("gap")
	}
	var got []string
	for _, e := range events {
		tag, _ := e.data.get("tag").str()
		got = append(got, tag)
	}
	if want := "early tie-first tie-second late last"; strings.Join(got, " ") != want {
		t.Fatalf("got %q, want %q", strings.Join(got, " "), want)
	}
}

func TestReassembleSkipsItemsThatAreNotEvents(t *testing.T) {
	events, gap := reassemble([]row{segRow(0, body(t,
		1, obj{"type": 2}, obj{"type": 4, "timestamp": 1, "data": nil}, obj{"type": 4, "timestamp": 1, "data": obj{}},
	))}, maxValues)
	if gap || len(events) != 1 {
		t.Fatalf("gap %v, %d events", gap, len(events))
	}
}

func TestReassembleFindsEveryKindOfGap(t *testing.T) {
	ok := body(t, obj{"type": 4, "timestamp": 1, "data": obj{}})
	for name, rows := range map[string][]row{
		"a missing Segment":                 {segRow(0, ok), segRow(2, ok)},
		"a Body that is not JSON":           {segRow(0, ok), segRow(1, "not json")},
		"a Segment stored twice, different": {segRow(0, ok), segRow(0, "[]")},
		"a missing piece":                   pieceRows(0, "3", ok, 3)[:2],
	} {
		if _, gap := reassemble(rows, maxValues); !gap {
			t.Errorf("%s: no gap", name)
		}
	}
	if _, gap := reassemble([]row{segRow(0, ok), segRow(0, ok), segRow(1, ok)}, maxValues); gap {
		t.Error("a Segment stored twice, the same: gap")
	}
}

func TestReassembleReadsSegmentsWithTheBodyEmptyAsNoEventsAndNoGap(t *testing.T) {
	ok := body(t, obj{"type": 4, "timestamp": 1, "data": obj{}})
	// A Clip opens and closes with a Segment, and both are [] when nothing was unsent.
	events, gap := reassemble([]row{segRow(0, "[]"), segRow(1, ok), segRow(2, "[]"), segRow(2, "[]")}, maxValues)
	if gap || len(events) != 1 {
		t.Fatalf("gap %v, %d events", gap, len(events))
	}
	events, gap = reassemble([]row{segRow(7, "[]"), segRow(8, "[]")}, maxValues)
	if gap || len(events) != 0 {
		t.Fatalf("only []: gap %v, %d events", gap, len(events))
	}
}

func TestReassembleRefusesBodiesPastTheValueBudgetAsGaps(t *testing.T) {
	event := body(t, obj{"type": 4, "timestamp": 1, "data": obj{"href": "x"}})
	events, gap := reassemble([]row{segRow(0, event), segRow(1, event), segRow(2, event)}, 12)
	if !gap || len(events) != 2 {
		t.Fatalf("gap %v, %d events", gap, len(events))
	}
}

func TestJSIndexIsNumberAsAnIndex(t *testing.T) {
	for text, want := range map[string]int{"": 0, " 3 ": 3, "1e1": 10} {
		if got, ok := jsIndex(text); !ok || got != want {
			t.Errorf("jsIndex(%q) = %d, %v", text, got, ok)
		}
	}
	for _, text := range []string{"-1", "1.5", "x", "NaN", "Infinity"} {
		if _, ok := jsIndex(text); ok {
			t.Errorf("jsIndex(%q) is an index", text)
		}
	}
}

// Clip A (from Generation 5) sent Segments 0 to 2. Clip B, opened later and
// reaching back to Generation 4, sent that as 3 to 5 and then Generation 5
// went on as 6. A read of A gets 0, 1, 2 and 6, and 3 to 5 as `earlier` rows.
func sentOutOfOrder(t *testing.T, start int64, earlier ...row) []row {
	typed := func(at int64, text string) string { return body(t, input(at, 13, text)) }
	rows := []row{
		segRow(0, body(t, meta(start, "https://x/p"), snapshot(start+10, formSnapshot()))),
		segRow(1, typed(start+100, "a")),
		segRow(2, typed(start+200, "ab")),
		segRow(6, typed(start+300, "abc")),
	}
	return append(rows, earlier...)
}

func TestPageTextTakesSegmentsFromBeforeTheClipAsNotMissing(t *testing.T) {
	start := ms(t, checkoutStart)
	rows := sentOutOfOrder(t, start, earlierRow(3), earlierRow(4), earlierRow(5))

	got := show(t, wireOf(t, start+1_000, rows...), checkoutStart, Outline)

	if header, _, _ := strings.Cut(got, "\n"); strings.Contains(header, "coverage incomplete") {
		t.Fatalf("header %q", header)
	}
	if !strings.Contains(got, `input name="email" type="email" value="abc"`) {
		t.Fatalf("the events of 0, 1, 2 and 6 are not all on the page:\n%s", got)
	}
}

func TestPageTextCountsOnlyTheMissingIndexesAbsentFromTheWholeStream(t *testing.T) {
	start := ms(t, checkoutStart)
	incomplete := func(rows []row) bool {
		got := show(t, wireOf(t, start+1_000, rows...), checkoutStart, Outline)
		header, _, _ := strings.Cut(got, "\n")
		return strings.HasSuffix(header, " coverage incomplete")
	}
	if !incomplete(sentOutOfOrder(t, start, earlierRow(3), earlierRow(5))) {
		t.Error("3 and 5 from before the Clip, no 4: coverage complete")
	}
	if !incomplete(sentOutOfOrder(t, start)) {
		t.Error("a plain hole: coverage complete")
	}
}

func TestReassembleSkipsTheBodiesOfSegmentsFromBeforeTheClip(t *testing.T) {
	ok := body(t, obj{"type": 4, "timestamp": 1, "data": obj{}})
	// Not parsed (it is not JSON), not a piece of an event, not a conflict.
	stub := row{segmentIndex: 1, earlier: true, body: "not json", eventIndex: "7", piece: "0", pieces: "2"}
	events, gap := reassemble([]row{segRow(0, ok), stub, segRow(1, ok), segRow(2, ok)}, maxValues)
	if gap || len(events) != 3 {
		t.Fatalf("gap %v, %d events", gap, len(events))
	}
}

func TestReassembleIgnoresSegmentsFromBeforeTheClipOutsideTheRangeRead(t *testing.T) {
	ok := body(t, obj{"type": 4, "timestamp": 1, "data": obj{}})
	if _, gap := reassemble([]row{earlierRow(0), earlierRow(7), segRow(3, ok), segRow(4, ok), earlierRow(9)}, maxValues); gap {
		t.Error("indexes outside the read ones counted as holes")
	}
}
