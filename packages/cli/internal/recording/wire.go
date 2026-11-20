package recording

// The body of `GET /api/cli/recordings/segments`: one JSON value per line.
//
//	{"format":1,"read_ms":1794651702480}       the moment the page is read at
//	{"segment_index":0,"Body":"[...]","event_index":"","piece":"","pieces":"","earlier":0}
//	...                                         one line per Segment row, as ClickHouse wrote it
//	{"rows":1}                                  the end, with the number of rows
//
// A row with "earlier":1 only names the index of a Segment from before the
// Clip, with an empty Body. A row without "earlier" is a Segment of the Clip.
//
// A body without its end line was cut short.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/everr-labs/everr/packages/cli/internal/build"
)

// wireFormat is the body format this CLI reads. The server sends it on the
// first line.
const wireFormat = 1

// row is a Segment row. `pieces` is set on the rows of an event too large for
// one Segment: `piece` of `pieces` for the event `event_index`. An `earlier`
// row holds no events: it is the index of a Segment from before the Clip.
type row struct {
	segmentIndex uint64
	body         string
	eventIndex   string
	piece        string
	pieces       string
	earlier      bool
}

type wire struct {
	readMs int64
	rows   []row
}

var errCutShort = errors.New("The Recording read was cut short. Retry.")

func readWire(body []byte) (wire, error) {
	lines := bytes.Split(body, []byte("\n"))
	next := 0
	nextLine := func() ([]byte, bool) {
		for next < len(lines) {
			line := lines[next]
			next++
			if len(line) > 0 {
				return line, true
			}
		}
		return nil, false
	}

	var header struct {
		Format *uint64 `json:"format"`
		ReadMs *int64  `json:"read_ms"`
	}
	line, ok := nextLine()
	if !ok || json.Unmarshal(line, &header) != nil || header.Format == nil || header.ReadMs == nil {
		return wire{}, fmt.Errorf("The installation answered the Recording read in a form this CLI does not read. Run `%s upgrade`, then retry.", build.CommandName())
	}
	if *header.Format != wireFormat {
		return wire{}, fmt.Errorf("The installation sends Recording format %d, and this CLI reads format %d. Run `%s upgrade`, then retry.", *header.Format, wireFormat, build.CommandName())
	}

	out := wire{readMs: *header.ReadMs}
	var end *uint64
	for {
		line, ok := nextLine()
		if !ok {
			break
		}
		if end != nil {
			return wire{}, errCutShort
		}
		if r, ok := parseRow(line); ok {
			out.rows = append(out.rows, r)
			continue
		}
		var last struct {
			Rows *uint64 `json:"rows"`
		}
		if json.Unmarshal(line, &last) != nil || last.Rows == nil {
			return wire{}, errCutShort
		}
		end = last.Rows
	}
	if end == nil || *end != uint64(len(out.rows)) {
		return wire{}, errCutShort
	}
	return out, nil
}

func parseRow(line []byte) (row, bool) {
	var r struct {
		SegmentIndex *uint64 `json:"segment_index"`
		Body         *string `json:"Body"`
		EventIndex   *string `json:"event_index"`
		Piece        *string `json:"piece"`
		Pieces       *string `json:"pieces"`
		Earlier      uint8   `json:"earlier"`
	}
	if json.Unmarshal(line, &r) != nil || r.SegmentIndex == nil || r.Body == nil ||
		r.EventIndex == nil || r.Piece == nil || r.Pieces == nil {
		return row{}, false
	}
	return row{
		segmentIndex: *r.SegmentIndex,
		body:         *r.Body,
		eventIndex:   *r.EventIndex,
		piece:        *r.Piece,
		pieces:       *r.Pieces,
		earlier:      r.Earlier == 1,
	}, true
}
