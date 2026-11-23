package store

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
	"github.com/everr-labs/everr/collector/localcollector/migrations"
)

func libraryPath(t *testing.T) string {
	t.Helper()
	path := os.Getenv(chdb.LibraryPathEnv)
	if path == "" {
		t.Skip(chdb.LibraryPathEnv + " not set")
	}
	return path
}

func openReal(t *testing.T, dir string) *chdb.Handle {
	t.Helper()
	chdb.ResetForTesting()
	t.Cleanup(chdb.ResetForTesting)
	handle, err := Open(context.Background(), Options{Path: dir, LibraryPath: libraryPath(t)})
	require.NoError(t, err)
	return handle
}

func rows(t *testing.T, handle *chdb.Handle, sql string) []map[string]any {
	t.Helper()
	var out []map[string]any
	err := handle.Do(context.Background(), func(_ context.Context, session chdb.Session) error {
		result, err := session.Query(sql, "JSONEachRow")
		if err != nil {
			return err
		}
		defer result.Free()
		decoder := json.NewDecoder(bytes.NewReader(result.Buf()))
		for decoder.More() {
			row := map[string]any{}
			if err := decoder.Decode(&row); err != nil {
				return err
			}
			out = append(out, row)
		}
		return nil
	})
	require.NoError(t, err, sql)
	return out
}

func column(t *testing.T, handle *chdb.Handle, sql, name string) []string {
	t.Helper()
	var out []string
	for _, row := range rows(t, handle, sql) {
		out = append(out, fmt.Sprint(row[name]))
	}
	return out
}

func exec(handle *chdb.Handle, sql string) error {
	return handle.Do(context.Background(), func(_ context.Context, session chdb.Session) error {
		result, err := session.Query(sql, "")
		if result != nil {
			result.Free()
		}
		return err
	})
}

func logRow(resource string) string {
	return fmt.Sprintf(`{"Timestamp":"%[2]s","TraceId":"","SpanId":"","TraceFlags":0,"SeverityText":"INFO","SeverityNumber":9,"ServiceName":"svc","Body":"hello","ResourceSchemaUrl":"","ResourceAttributes":%[1]s,"ResourceAttributesKeys":[],"ScopeSchemaUrl":"","ScopeName":"","ScopeVersion":"","ScopeAttributes":{},"ScopeAttributesKeys":[],"LogAttributes":{},"LogAttributesKeys":[],"EventName":""}`, resource, time.Now().UTC().Format("2006-01-02 15:04:05.000000000"))
}

func TestOpenBuildsTheSchemaFromTheEmbeddedMigrations(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "chdb")

	handle := openReal(t, dir)

	require.Equal(t, []string{"app"}, column(t, handle, "SELECT currentDatabase() AS db", "db"))

	tables := column(t, handle, "SELECT name FROM system.tables WHERE database = 'app' ORDER BY name", "name")
	for _, want := range []string{
		"alert_events", "logs", "logs_mv", "traces", "traces_mv", "traces_trace_id_ts", "traces_trace_id_ts_mv",
		"metrics_gauge", "metrics_sum", "metrics_histogram", "metrics_exponential_histogram", "metrics_summary",
		"metrics_gauge_mv", "metrics_sum_mv", "metrics_histogram_mv", "metrics_exponential_histogram_mv", "metrics_summary_mv",
	} {
		require.Contains(t, tables, want)
	}
	require.ElementsMatch(t,
		[]string{"otel_traces", "otel_logs", "otel_metrics_gauge", "otel_metrics_sum", "otel_metrics_histogram", "otel_metrics_exponential_histogram", "otel_metrics_summary"},
		column(t, handle, "SELECT name FROM system.tables WHERE database = 'otel' AND engine = 'Null'", "name"))
	functions := column(t, handle, "SELECT name FROM system.functions WHERE origin = 'SQLUserDefined'", "name")
	for _, want := range []string{"errorFingerprint", "everrRetentionDays", "everrStripRetention", "everrRetentionDaysJson", "everrStripRetentionKeys"} {
		require.Contains(t, functions, want)
	}

	local, err := localMigrations(migrations.Files)
	require.NoError(t, err)
	var wantApplied []string
	for _, m := range local {
		wantApplied = append(wantApplied, m.name)
	}
	require.Equal(t, wantApplied, appliedNames(t, dir))
	require.Contains(t, wantApplied, "0006-create-mvs.sql")
}

func TestOpenStoresAStampedInsertUnderBareNames(t *testing.T) {
	handle := openReal(t, filepath.Join(t.TempDir(), "chdb"))

	stamped := logRow(`{"service.name":"svc","everr.retention.days":"7"}`)
	require.NoError(t, exec(handle, "INSERT INTO otel.otel_logs FORMAT JSONEachRow "+stamped))

	got := rows(t, handle, "SELECT retention_days, tenant_id, toString(ResourceAttributes) AS resource, ResourceAttributesKeys AS keys FROM logs")
	require.Len(t, got, 1)
	require.EqualValues(t, 7, got[0]["retention_days"])
	require.Equal(t, "", got[0]["tenant_id"])
	require.NotContains(t, got[0]["resource"], "everr.retention.days")
	require.NotContains(t, got[0]["keys"], "everr.retention.days")

	unstamped := logRow(`{"service.name":"svc"}`)
	require.ErrorContains(t, exec(handle, "INSERT INTO otel.otel_logs FORMAT JSONEachRow "+unstamped), "everr.retention.days")
}

func TestOpenKeepsDataAcrossAStartAndDropsItWhenTheVersionChanges(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "chdb")
	handle := openReal(t, dir)
	require.NoError(t, exec(handle, "INSERT INTO otel.otel_logs FORMAT JSONEachRow "+logRow(`{"everr.retention.days":"7"}`)))

	handle = openReal(t, dir)
	require.Equal(t, []string{"1"}, column(t, handle, "SELECT count() AS n FROM logs", "n"), "the second start keeps the row")
	require.Equal(t, []string{"app"}, column(t, handle, "SELECT currentDatabase() AS db", "db"))

	require.NoError(t, writeMarker(dir, marker{Version: Version + 1, Applied: map[string]string{}}))
	handle = openReal(t, dir)
	require.Equal(t, []string{"0"}, column(t, handle, "SELECT count() AS n FROM logs", "n"), "the new version starts empty")
	seen, err := observe(dir)
	require.NoError(t, err)
	require.Equal(t, Version, seen.marker.Version)
}

func TestOpenRebuildsAStoreWhoseDataWasDeletedAroundTheMarker(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "chdb")
	handle := openReal(t, dir)
	require.NoError(t, exec(handle, "INSERT INTO otel.otel_logs FORMAT JSONEachRow "+logRow(`{"everr.retention.days":"7"}`)))
	chdb.ResetForTesting()
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	for _, entry := range entries {
		if entry.Name()[0] != '.' {
			require.NoError(t, os.RemoveAll(filepath.Join(dir, entry.Name())))
		}
	}
	require.FileExists(t, filepath.Join(dir, markerName), "a shell glob keeps the marker")

	handle = openReal(t, dir)

	require.Equal(t, []string{"0"}, column(t, handle, "SELECT count() AS n FROM logs", "n"))
	require.NoError(t, exec(handle, "INSERT INTO otel.otel_logs FORMAT JSONEachRow "+logRow(`{"everr.retention.days":"7"}`)))
	require.Equal(t, []string{"1"}, column(t, handle, "SELECT count() AS n FROM logs", "n"))
}

func TestOpenRebuildsAStoreWhoseQueryDatabaseWasDropped(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "chdb")
	handle := openReal(t, dir)
	require.NoError(t, exec(handle, "DROP DATABASE app"))

	handle = openReal(t, dir)

	require.NoError(t, exec(handle, "INSERT INTO otel.otel_logs FORMAT JSONEachRow "+logRow(`{"everr.retention.days":"7"}`)))
	require.Equal(t, []string{"1"}, column(t, handle, "SELECT count() AS n FROM logs", "n"))
}
