package recording

import (
	"strings"
	"testing"
)

func TestReassemblePutsASplitEventBackTogether(t *testing.T) {
	rows := pieceRows(1, "7", toJSON(t, obj{"type": 4, "timestamp": 5, "data": obj{"href": "x"}}), 3)
	events, gap := reassemble(rows)
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
	})
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
	))})
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
		if _, gap := reassemble(rows); !gap {
			t.Errorf("%s: no gap", name)
		}
	}
	if _, gap := reassemble([]row{segRow(0, ok), segRow(0, ok), segRow(1, ok)}); gap {
		t.Error("a Segment stored twice, the same: gap")
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
