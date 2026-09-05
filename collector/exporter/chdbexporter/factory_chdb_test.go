package chdbexporter

import (
	"path/filepath"
	"strconv"
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
	// storedVersion is what the schema marker reports. The zero value answers
	// with no row, which is a store that was never stamped.
	storedVersion string
	mu            sync.Mutex
}

func (s *fakeChDBSession) Query(query string, _ ...string) (chdb.Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.queries = append(s.queries, query)
	if strings.Contains(query, schemaVersionTable) && strings.HasPrefix(query, "SELECT") {
		if s.storedVersion == "" {
			return fakeChDBResult{}, nil
		}
		return fakeChDBResult{buf: []byte(`{"name":"` + s.storedVersion + `"}` + "\n")}, nil
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

func TestStartRebuildsAStoreThatWasNeverStamped(t *testing.T) {
	session, handle := newFakeChDBHandle(t, "")

	queries := startAllExporters(t, session, handle, withCloudTableNamesConfig())

	// The names this config writes to.
	require.Contains(t, queries, `DROP TABLE IF EXISTS "default"."logs"`)
	require.Contains(t, queries, `DROP TABLE IF EXISTS "default"."traces"`)
	require.Contains(t, queries, `DROP TABLE IF EXISTS "default"."metrics_gauge"`)
	// The names a store from before the rename still holds.
	require.Contains(t, queries, `DROP TABLE IF EXISTS "default"."otel_logs"`)
	require.Contains(t, queries, `DROP TABLE IF EXISTS "default"."otel_metrics_summary"`)
	// The view goes before the table it writes into.
	require.Less(t,
		strings.Index(queries, `DROP TABLE IF EXISTS "default"."traces_trace_id_ts_mv"`),
		strings.Index(queries, `DROP TABLE IF EXISTS "default"."traces_trace_id_ts"`),
	)
	require.Contains(t, queries, `INSERT INTO "default"."_everr_schema" (version) VALUES (1)`)
}

func TestStartRebuildsOnceForEverySignal(t *testing.T) {
	session, handle := newFakeChDBHandle(t, "")

	// Logs, traces and metrics are three exporters with three start() calls
	// against one store. A second rebuild would drop the tables the first one
	// had already created.
	queries := startAllExporters(t, session, handle, withCloudTableNamesConfig())

	require.Equal(t, 1, strings.Count(queries, `DROP TABLE IF EXISTS "default"."logs"`))
	require.Equal(t, 1, strings.Count(queries, `INSERT INTO "default"."_everr_schema" (version) VALUES (1)`))
}

func TestStartLeavesAStoreOnTheCurrentVersionAlone(t *testing.T) {
	session, handle := newFakeChDBHandle(t, strconv.Itoa(localSchemaVersion))

	queries := startAllExporters(t, session, handle, withCloudTableNamesConfig())

	require.NotContains(t, queries, "DROP TABLE")
	require.NotContains(t, queries, "TRUNCATE TABLE")
}

func newFakeChDBHandle(t *testing.T, storedVersion string) (*fakeChDBSession, *chdb.Handle) {
	t.Helper()
	t.Cleanup(chdb.ResetForTesting)
	session := &fakeChDBSession{storedVersion: storedVersion}
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"), chdb.WithSessionFactory(func(path string) (chdb.Session, error) {
		session.path = path
		return session, nil
	}))
	require.NoError(t, err)
	return session, handle
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
