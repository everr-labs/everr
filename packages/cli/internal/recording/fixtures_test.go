package recording

// rrweb nodes and events, Segment rows, and segments response bodies for the
// tests. Objects are maps, so they serialize with their keys sorted.

import (
	"encoding/json"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

type obj = map[string]any

var nextID atomic.Int64

func init() { nextID.Store(1000) }

// el is an element node; elID when a test names it.
func el(tag string, attributes obj, children ...any) obj {
	return elID(tag, attributes, children, nextID.Add(1))
}

func elID(tag string, attributes obj, children []any, id int64) obj {
	if children == nil {
		children = []any{}
	}
	return obj{"type": 2, "tagName": tag, "attributes": attributes, "childNodes": children, "id": id}
}

func text(content string) obj { return textID(content, nextID.Add(1)) }

func textID(content string, id int64) obj {
	return obj{"type": 3, "textContent": content, "id": id}
}

// doc is a document: html (2), head (3), and a body (4) holding children.
func doc(children ...any) obj {
	return obj{"type": 0, "id": 1, "childNodes": []any{elID("html", obj{}, []any{
		elID("head", obj{}, nil, 3),
		elID("body", obj{}, children, 4),
	}, 2)}}
}

// formSnapshot is a page with a head, a body (10), a form, and replay-only attributes.
func formSnapshot() obj {
	return obj{"type": 0, "id": 1, "childNodes": []any{elID("html", obj{}, []any{
		elID("head", obj{}, []any{
			obj{"type": 2, "tagName": "link", "attributes": obj{"rel": "stylesheet", "_cssText": "body { margin: 0 }"}, "id": 4},
		}, 3),
		elID("body", obj{}, []any{
			elID("h1", obj{"style": "color: red"}, []any{textID("Checkout", 12)}, 11),
			obj{"type": 2, "tagName": "input", "attributes": obj{"name": "email", "type": "email", "rr_width": "120px"}, "id": 13},
			elID("button", obj{"id": "pay"}, []any{textID("Pay now", 15)}, 14),
			elID("script", obj{}, nil, 16),
			elID("div", obj{}, []any{textID("Plain", 18)}, 17),
		}, 10),
	}, 2)}}
}

func snapshot(at int64, node obj) obj {
	return obj{"type": 2, "timestamp": at, "data": obj{"node": node}}
}

func meta(at int64, href string) obj {
	return obj{"type": 4, "timestamp": at, "data": obj{"href": href, "width": 1280, "height": 800}}
}

func input(at, id int64, text string) obj {
	return obj{"type": 3, "timestamp": at, "data": obj{"source": 5, "id": id, "text": text, "isChecked": false}}
}

// mutation is a mutation event; changes fills in its lists.
func mutation(at int64, changes obj) obj {
	data := obj{"source": 0, "texts": []any{}, "attributes": []any{}, "removes": []any{}, "adds": []any{}}
	for key, value := range changes {
		data[key] = value
	}
	return obj{"type": 3, "timestamp": at, "data": data}
}

func toJSON(t testing.TB, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// body is a Segment Body: a JSON array of events.
func body(t testing.TB, events ...any) string {
	if events == nil {
		events = []any{}
	}
	return toJSON(t, events)
}

func segRow(index uint64, body string) row {
	return row{segmentIndex: index, body: body}
}

// pieceRows gives one event's JSON in `pieces` rows from first, cut at byte
// boundaries. An empty eventIndex makes plain rows.
func pieceRows(first uint64, eventIndex, json string, pieces int) []row {
	size := (len(json) + pieces - 1) / pieces
	var out []row
	for piece := 0; piece*size < len(json); piece++ {
		r := row{segmentIndex: first + uint64(piece), body: json[piece*size : min((piece+1)*size, len(json))], eventIndex: eventIndex}
		if eventIndex != "" {
			r.piece, r.pieces = strconv.Itoa(piece), strconv.Itoa(pieces)
		}
		out = append(out, r)
	}
	return out
}

// wireOf is a segments response body.
func wireOf(t testing.TB, readMs int64, rows ...row) []byte {
	out := toJSON(t, obj{"format": 1, "read_ms": readMs})
	for _, r := range rows {
		out += "\n" + toJSON(t, obj{
			"segment_index": r.segmentIndex,
			"Body":          r.body,
			"event_index":   r.eventIndex,
			"piece":         r.piece,
			"pieces":        r.pieces,
		})
	}
	return []byte(out + "\n" + toJSON(t, obj{"rows": len(rows)}) + "\n")
}

func ms(t testing.TB, iso string) int64 {
	t.Helper()
	at, err := time.Parse(time.RFC3339Nano, iso)
	if err != nil {
		t.Fatal(err)
	}
	return at.UnixMilli()
}

func parsed(t testing.TB, value any) Json {
	t.Helper()
	out, ok := parseJSON(toJSON(t, value), unlimited())
	if !ok {
		t.Fatalf("not JSON: %v", value)
	}
	return out
}

func eventOf(t testing.TB, value obj) event {
	t.Helper()
	e, ok := toEvent(parsed(t, value))
	if !ok {
		t.Fatalf("not an event: %v", value)
	}
	return e
}
