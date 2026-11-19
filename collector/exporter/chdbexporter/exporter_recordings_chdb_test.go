package chdbexporter

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.uber.org/zap/zaptest"
)

func newRecordingsExporter(t *testing.T) (*logsJSONExporter, *Config) {
	t.Helper()
	handle := openRealChDB(t)
	cfg := withDefaultConfig(func(c *Config) {
		c.JSON = true
		c.LogsTableName = "recordings"
		c.LogsLayout = LogsLayoutRecordings
	})
	exp := newLogsJSONExporter(zaptest.NewLogger(t), cfg, newStore(handle))
	require.NoError(t, exp.start(t.Context(), nil))
	t.Cleanup(func() { _ = exp.shutdown(context.Background()) })
	return exp, cfg
}

type segment struct {
	at    time.Time
	attrs map[string]any
	body  string
}

func segmentLogs(segments ...segment) plog.Logs {
	ld := plog.NewLogs()
	records := ld.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords()
	for _, s := range segments {
		record := records.AppendEmpty()
		record.SetTimestamp(pcommon.NewTimestampFromTime(s.at))
		record.SetEventName("everr.browser.recording.segment")
		record.Body().SetStr(s.body)
		if err := record.Attributes().FromRaw(s.attrs); err != nil {
			panic(err)
		}
	}
	return ld
}

func TestRecordingsLayoutFillsTheSegmentColumnsAndServesAStreamRead(t *testing.T) {
	exp, cfg := newRecordingsExporter(t)
	handle := exp.store.handle

	base := roundTripTime
	require.NoError(t, exp.pushLogsData(t.Context(), segmentLogs(
		// Out of arrival order on purpose: the reader orders by time.
		segment{base.Add(2 * time.Second), map[string]any{
			"session.id": "s1", "everr.recording.stream.id": "stream-a", "everr.recording.segment.index": int64(1),
		}, "[2]"},
		segment{base, map[string]any{
			"session.id": "s1", "everr.recording.stream.id": "stream-a", "everr.recording.segment.index": int64(0),
		}, "[1]"},
		segment{base.Add(time.Second), map[string]any{
			"session.id": "s2", "everr.recording.stream.id": "stream-b", "everr.recording.segment.index": int64(0),
		}, "[other stream]"},
	)))

	// The reader the cloud app runs against app.recordings, unchanged.
	rows := queryJSONRows(t, handle,
		`SELECT Body AS body, session_id, stream_id, segment_index FROM "`+cfg.database()+`"."`+cfg.LogsTableName+`"`+
			` WHERE stream_id = 'stream-a' ORDER BY Timestamp, segment_index`)
	require.Len(t, rows, 2)
	require.Equal(t, "[1]", rows[0]["body"])
	require.Equal(t, "[2]", rows[1]["body"])
	require.Equal(t, "s1", rows[0]["session_id"])
	require.Equal(t, "stream-a", rows[0]["stream_id"])
	require.EqualValues(t, 0, rows[0]["segment_index"])
	require.EqualValues(t, 1, rows[1]["segment_index"])
}

func TestRecordingsLayoutInsertsSegmentsWithMissingOrMalformedAttributes(t *testing.T) {
	exp, cfg := newRecordingsExporter(t)
	handle := exp.store.handle

	cases := map[string]map[string]any{
		"no attributes":       {},
		"index is text":       {"everr.recording.stream.id": "x", "everr.recording.segment.index": "abc"},
		"index is negative":   {"everr.recording.stream.id": "x", "everr.recording.segment.index": int64(-4)},
		"index is fractional": {"everr.recording.stream.id": "x", "everr.recording.segment.index": 2.5},
		"index is a list":     {"everr.recording.stream.id": "x", "everr.recording.segment.index": []any{1, 2}},
		"index is a map":      {"everr.recording.stream.id": "x", "everr.recording.segment.index": map[string]any{"n": 1}},
		"ids are numbers":     {"session.id": int64(7), "everr.recording.stream.id": int64(8), "everr.recording.segment.index": int64(9)},
		"ids are lists":       {"session.id": []any{"a"}, "everr.recording.stream.id": []any{"b"}},
	}
	var segments []segment
	var names []string
	for name, attrs := range cases {
		names = append(names, name)
		segments = append(segments, segment{roundTripTime, attrs, name})
	}
	require.NoError(t, exp.pushLogsData(t.Context(), segmentLogs(segments...)),
		"one malformed Segment must not fail the insert of its batch")

	rows := queryJSONRows(t, handle,
		`SELECT Body AS body, session_id, stream_id, segment_index FROM "`+cfg.database()+`"."`+cfg.LogsTableName+`"`)
	require.Len(t, rows, len(cases))

	byName := map[string]map[string]any{}
	for _, row := range rows {
		byName[row["body"].(string)] = row
	}
	require.ElementsMatch(t, names, keysOf(byName))

	require.Equal(t, "", byName["no attributes"]["stream_id"])
	require.EqualValues(t, 0, byName["no attributes"]["segment_index"])
	require.EqualValues(t, 0, byName["index is text"]["segment_index"])
	require.EqualValues(t, 0, byName["index is negative"]["segment_index"])
	require.EqualValues(t, 9, byName["ids are numbers"]["segment_index"])
	require.Equal(t, "8", byName["ids are numbers"]["stream_id"])
}

func keysOf(m map[string]map[string]any) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	return keys
}

func TestRecordingsLayoutHoldsASegmentSizedBody(t *testing.T) {
	exp, cfg := newRecordingsExporter(t)
	handle := exp.store.handle

	body := "[" + strings.Repeat(`{"type":3}`, 95000) + "]" // about 950 KB
	require.NoError(t, exp.pushLogsData(t.Context(), segmentLogs(segment{roundTripTime, map[string]any{
		"everr.recording.stream.id": "big", "everr.recording.segment.index": int64(0),
	}, body})))

	rows := queryJSONRows(t, handle,
		`SELECT toString(length(Body)) AS bytes FROM "`+cfg.database()+`"."`+cfg.LogsTableName+`" WHERE stream_id = 'big'`)
	require.Len(t, rows, 1)
	require.Equal(t, "950002", rows[0]["bytes"])
}
