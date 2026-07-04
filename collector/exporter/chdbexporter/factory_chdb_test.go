package chdbexporter

import (
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/exporter/exportertest"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metadata"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

type fakeChDBResult struct {
	buf []byte
}

func (r fakeChDBResult) Buf() []byte { return r.buf }
func (r fakeChDBResult) Free()       {}

type fakeChDBSession struct {
	path    string
	queries []string
	mu      sync.Mutex
}

func (s *fakeChDBSession) Query(query string, _ ...string) (chdb.Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.queries = append(s.queries, query)
	// Engine lookups against system.tables see a legacy view occupying every
	// name, which steers cloud-named configs onto the adoption path.
	if strings.Contains(query, "system.tables") {
		return fakeChDBResult{buf: []byte(`{"name":"View"}` + "\n")}, nil
	}
	return fakeChDBResult{buf: []byte(`{"name":"EventName","type":"String"}` + "\n")}, nil
}

func (s *fakeChDBSession) Close()       {}
func (s *fakeChDBSession) Path() string { return s.path }

func TestDefaultConfigIsLocalChDBConfig(t *testing.T) {
	cfg := createDefaultConfig().(*Config)

	require.NoError(t, cfg.Validate())
	require.Empty(t, cfg.Endpoint)
	require.Equal(t, 7*24*time.Hour, cfg.TTL)
}

func TestFactoryWithHandleStartsLogsExporter(t *testing.T) {
	t.Cleanup(chdb.ResetForTesting)
	session := &fakeChDBSession{}
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"), chdb.WithSessionFactory(func(path string) (chdb.Session, error) {
		session.path = path
		return session, nil
	}))
	require.NoError(t, err)

	factory := NewFactoryWithHandle(handle)
	cfg := withDefaultConfig(func(cfg *Config) {
		cfg.CreateSchema = false
	})
	params := exportertest.NewNopSettings(metadata.Type)

	exp, err := factory.CreateLogs(t.Context(), params, cfg)
	require.NoError(t, err)
	require.NoError(t, exp.Start(t.Context(), nil))
	require.NoError(t, exp.Shutdown(t.Context()))

	session.mu.Lock()
	defer session.mu.Unlock()
	require.NotEmpty(t, session.queries)
}

// startAllExporters runs the logs, traces, and metrics exporters through a
// full start/shutdown cycle and returns the queries the session saw.
func startAllExporters(t *testing.T, session *fakeChDBSession, handle *chdb.Handle, cfg *Config) string {
	t.Helper()
	factory := NewFactoryWithHandle(handle)
	params := exportertest.NewNopSettings(metadata.Type)

	logsExporter, err := factory.CreateLogs(t.Context(), params, cfg)
	require.NoError(t, err)
	require.NoError(t, logsExporter.Start(t.Context(), nil))
	require.NoError(t, logsExporter.Shutdown(t.Context()))

	tracesExporter, err := factory.CreateTraces(t.Context(), params, cfg)
	require.NoError(t, err)
	require.NoError(t, tracesExporter.Start(t.Context(), nil))
	require.NoError(t, tracesExporter.Shutdown(t.Context()))

	metricsExporter, err := factory.CreateMetrics(t.Context(), params, cfg)
	require.NoError(t, err)
	require.NoError(t, metricsExporter.Start(t.Context(), nil))
	require.NoError(t, metricsExporter.Shutdown(t.Context()))

	session.mu.Lock()
	defer session.mu.Unlock()
	return joinedQueries(session.queries)
}

func TestFactoryCreatesCloudNamedTablesWithoutViews(t *testing.T) {
	t.Cleanup(chdb.ResetForTesting)
	session := &fakeChDBSession{}
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"), chdb.WithSessionFactory(func(path string) (chdb.Session, error) {
		session.path = path
		return session, nil
	}))
	require.NoError(t, err)

	queries := startAllExporters(t, session, handle, withCloudTableNamesConfig())

	require.Contains(t, queries, "CREATE TABLE IF NOT EXISTS `default`.`logs`")
	require.Contains(t, queries, `CREATE TABLE IF NOT EXISTS "default"."traces"`)
	require.Contains(t, queries, `CREATE TABLE IF NOT EXISTS "default"."metrics_gauge"`)
	require.NotContains(t, queries, "CREATE VIEW ")
}

func TestFactoryAdoptsLegacyLocalSchemaOnStart(t *testing.T) {
	t.Cleanup(chdb.ResetForTesting)
	// The canned non-empty response makes the legacy-table existence check
	// report the pre-rename layout, so startup must rename it under the
	// cloud-facing names before creating tables.
	session := &fakeChDBSession{}
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"), chdb.WithSessionFactory(func(path string) (chdb.Session, error) {
		session.path = path
		return session, nil
	}))
	require.NoError(t, err)

	queries := startAllExporters(t, session, handle, withCloudTableNamesConfig())

	// Logs: view dropped, raw table renamed, TimestampTime backfilled.
	require.Contains(t, queries, `DROP TABLE IF EXISTS "default"."logs"`)
	require.Contains(t, queries, `RENAME TABLE "default"."otel_logs" TO "default"."logs"`)
	require.Contains(t, queries, `ALTER TABLE "default"."logs"`)
	require.Contains(t, queries, "ADD COLUMN IF NOT EXISTS `TimestampTime` DateTime DEFAULT toDateTime(Timestamp)")
	// Traces: view dropped, raw + lookup tables renamed, stale MV dropped.
	require.Contains(t, queries, `RENAME TABLE "default"."otel_traces" TO "default"."traces"`)
	require.Contains(t, queries, `DROP TABLE IF EXISTS "default"."otel_traces_trace_id_ts_mv"`)
	require.Contains(t, queries, `RENAME TABLE "default"."otel_traces_trace_id_ts" TO "default"."traces_trace_id_ts"`)
	// Metrics: raw tables renamed.
	require.Contains(t, queries, `RENAME TABLE "default"."otel_metrics_gauge" TO "default"."metrics_gauge"`)
	require.Contains(t, queries, `RENAME TABLE "default"."otel_metrics_summary" TO "default"."metrics_summary"`)
}

func TestFactorySkipsLegacyAdoptionWhenNamesMatchLegacy(t *testing.T) {
	t.Cleanup(chdb.ResetForTesting)
	session := &fakeChDBSession{}
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"), chdb.WithSessionFactory(func(path string) (chdb.Session, error) {
		session.path = path
		return session, nil
	}))
	require.NoError(t, err)

	// With the legacy otel_* names still configured (the exporter defaults),
	// the configured tables ARE the legacy tables and must be left alone.
	queries := startAllExporters(t, session, handle, withDefaultConfig())

	require.NotContains(t, queries, "DROP TABLE")
	require.NotContains(t, queries, "RENAME TABLE")
	require.NotContains(t, queries, "CREATE VIEW ")
}

func TestFactoryRunsLogsSchemaMigrationOnStart(t *testing.T) {
	t.Cleanup(chdb.ResetForTesting)
	session := &fakeChDBSession{}
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"), chdb.WithSessionFactory(func(path string) (chdb.Session, error) {
		session.path = path
		return session, nil
	}))
	require.NoError(t, err)

	factory := NewFactoryWithHandle(handle)
	params := exportertest.NewNopSettings(metadata.Type)

	logsExporter, err := factory.CreateLogs(t.Context(), params, withDefaultConfig())
	require.NoError(t, err)
	require.NoError(t, logsExporter.Start(t.Context(), nil))
	require.NoError(t, logsExporter.Shutdown(t.Context()))

	session.mu.Lock()
	defer session.mu.Unlock()
	queries := joinedQueries(session.queries)
	// Logs tables created before TimestampTime existed — under any configured
	// name — must gain the column the explorer queries filter on.
	require.Contains(t, queries, `ALTER TABLE "default"."otel_logs"`)
	require.Contains(t, queries, "ADD COLUMN IF NOT EXISTS `TimestampTime` DateTime DEFAULT toDateTime(Timestamp)")
}

func withCloudTableNamesConfig() *Config {
	return withDefaultConfig(func(cfg *Config) {
		cfg.LogsTableName = "logs"
		cfg.TracesTableName = "traces"
		cfg.MetricsTables.Gauge.Name = "metrics_gauge"
		cfg.MetricsTables.Sum.Name = "metrics_sum"
		cfg.MetricsTables.Histogram.Name = "metrics_histogram"
		cfg.MetricsTables.ExponentialHistogram.Name = "metrics_exponential_histogram"
		cfg.MetricsTables.Summary.Name = "metrics_summary"
	})
}

func TestFactoryWithoutHandleFailsOnStart(t *testing.T) {
	factory := NewFactory()
	cfg := withDefaultConfig(func(cfg *Config) {
		cfg.CreateSchema = false
	})
	params := exportertest.NewNopSettings(metadata.Type)

	exp, err := factory.CreateLogs(t.Context(), params, cfg)
	require.NoError(t, err)
	require.ErrorContains(t, exp.Start(t.Context(), nil), "chdb handle is required")
}

func joinedQueries(queries []string) string {
	var out string
	for _, query := range queries {
		out += query
		out += "\n"
	}
	return out
}
