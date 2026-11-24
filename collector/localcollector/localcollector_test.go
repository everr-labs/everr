package localcollector

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/plog/plogotlp"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/pmetric/pmetricotlp"
	"go.opentelemetry.io/collector/pdata/pprofile"
	"go.opentelemetry.io/collector/pdata/pprofile/pprofileotlp"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/collector/pdata/ptrace/ptraceotlp"

	chdbexporter "github.com/everr-labs/everr/collector/exporter/chdbexporter"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

var (
	sentAt     = time.Now().UTC().Add(-time.Hour).Truncate(time.Second).Add(123456789 * time.Nanosecond)
	startedAt  = sentAt.Add(-90 * time.Second)
	exemplarAt = sentAt.Add(-5 * time.Second)
)

const retentionDays = 3

type gateway struct {
	*Gateway
	otlp string
	sql  string
}

func freeOrigin(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()
	return "http://" + ln.Addr().String()
}

// openGateway opens a gateway on an empty store. chDB pins one directory per
// process, so each test releases the handle the one before it used.
func openGateway(t *testing.T) *gateway {
	t.Helper()
	if os.Getenv(chdb.LibraryPathEnv) == "" {
		t.Skip(chdb.LibraryPathEnv + " not set")
	}
	chdb.ResetForTesting()
	g := &gateway{otlp: freeOrigin(t), sql: freeOrigin(t)}
	opened, err := Open(Options{
		OTLPEndpoint:  g.otlp,
		SQLEndpoint:   g.sql,
		ChDBPath:      t.TempDir(),
		RetentionDays: retentionDays,
		Version:       "1.2.3",
		InstanceID:    "test-instance",
	})
	require.NoError(t, err)
	g.Gateway = opened
	t.Cleanup(func() {
		_ = g.Close(context.Background())
		chdb.ResetForTesting()
	})
	return g
}

func startGateway(t *testing.T) *gateway {
	t.Helper()
	g := openGateway(t)
	t.Cleanup(g.runUntilReady(t))
	return g
}

func (g *gateway) health() (int, map[string]any) {
	resp, err := http.Get(g.sql + "/health")
	if err != nil {
		return 0, nil
	}
	defer resp.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	return resp.StatusCode, body
}

func (g *gateway) runUntilReady(t *testing.T) (cancel func()) {
	t.Helper()
	ctx, stop := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- g.Run(ctx) }()
	require.Eventually(t, func() bool {
		code, _ := g.health()
		return code == http.StatusOK
	}, 20*time.Second, 50*time.Millisecond)
	return func() {
		stop()
		require.ErrorIs(t, <-done, context.Canceled)
	}
}

func (g *gateway) send(t *testing.T, signal string, proto []byte, err error) {
	t.Helper()
	g.post(t, "/v1/"+signal, proto, err)
}

func (g *gateway) post(t *testing.T, path string, proto []byte, err error) {
	t.Helper()
	require.NoError(t, err)
	resp, err := http.Post(g.otlp+path, "application/x-protobuf", bytes.NewReader(proto))
	require.NoError(t, err)
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	require.Equal(t, http.StatusOK, resp.StatusCode, string(body))
}

func (g *gateway) sendLogs(t *testing.T, ld plog.Logs) {
	t.Helper()
	proto, err := plogotlp.NewExportRequestFromLogs(ld).MarshalProto()
	g.send(t, "logs", proto, err)
}

func (g *gateway) sendTraces(t *testing.T, td ptrace.Traces) {
	t.Helper()
	proto, err := ptraceotlp.NewExportRequestFromTraces(td).MarshalProto()
	g.send(t, "traces", proto, err)
}

func (g *gateway) sendMetrics(t *testing.T, md pmetric.Metrics) {
	t.Helper()
	proto, err := pmetricotlp.NewExportRequestFromMetrics(md).MarshalProto()
	g.send(t, "metrics", proto, err)
}

// The OTLP receiver serves profiles at their development-stage path.
func (g *gateway) sendProfiles(t *testing.T, pd pprofile.Profiles) {
	t.Helper()
	proto, err := pprofileotlp.NewExportRequestFromProfiles(pd).MarshalProto()
	g.post(t, "/v1development/profiles", proto, err)
}

// Numbers that do not fit a float come back as strings.
func (g *gateway) query(t *testing.T, sql string) []map[string]any {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, g.sql+"/sql", bytes.NewBufferString(sql))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "text/plain")
	req.Header.Set("X-Everr-Local", "1")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	out, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode, "%s\n%s", sql, out)
	var rows []map[string]any
	decoder := json.NewDecoder(bytes.NewReader(out))
	for decoder.More() {
		row := map[string]any{}
		require.NoError(t, decoder.Decode(&row))
		rows = append(rows, row)
	}
	return rows
}

func (g *gateway) waitRows(t *testing.T, sql string, want int) []map[string]any {
	t.Helper()
	var rows []map[string]any
	require.Eventually(t, func() bool {
		rows = g.query(t, sql)
		return len(rows) == want
	}, 15*time.Second, 100*time.Millisecond, sql)
	return rows
}

func oneLog(service, body string) plog.Logs {
	ld := plog.NewLogs()
	resourceLogs := ld.ResourceLogs().AppendEmpty()
	resourceLogs.Resource().Attributes().PutStr("service.name", service)
	record := resourceLogs.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	record.SetTimestamp(pcommon.NewTimestampFromTime(sentAt))
	record.Body().SetStr(body)
	return ld
}

func TestGatewayRestartsPipelineOnTheSameChDB(t *testing.T) {
	g := openGateway(t)

	code, identity := g.health()
	require.Equal(t, http.StatusServiceUnavailable, code)
	require.Equal(t, "starting", identity["status"])
	require.Equal(t, "test-instance", identity["instance_id"])
	// The local UI reads timestamps as UTC, whatever the machine's zone.
	require.Equal(t, "UTC", g.query(t, "SELECT timezone() AS tz")[0]["tz"])
	require.Equal(t, "app", g.query(t, "SELECT currentDatabase() AS db")[0]["db"])
	require.NotEmpty(t, g.query(t, "SELECT errorFingerprint('checkout', '', 'E', 'boom') AS fingerprint")[0]["fingerprint"])

	stop := g.runUntilReady(t)
	g.sendLogs(t, oneLog("restart", "first"))
	g.waitRows(t, "SELECT Body FROM logs WHERE Body = 'first'", 1)
	stop()

	code, identity = g.health()
	require.Equal(t, http.StatusServiceUnavailable, code)
	require.Equal(t, "stopped", identity["status"])

	stop = g.runUntilReady(t)
	defer stop()
	g.sendLogs(t, oneLog("restart", "second"))
	g.waitRows(t, "SELECT Body FROM logs WHERE Body = 'second'", 1)
	g.waitRows(t, "SELECT Body FROM logs WHERE Body = 'first'", 1)
	require.Equal(t, "app", g.query(t, "SELECT currentDatabase() AS db")[0]["db"])
}

func TestLogsKeepNanosecondsTypedAttributesAndTheConfiguredRetention(t *testing.T) {
	g := startGateway(t)

	ld := oneLog("logs-round-trip", "typed attributes")
	ld.ResourceLogs().At(0).Resource().Attributes().PutInt("everr.retention.days", 0)
	record := ld.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0)
	record.Attributes().PutInt("everr.github.workflow_job_step.number", 3)
	record.Attributes().PutStr("http.route", "/x")
	g.sendLogs(t, ld)

	rows := g.waitRows(t,
		"SELECT toString(toUnixTimestamp64Nano(Timestamp)) AS nanos,"+
			" toString(LogAttributes.`everr.github.workflow_job_step.number`) AS step,"+
			" dynamicType(LogAttributes.`everr.github.workflow_job_step.number`) AS stepType,"+
			" toString(LogAttributes.`http.route`) AS route,"+
			" has(LogAttributesKeys, 'http.route') AS hasRoute,"+
			" retention_days, tenant_id, ServiceName,"+
			" toString(ResourceAttributes) AS resource, ResourceAttributesKeys AS resourceKeys"+
			" FROM logs WHERE Body = 'typed attributes'", 1)
	row := rows[0]
	require.Equal(t, strconv.FormatInt(sentAt.UnixNano(), 10), row["nanos"])
	require.Equal(t, "3", row["step"])
	require.Equal(t, "Int64", row["stepType"], "an integer attribute is stored as a number, not as text")
	require.Equal(t, "/x", row["route"])
	require.EqualValues(t, 1, row["hasRoute"])
	require.EqualValues(t, retentionDays, row["retention_days"])
	require.Equal(t, "", row["tenant_id"])
	require.Equal(t, "logs-round-trip", row["ServiceName"])
	require.JSONEq(t, `{"service":{"name":"logs-round-trip"}}`, row["resource"].(string), "the stamp is not stored as an attribute")
	require.Equal(t, []any{"service.name"}, row["resourceKeys"])
}

func TestSpansKeepNanosecondsEventsAndLinks(t *testing.T) {
	g := startGateway(t)

	kinds := []string{"none", "empty event", "attributed event", "empty link", "attributed link"}
	expected := map[string][2]string{}
	traceIDs := map[string]pcommon.TraceID{}
	for i, kind := range kinds {
		td := ptrace.NewTraces()
		resource := td.ResourceSpans().AppendEmpty()
		resource.Resource().Attributes().PutStr("service.name", kind)
		spans := resource.ScopeSpans().AppendEmpty().Spans()
		traceIDs[kind] = pcommon.TraceID{byte(i + 1)}
		for j, name := range []string{"control", "worker"} {
			span := spans.AppendEmpty()
			span.SetTraceID(traceIDs[kind])
			span.SetSpanID(pcommon.SpanID{byte(j + 1)})
			span.SetName(name)
			span.SetStartTimestamp(pcommon.NewTimestampFromTime(sentAt))
			span.SetEndTimestamp(pcommon.NewTimestampFromTime(sentAt.Add(time.Millisecond)))
		}
		worker := spans.At(1)
		expectedEvents, expectedLinks := `[]`, `[]`
		switch kind {
		case "empty event", "attributed event":
			event := worker.Events().AppendEmpty()
			event.SetName("job completed")
			event.SetTimestamp(pcommon.NewTimestampFromTime(sentAt))
			expectedEvents = `[{}]`
			if kind == "attributed event" {
				event.Attributes().PutStr("bullmq.job.id", "test-job")
				event.Attributes().PutInt("everr.test.attempt", 42)
				event.Attributes().PutBool("everr.test.completed", true)
				event.Attributes().PutDouble("everr.test.progress", 0.5)
				event.Attributes().PutStr("everr.test.result", `{"ok":true}`)
				event.Attributes().PutEmptySlice("everr.test.tags").AppendEmpty().SetStr("done")
				empty := worker.Events().AppendEmpty()
				empty.SetName("empty event")
				empty.SetTimestamp(pcommon.NewTimestampFromTime(sentAt))
				expectedEvents = `[{"bullmq":{"job":{"id":"test-job"}},"everr":{"test":{"attempt":42,"completed":true,"progress":0.5,"result":"{\"ok\":true}","tags":["done"]}}},{}]`
			}
		case "empty link", "attributed link":
			link := worker.Links().AppendEmpty()
			link.SetTraceID(pcommon.TraceID{200})
			link.SetSpanID(pcommon.SpanID{3})
			expectedLinks = `[{}]`
			if kind == "attributed link" {
				link.Attributes().PutStr("everr.test.id", "test-link")
				link.Attributes().PutInt("everr.test.attempt", 42)
				empty := worker.Links().AppendEmpty()
				empty.SetTraceID(pcommon.TraceID{201})
				empty.SetSpanID(pcommon.SpanID{5})
				expectedLinks = `[{"everr":{"test":{"id":"test-link","attempt":42}}},{}]`
			}
		}
		expected[kind] = [2]string{expectedEvents, expectedLinks}
		g.sendTraces(t, td)
	}

	for _, kind := range kinds {
		t.Run(kind, func(t *testing.T) {
			rows := g.waitRows(t, fmt.Sprintf(
				"SELECT SpanName, toString(toUnixTimestamp64Nano(Timestamp)) AS nanos, Duration, retention_days,"+
					" toJSONString(`Events.Attributes`) AS events, toJSONString(`Links.Attributes`) AS links,"+
					" arrayMap(x -> toString(toUnixTimestamp64Nano(x)), `Events.Timestamp`) AS eventNanos"+
					" FROM traces WHERE ServiceName = '%s' ORDER BY SpanName", kind), 2)
			require.Equal(t, "control", rows[0]["SpanName"], "an event or a link must not discard the other spans of the batch")
			worker := rows[1]
			require.Equal(t, strconv.FormatInt(sentAt.UnixNano(), 10), worker["nanos"])
			require.EqualValues(t, time.Millisecond.Nanoseconds(), worker["Duration"])
			require.EqualValues(t, retentionDays, worker["retention_days"])
			require.JSONEq(t, expected[kind][0], worker["events"].(string))
			require.JSONEq(t, expected[kind][1], worker["links"].(string))
			for _, nanos := range worker["eventNanos"].([]any) {
				require.Equal(t, strconv.FormatInt(sentAt.UnixNano(), 10), nanos)
			}

			lookup := g.waitRows(t, fmt.Sprintf(
				"SELECT toString(min(Start)) AS start, toString(max(End)) AS end, any(retention_days) AS retention_days"+
					" FROM traces_trace_id_ts WHERE TraceId = '%s' GROUP BY TraceId", traceIDs[kind]), 1)
			require.Equal(t, utcSeconds(sentAt), lookup[0]["start"])
			require.Equal(t, utcSeconds(sentAt), lookup[0]["end"])
			require.EqualValues(t, retentionDays, lookup[0]["retention_days"])
		})
	}
}

func utcSeconds(ts time.Time) string {
	return ts.UTC().Format("2006-01-02 15:04:05")
}

type dataPoint interface {
	SetStartTimestamp(pcommon.Timestamp)
	SetTimestamp(pcommon.Timestamp)
}

func stamp(dp dataPoint) {
	dp.SetStartTimestamp(pcommon.NewTimestampFromTime(startedAt))
	dp.SetTimestamp(pcommon.NewTimestampFromTime(sentAt))
}

func addExemplar(exemplars pmetric.ExemplarSlice) {
	exemplar := exemplars.AppendEmpty()
	exemplar.SetTimestamp(pcommon.NewTimestampFromTime(exemplarAt))
	exemplar.SetDoubleValue(1)
}

func oneMetricOfEachKind() pmetric.Metrics {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "round-trip")
	rm.Resource().Attributes().PutStr("everr.retention.days", "0")
	sm := rm.ScopeMetrics().AppendEmpty()
	sm.Scope().SetName("round-trip")

	gauge := sm.Metrics().AppendEmpty()
	gauge.SetName("gauge")
	gaugePoint := gauge.SetEmptyGauge().DataPoints().AppendEmpty()
	gaugePoint.SetDoubleValue(1)
	gaugePoint.Attributes().PutStr("region", "eu")
	stamp(gaugePoint)
	addExemplar(gaugePoint.Exemplars())

	sum := sm.Metrics().AppendEmpty()
	sum.SetName("sum")
	sumPoint := sum.SetEmptySum().DataPoints().AppendEmpty()
	sumPoint.SetDoubleValue(1)
	sumPoint.Attributes().PutStr("region", "eu")
	stamp(sumPoint)
	addExemplar(sumPoint.Exemplars())

	histogram := sm.Metrics().AppendEmpty()
	histogram.SetName("histogram")
	histogramPoint := histogram.SetEmptyHistogram().DataPoints().AppendEmpty()
	histogramPoint.SetCount(1)
	histogramPoint.SetSum(1)
	histogramPoint.BucketCounts().FromRaw([]uint64{1})
	histogramPoint.Attributes().PutStr("region", "eu")
	stamp(histogramPoint)
	addExemplar(histogramPoint.Exemplars())

	exponential := sm.Metrics().AppendEmpty()
	exponential.SetName("exponential_histogram")
	exponentialPoint := exponential.SetEmptyExponentialHistogram().DataPoints().AppendEmpty()
	exponentialPoint.SetCount(1)
	exponentialPoint.SetSum(1)
	exponentialPoint.Attributes().PutStr("region", "eu")
	stamp(exponentialPoint)
	addExemplar(exponentialPoint.Exemplars())

	summary := sm.Metrics().AppendEmpty()
	summary.SetName("summary")
	summaryPoint := summary.SetEmptySummary().DataPoints().AppendEmpty()
	summaryPoint.SetCount(1)
	summaryPoint.SetSum(1)
	summaryPoint.Attributes().PutStr("region", "eu")
	stamp(summaryPoint)

	return md
}

func TestEveryMetricKindStoresItsTimestampsAndTheConfiguredRetention(t *testing.T) {
	g := startGateway(t)
	g.sendMetrics(t, oneMetricOfEachKind())

	tables := []struct {
		name         string
		hasExemplars bool
	}{
		{"metrics_gauge", true},
		{"metrics_sum", true},
		{"metrics_histogram", true},
		{"metrics_exponential_histogram", true},
		{"metrics_summary", false},
	}
	for _, table := range tables {
		t.Run(table.name, func(t *testing.T) {
			rows := g.waitRows(t,
				"SELECT toString(toDateTime(TimeUnix), 'UTC') AS time, toString(toDateTime(StartTimeUnix), 'UTC') AS start,"+
					" retention_days, ResourceAttributes, Attributes, ServiceName, MetricName FROM "+table.name, 1)
			row := rows[0]
			require.Equal(t, utcSeconds(sentAt), row["time"])
			require.Equal(t, utcSeconds(startedAt), row["start"])
			require.EqualValues(t, retentionDays, row["retention_days"])
			require.Equal(t, map[string]any{"service.name": "round-trip"}, row["ResourceAttributes"], "the stamp is not stored as an attribute")
			require.Equal(t, map[string]any{"region": "eu"}, row["Attributes"])
			require.Equal(t, "round-trip", row["ServiceName"])
			require.Equal(t, "metrics_"+row["MetricName"].(string), table.name)

			if !table.hasExemplars {
				return
			}
			rows = g.query(t, "SELECT arrayMap(x -> toString(toDateTime(x), 'UTC'), Exemplars.TimeUnix) AS exemplars FROM "+table.name)
			require.Len(t, rows, 1)
			require.Equal(t, []any{utcSeconds(exemplarAt)}, rows[0]["exemplars"])
		})
	}
}

func TestProfileSamplesKeepTheirStackTheirSpanAndTheConfiguredRetention(t *testing.T) {
	g := startGateway(t)

	pd := pprofile.NewProfiles()
	dic := pd.Dictionary()
	dic.StringTable().Append("", "cpu", "nanoseconds", "handler", "server.go")
	dic.FunctionTable().AppendEmpty()
	fn := dic.FunctionTable().AppendEmpty()
	fn.SetNameStrindex(3)
	fn.SetFilenameStrindex(4)
	dic.MappingTable().AppendEmpty()
	dic.LocationTable().AppendEmpty()
	line := dic.LocationTable().AppendEmpty().Lines().AppendEmpty()
	line.SetFunctionIndex(1)
	line.SetLine(12)
	dic.StackTable().AppendEmpty()
	dic.StackTable().AppendEmpty().LocationIndices().Append(1)
	dic.LinkTable().AppendEmpty()
	link := dic.LinkTable().AppendEmpty()
	link.SetTraceID(pcommon.TraceID{1})
	link.SetSpanID(pcommon.SpanID{2})
	dic.AttributeTable().AppendEmpty()

	resource := pd.ResourceProfiles().AppendEmpty()
	resource.Resource().Attributes().PutStr("service.name", "profiles-round-trip")
	resource.Resource().Attributes().PutInt("everr.retention.days", 0)
	profile := resource.ScopeProfiles().AppendEmpty().Profiles().AppendEmpty()
	profile.SetTime(pcommon.NewTimestampFromTime(sentAt))
	profile.SampleType().SetTypeStrindex(1)
	profile.SampleType().SetUnitStrindex(2)
	sample := profile.Samples().AppendEmpty()
	sample.SetStackIndex(1)
	sample.SetLinkIndex(1)
	sample.Values().Append(25_000_000)
	g.sendProfiles(t, pd)

	rows := g.waitRows(t,
		"SELECT toString(toUnixTimestamp64Nano(Timestamp)) AS nanos, SampleType, SampleUnit,"+
			" FunctionNames, FileNames, LineNumbers, Values, TraceId, SpanId,"+
			" retention_days, tenant_id, toJSONString(ResourceAttributes) AS resource"+
			" FROM profiles WHERE ServiceName = 'profiles-round-trip'", 1)
	row := rows[0]
	require.Equal(t, strconv.FormatInt(sentAt.UnixNano(), 10), row["nanos"])
	require.Equal(t, "cpu", row["SampleType"])
	require.Equal(t, "nanoseconds", row["SampleUnit"])
	require.Equal(t, []any{"handler"}, row["FunctionNames"])
	require.Equal(t, []any{"server.go"}, row["FileNames"])
	require.Equal(t, []any{12.0}, row["LineNumbers"])
	require.Equal(t, []any{25_000_000.0}, row["Values"])
	require.Equal(t, "01000000000000000000000000000000", row["TraceId"])
	require.Equal(t, "0200000000000000", row["SpanId"])
	require.EqualValues(t, retentionDays, row["retention_days"])
	require.Equal(t, "", row["tenant_id"])
	require.JSONEq(t, `{"service.name":"profiles-round-trip"}`, row["resource"].(string), "the stamp is not stored as an attribute")
}

func TestTheExporterWritesExactlyTheColumnsOfTheMigratedLandingTables(t *testing.T) {
	g := openGateway(t)

	tables := chdbexporter.LandingTables()
	require.Len(t, tables, 8)
	for _, table := range tables {
		t.Run(table.Name, func(t *testing.T) {
			var migrated []string
			for _, row := range g.query(t, "DESCRIBE TABLE "+table.Name) {
				migrated = append(migrated, row["name"].(string))
			}
			require.NotEmpty(t, migrated)
			written := slices.Clone(table.Columns)
			slices.Sort(migrated)
			slices.Sort(written)
			require.Equal(t, migrated, written)
		})
	}
}

func TestABrowserMayPostGzippedLogsFromAnotherOrigin(t *testing.T) {
	g := startGateway(t)

	req, err := http.NewRequest(http.MethodOptions, g.otlp+"/v1/logs", nil)
	require.NoError(t, err)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	// Browsers list the requested headers lowercased and sorted.
	req.Header.Set("Access-Control-Request-Headers", "content-encoding,content-type")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Less(t, resp.StatusCode, 300)
	require.Equal(t, "*", resp.Header.Get("Access-Control-Allow-Origin"))
	require.Contains(t, strings.ToLower(resp.Header.Get("Access-Control-Allow-Headers")), "content-encoding")
}
