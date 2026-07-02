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
	// The local-view engine lookup must see no existing object so view creation
	// takes the fresh-create path.
	if strings.Contains(query, "system.tables") {
		return fakeChDBResult{}, nil
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

func TestFactoryWithHandleCreatesProductionFacingLocalViews(t *testing.T) {
	t.Cleanup(chdb.ResetForTesting)
	session := &fakeChDBSession{}
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"), chdb.WithSessionFactory(func(path string) (chdb.Session, error) {
		session.path = path
		return session, nil
	}))
	require.NoError(t, err)

	factory := NewFactoryWithHandle(handle)
	cfg := withDefaultConfig()
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
	queries := joinedQueries(session.queries)
	require.Contains(t, queries, `CREATE VIEW IF NOT EXISTS "default"."logs" AS SELECT * FROM "default"."otel_logs"`)
	require.Contains(t, queries, `CREATE VIEW IF NOT EXISTS "default"."traces" AS SELECT * FROM "default"."otel_traces"`)
	require.Contains(t, queries, `CREATE VIEW IF NOT EXISTS "default"."metrics_gauge" AS SELECT * FROM "default"."otel_metrics_gauge"`)
	require.Contains(t, queries, `CREATE VIEW IF NOT EXISTS "default"."metrics_sum" AS SELECT * FROM "default"."otel_metrics_sum"`)
	require.Contains(t, queries, `CREATE VIEW IF NOT EXISTS "default"."metrics_histogram" AS SELECT * FROM "default"."otel_metrics_histogram"`)
	require.Contains(t, queries, `CREATE VIEW IF NOT EXISTS "default"."metrics_exponential_histogram" AS SELECT * FROM "default"."otel_metrics_exponential_histogram"`)
	require.Contains(t, queries, `CREATE VIEW IF NOT EXISTS "default"."metrics_summary" AS SELECT * FROM "default"."otel_metrics_summary"`)
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
	cfg := withDefaultConfig()
	params := exportertest.NewNopSettings(metadata.Type)

	logsExporter, err := factory.CreateLogs(t.Context(), params, cfg)
	require.NoError(t, err)
	require.NoError(t, logsExporter.Start(t.Context(), nil))
	require.NoError(t, logsExporter.Shutdown(t.Context()))

	session.mu.Lock()
	defer session.mu.Unlock()
	queries := joinedQueries(session.queries)
	// Existing installs created their logs table before TimestampTime existed;
	// startup must issue an idempotent migration to add the production column.
	require.Contains(t, queries, "ALTER TABLE `default`.`otel_logs`")
	require.Contains(t, queries, "ADD COLUMN IF NOT EXISTS `TimestampTime` DateTime DEFAULT toDateTime(Timestamp)")
}

func TestFactoryWithHandleSkipsLocalViewsWhenRawNamesMatch(t *testing.T) {
	t.Cleanup(chdb.ResetForTesting)
	session := &fakeChDBSession{}
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"), chdb.WithSessionFactory(func(path string) (chdb.Session, error) {
		session.path = path
		return session, nil
	}))
	require.NoError(t, err)

	factory := NewFactoryWithHandle(handle)
	cfg := withDefaultConfig(func(cfg *Config) {
		cfg.LogsTableName = localLogsViewName
		cfg.TracesTableName = localTracesViewName
		cfg.MetricsTables.Gauge.Name = localMetricsGaugeViewName
		cfg.MetricsTables.Sum.Name = localMetricsSumViewName
		cfg.MetricsTables.Histogram.Name = localMetricsHistogramViewName
		cfg.MetricsTables.ExponentialHistogram.Name = localMetricsExpHistogramViewName
		cfg.MetricsTables.Summary.Name = localMetricsSummaryViewName
	})
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
	require.NotContains(t, joinedQueries(session.queries), "CREATE VIEW")
	require.NotContains(t, joinedQueries(session.queries), "DROP VIEW")
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
