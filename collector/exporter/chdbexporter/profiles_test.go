package chdbexporter

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component/componenttest"
	"go.opentelemetry.io/collector/exporter/exportertest"
	"go.opentelemetry.io/collector/exporter/xexporter"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pprofile"
)

// One CPU profile with two samples on the same stack: foo (leaf), then bar
// inlined into main. The first sample links to a span, the second does not.
func cpuProfile() pprofile.Profiles {
	pd := pprofile.NewProfiles()
	dic := pd.Dictionary()
	dic.StringTable().Append(
		"", "cpu", "nanoseconds", "main", "main.go", "foo", "foo.go",
		"bar", "bar.go", "libc.so", "thread.name", "profile.tag",
	)

	dic.FunctionTable().AppendEmpty()
	for _, fn := range [][2]int32{{3, 4}, {5, 6}, {7, 8}} {
		f := dic.FunctionTable().AppendEmpty()
		f.SetNameStrindex(fn[0])
		f.SetFilenameStrindex(fn[1])
	}

	dic.MappingTable().AppendEmpty()
	dic.MappingTable().AppendEmpty().SetFilenameStrindex(9)

	dic.LocationTable().AppendEmpty()
	foo := dic.LocationTable().AppendEmpty()
	foo.SetMappingIndex(1)
	foo.SetAddress(0x1000)
	fooLine := foo.Lines().AppendEmpty()
	fooLine.SetFunctionIndex(2)
	fooLine.SetLine(42)
	caller := dic.LocationTable().AppendEmpty()
	caller.SetMappingIndex(1)
	caller.SetAddress(0x2000)
	barLine := caller.Lines().AppendEmpty()
	barLine.SetFunctionIndex(3)
	barLine.SetLine(10)
	mainLine := caller.Lines().AppendEmpty()
	mainLine.SetFunctionIndex(1)
	mainLine.SetLine(99)

	dic.StackTable().AppendEmpty()
	dic.StackTable().AppendEmpty().LocationIndices().Append(1, 2)

	dic.LinkTable().AppendEmpty()
	link := dic.LinkTable().AppendEmpty()
	link.SetTraceID(pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16})
	link.SetSpanID(pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8})

	dic.AttributeTable().AppendEmpty()
	thread := dic.AttributeTable().AppendEmpty()
	thread.SetKeyStrindex(10)
	thread.Value().SetStr("worker-1")
	tag := dic.AttributeTable().AppendEmpty()
	tag.SetKeyStrindex(11)
	tag.Value().SetStr("prod")

	resourceProfiles := pd.ResourceProfiles().AppendEmpty()
	resourceProfiles.Resource().Attributes().PutStr("service.name", "checkout")
	resourceProfiles.Resource().Attributes().PutInt("everr.retention.days", 0)
	scopeProfiles := resourceProfiles.ScopeProfiles().AppendEmpty()
	scopeProfiles.Scope().SetName("profiler")
	scopeProfiles.Scope().SetVersion("1.0.0")

	profile := scopeProfiles.Profiles().AppendEmpty()
	profile.SetProfileID(pprofile.ProfileID{9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9})
	profile.SetTime(pcommon.NewTimestampFromTime(sentAt))
	profile.SetDurationNano(10_000_000_000)
	profile.SetPeriod(10_000_000)
	profile.SampleType().SetTypeStrindex(1)
	profile.SampleType().SetUnitStrindex(2)
	profile.PeriodType().SetTypeStrindex(1)
	profile.PeriodType().SetUnitStrindex(2)
	profile.AttributeIndices().Append(2)

	linked := profile.Samples().AppendEmpty()
	linked.SetStackIndex(1)
	linked.SetLinkIndex(1)
	linked.Values().Append(30_000_000)
	linked.AttributeIndices().Append(1)

	unlinked := profile.Samples().AppendEmpty()
	unlinked.SetStackIndex(1)
	unlinked.TimestampsUnixNano().Append(uint64(sentAt.UnixNano()))

	return pd
}

func TestProfileSamplesAreWrittenToTheLandingTableWithTheRetentionStamp(t *testing.T) {
	factory, cfg, session := newExporters(t)
	exp, err := factory.(xexporter.Factory).CreateProfiles(t.Context(), exportertest.NewNopSettings(factory.Type()), cfg)
	require.NoError(t, err)
	require.NoError(t, exp.Start(t.Context(), componenttest.NewNopHost()))
	t.Cleanup(func() { _ = exp.Shutdown(t.Context()) })

	require.NoError(t, exp.ConsumeProfiles(t.Context(), cpuProfile()))

	statements := session.Statements()
	require.Len(t, statements, 1)
	header, body, ok := strings.Cut(statements[0], "\n")
	require.True(t, ok)
	require.Equal(t, "INSERT INTO otel.otel_profiles SETTINGS type_json_skip_duplicated_paths = 1 FORMAT JSONEachRow", header)

	var rows []map[string]any
	for line := range strings.SplitSeq(strings.TrimSuffix(body, "\n"), "\n") {
		var row map[string]any
		require.NoError(t, json.Unmarshal([]byte(line), &row))
		rows = append(rows, row)
	}
	require.Len(t, rows, 2)

	stack := map[string]any{
		"FunctionNames":    []any{"foo", "bar", "main"},
		"FileNames":        []any{"foo.go", "bar.go", "main.go"},
		"LineNumbers":      []any{42.0, 10.0, 99.0},
		"Addresses":        []any{4096.0, 8192.0, 8192.0},
		"MappingFileNames": []any{"libc.so", "libc.so", "libc.so"},
	}
	shared := map[string]any{
		"Timestamp":          "2026-01-02T03:04:05.123456789Z",
		"ProfileId":          "09090909090909090909090909090909",
		"SampleType":         "cpu",
		"SampleUnit":         "nanoseconds",
		"ServiceName":        "checkout",
		"ResourceAttributes": map[string]any{"service.name": "checkout", "everr.retention.days": "7"},
		"ScopeName":          "profiler",
		"ScopeVersion":       "1.0.0",
		"ProfileAttributes":  map[string]any{"profile.tag": "prod"},
		"DurationNano":       10_000_000_000.0,
		"Period":             10_000_000.0,
		"PeriodType":         "cpu",
		"PeriodUnit":         "nanoseconds",
	}
	for name, value := range stack {
		shared[name] = value
	}

	expectLinked := map[string]any{
		"SampleAttributes":   map[string]any{"thread.name": "worker-1"},
		"Values":             []any{30_000_000.0},
		"TimestampsUnixNano": nil,
		"TraceId":            "0102030405060708090a0b0c0d0e0f10",
		"SpanId":             "0102030405060708",
	}
	expectUnlinked := map[string]any{
		"SampleAttributes":   map[string]any{},
		"Values":             nil,
		"TimestampsUnixNano": []any{float64(sentAt.UnixNano())},
		"TraceId":            "",
		"SpanId":             "",
	}
	for i, expect := range []map[string]any{expectLinked, expectUnlinked} {
		row := rows[i]
		require.NotZero(t, row["StackHash"], "row %d", i)
		delete(row, "StackHash")
		for name, value := range shared {
			expect[name] = value
		}
		require.Equal(t, expect, row, "row %d", i)
	}
}

func TestTwoSamplesOnOneStackShareItsHash(t *testing.T) {
	factory, cfg, session := newExporters(t)
	exp, err := factory.(xexporter.Factory).CreateProfiles(t.Context(), exportertest.NewNopSettings(factory.Type()), cfg)
	require.NoError(t, err)
	require.NoError(t, exp.Start(t.Context(), componenttest.NewNopHost()))
	t.Cleanup(func() { _ = exp.Shutdown(t.Context()) })

	require.NoError(t, exp.ConsumeProfiles(t.Context(), cpuProfile()))

	_, body, _ := strings.Cut(session.Statements()[0], "\n")
	var hashes []json.Number
	for line := range strings.SplitSeq(strings.TrimSuffix(body, "\n"), "\n") {
		decoder := json.NewDecoder(strings.NewReader(line))
		decoder.UseNumber()
		var row map[string]any
		require.NoError(t, decoder.Decode(&row))
		hashes = append(hashes, row["StackHash"].(json.Number))
	}
	require.Len(t, hashes, 2)
	require.Equal(t, hashes[0], hashes[1])
}
