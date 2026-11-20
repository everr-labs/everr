package chdbexporter

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.uber.org/zap/zaptest"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
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

func TestRenderCreateRecordingsTableSQL(t *testing.T) {
	cfg := withDefaultConfig(func(c *Config) {
		c.JSON = true
		c.LogsTableName = "recordings"
		c.LogsLayout = LogsLayoutRecordings
		c.TTL = 72 * time.Hour
	})

	sql, err := renderCreateLogsJSONTableSQL(cfg)
	require.NoError(t, err)

	for _, column := range []string{"segment_end DateTime64(3)", "clip_start DateTime64(3)", "clip_id String",
		"trigger LowCardinality(String)", "truncated Bool"} {
		require.Contains(t, sql, "`"+strings.Replace(column, " ", "` ", 1))
	}
	require.Contains(t, sql, "PARTITION BY toDate(Timestamp, 'UTC')")
	require.Contains(t, sql, "ORDER BY (toStartOfHour(Timestamp, 'UTC'), stream_id, segment_index)")
	require.Contains(t, sql, "TTL toDateTime(Timestamp, 'UTC') + toIntervalDay(3)")
	require.NotContains(t, sql, "ORDER BY (stream_id, Timestamp")
}

func TestRecordingsLayoutFillsTheClipColumnsAndFallsBackToTheEpoch(t *testing.T) {
	exp, cfg := newRecordingsExporter(t)
	handle := exp.store.handle

	const (
		end   = "everr.recording.segment.end"
		start = "everr.recording.clip.start"
	)
	stream := func(extra map[string]any) map[string]any {
		attrs := map[string]any{"everr.recording.stream.id": "s", "everr.recording.segment.index": int64(0)}
		for key, value := range extra {
			attrs[key] = value
		}
		return attrs
	}
	cases := map[string]map[string]any{
		"normal": stream(map[string]any{
			end: int64(1_700_000_005_250), start: int64(1_700_000_000_000),
			"everr.recording.clip.id": "clip-1", "everr.recording.trigger": "error", "everr.recording.clip.truncated": "true",
		}),
		"missing":         stream(nil),
		"strings":         stream(map[string]any{end: "soon", start: "yesterday", "everr.recording.clip.truncated": "yes"}),
		"numeric string":  stream(map[string]any{end: "1700000005250"}),
		"float":           stream(map[string]any{end: 1.7e12, start: 1700000000000.9}),
		"negative":        stream(map[string]any{end: int64(-1), start: int64(-1_700_000_000_000)}),
		"past the range":  stream(map[string]any{end: 9e18, start: int64(9_000_000_000_000_000_000)}),
		"nested object":   stream(map[string]any{end: map[string]any{"ms": 1}, start: []any{1, 2}, "everr.recording.clip.id": map[string]any{"a": 1}}),
		"infinity":        stream(map[string]any{end: "Infinity", start: "NaN"}),
		"boolean flag":    stream(map[string]any{"everr.recording.clip.truncated": true}),
		"opening segment": stream(map[string]any{start: int64(1_700_000_000_000), "everr.recording.clip.id": "clip-2", "everr.recording.trigger": "manual"}),
	}
	var segments []segment
	for name, attrs := range cases {
		segments = append(segments, segment{roundTripTime, attrs, name})
	}
	require.NoError(t, exp.pushLogsData(t.Context(), segmentLogs(segments...)),
		"one malformed Segment must not fail the insert of its batch")

	rows := queryJSONRows(t, handle,
		`SELECT Body AS body, toString(toUnixTimestamp64Milli(segment_end)) AS segment_end,`+
			` toString(toUnixTimestamp64Milli(clip_start)) AS clip_start, clip_id, trigger, truncated`+
			` FROM "`+cfg.database()+`"."`+cfg.LogsTableName+`"`)
	require.Len(t, rows, len(cases))
	byName := map[string]map[string]any{}
	for _, row := range rows {
		byName[row["body"].(string)] = row
	}

	require.Equal(t, "1700000005250", byName["normal"]["segment_end"])
	require.Equal(t, "1700000000000", byName["normal"]["clip_start"])
	require.Equal(t, "clip-1", byName["normal"]["clip_id"])
	require.Equal(t, "error", byName["normal"]["trigger"])
	require.Equal(t, true, byName["normal"]["truncated"])

	epoch := func(name string) {
		t.Helper()
		require.Equal(t, "0", byName[name]["segment_end"], name)
		require.Equal(t, "0", byName[name]["clip_start"], name)
	}
	for _, name := range []string{"missing", "strings", "negative", "past the range", "nested object", "infinity"} {
		epoch(name)
	}
	require.Equal(t, "1700000005250", byName["numeric string"]["segment_end"])
	require.Equal(t, "1700000000000", byName["float"]["clip_start"], "a fractional millisecond is cut")
	require.Equal(t, "", byName["nested object"]["clip_id"])
	require.Equal(t, false, byName["strings"]["truncated"], "only the text true sets the flag")
	require.Equal(t, "manual", byName["opening segment"]["trigger"])
	require.Equal(t, "", byName["missing"]["trigger"])
}

func TestRecordingsLayoutFindsRowsByATimestampFilter(t *testing.T) {
	exp, cfg := newRecordingsExporter(t)
	handle := exp.store.handle

	var segments []segment
	for hour := range 6 {
		segments = append(segments, segment{
			roundTripTime.Add(time.Duration(-hour) * time.Hour),
			map[string]any{"everr.recording.stream.id": "s", "everr.recording.segment.index": int64(hour)}, "x",
		})
	}
	require.NoError(t, exp.pushLogsData(t.Context(), segmentLogs(segments...)))

	from, to := roundTripTime.Add(-30*time.Minute), roundTripTime.Add(30*time.Minute)
	filter := `Timestamp >= toDateTime64('` + utcSeconds(from) + `', 9, 'UTC') AND Timestamp < toDateTime64('` + utcSeconds(to) + `', 9, 'UTC')`
	rows := queryJSONRows(t, handle, `SELECT count() AS n FROM "`+cfg.database()+`"."`+cfg.LogsTableName+`" WHERE `+filter)
	require.EqualValues(t, 1, rows[0]["n"])
}

func TestRecordingsTableSurvivesAChDBRestart(t *testing.T) {
	// The columns call everrUnixMilliOrEpoch, a function the store keeps on
	// disk. A table that cannot load without it would break every start after
	// the first.
	t.Cleanup(chdb.ResetForTesting)
	path := filepath.Join(t.TempDir(), "chdb")
	cfg := withDefaultConfig(func(c *Config) {
		c.JSON = true
		c.LogsTableName = "recordings"
		c.LogsLayout = LogsLayoutRecordings
	})
	attrs := map[string]any{"everr.recording.stream.id": "s", "everr.recording.segment.end": int64(1_700_000_005_250)}

	first, err := chdb.Open(path)
	require.NoError(t, err)
	exp := newLogsJSONExporter(zaptest.NewLogger(t), cfg, newStore(first))
	require.NoError(t, exp.start(t.Context(), nil))
	require.NoError(t, exp.pushLogsData(t.Context(), segmentLogs(segment{roundTripTime, attrs, "before"})))
	require.NoError(t, exp.shutdown(context.Background()))
	require.NoError(t, first.Close())
	chdb.ResetForTesting()

	second, err := chdb.Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = second.Close() })
	rows := queryJSONRows(t, second, `SELECT toString(toUnixTimestamp64Milli(segment_end)) AS e FROM "`+cfg.database()+`"."recordings"`)
	require.Len(t, rows, 1, "the table did not load after a restart")
	require.Equal(t, "1700000005250", rows[0]["e"])

	again := newLogsJSONExporter(zaptest.NewLogger(t), cfg, newStore(second))
	require.NoError(t, again.start(t.Context(), nil))
	t.Cleanup(func() { _ = again.shutdown(context.Background()) })
	require.NoError(t, again.pushLogsData(t.Context(), segmentLogs(segment{roundTripTime, attrs, "after"})))
	rows = queryJSONRows(t, second, `SELECT count() AS n FROM "`+cfg.database()+`"."recordings"`)
	require.EqualValues(t, 2, rows[0]["n"])
}
