package localcollector

import (
	"errors"
	"math"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component/componenttest"
	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/consumer/consumererror"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
	"go.opentelemetry.io/collector/exporter/exportertest"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"

	chdbexporter "github.com/everr-labs/everr/collector/exporter/chdbexporter"
)

// directConfig is the exporter's default config without the queue, so a
// push returns its error to the test instead of to a background worker.
func (g *gateway) directConfig(t *testing.T) (exporter.Factory, *chdbexporter.Config) {
	t.Helper()
	factory := chdbexporter.NewFactory(g.handle)
	cfg := factory.CreateDefaultConfig().(*chdbexporter.Config)
	cfg.RetentionDays = retentionDays
	cfg.QueueSettings = configoptional.None[exporterhelper.QueueBatchConfig]()
	cfg.BackOffConfig.Enabled = false
	return factory, cfg
}

func (g *gateway) logsExporter(t *testing.T) exporter.Logs {
	t.Helper()
	factory, cfg := g.directConfig(t)
	exp, err := factory.CreateLogs(t.Context(), exportertest.NewNopSettings(factory.Type()), cfg)
	require.NoError(t, err)
	require.NoError(t, exp.Start(t.Context(), componenttest.NewNopHost()))
	t.Cleanup(func() { _ = exp.Shutdown(t.Context()) })
	return exp
}

func (g *gateway) tracesExporter(t *testing.T) exporter.Traces {
	t.Helper()
	factory, cfg := g.directConfig(t)
	exp, err := factory.CreateTraces(t.Context(), exportertest.NewNopSettings(factory.Type()), cfg)
	require.NoError(t, err)
	require.NoError(t, exp.Start(t.Context(), componenttest.NewNopHost()))
	t.Cleanup(func() { _ = exp.Shutdown(t.Context()) })
	return exp
}

func (g *gateway) metricsExporter(t *testing.T, configure func(*chdbexporter.Config)) exporter.Metrics {
	t.Helper()
	factory, cfg := g.directConfig(t)
	if configure != nil {
		configure(cfg)
	}
	exp, err := factory.CreateMetrics(t.Context(), exportertest.NewNopSettings(factory.Type()), cfg)
	require.NoError(t, err)
	require.NoError(t, exp.Start(t.Context(), componenttest.NewNopHost()))
	t.Cleanup(func() { _ = exp.Shutdown(t.Context()) })
	return exp
}

func putNonFinite(m pcommon.Map) {
	m.PutDouble("ratio.nan", math.NaN())
	m.PutDouble("ratio.inf", math.Inf(1))
	m.PutEmptySlice("ratios").FromRaw([]any{1.5, math.Inf(-1)})
}

func TestNonFiniteFloatsAreStoredWithTheRestOfTheirPush(t *testing.T) {
	g := openGateway(t)

	t.Run("metrics", func(t *testing.T) {
		md := oneMetricOfEachKind()
		metrics := md.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics()
		for i := range metrics.Len() {
			metric := metrics.At(i)
			switch metric.Name() {
			case "gauge":
				dp := metric.Gauge().DataPoints().At(0)
				dp.SetDoubleValue(math.NaN())
				dp.Exemplars().At(0).SetDoubleValue(math.Inf(1))
			case "histogram":
				dp := metric.Histogram().DataPoints().At(0)
				dp.SetSum(math.Inf(1))
				dp.SetMin(math.Inf(-1))
				dp.ExplicitBounds().FromRaw([]float64{1, math.Inf(1)})
			case "summary":
				dp := metric.Summary().DataPoints().At(0)
				dp.SetSum(math.NaN())
				quantile := dp.QuantileValues().AppendEmpty()
				quantile.SetQuantile(0.5)
				quantile.SetValue(math.Inf(1))
			}
		}
		require.NoError(t, g.metricsExporter(t, nil).ConsumeMetrics(t.Context(), md))

		gauge := g.query(t, "SELECT isNaN(Value) AS nan, arrayMap(v -> isInfinite(v), Exemplars.Value) AS inf FROM metrics_gauge")
		require.Len(t, gauge, 1)
		require.EqualValues(t, 1, gauge[0]["nan"])
		require.Equal(t, []any{float64(1)}, gauge[0]["inf"])
		histogram := g.query(t, "SELECT Sum > 0 AND isInfinite(Sum) AS sum, Min < 0 AND isInfinite(Min) AS min, isInfinite(ExplicitBounds[2]) AS bound FROM metrics_histogram")
		require.Len(t, histogram, 1)
		require.Equal(t, map[string]any{"sum": float64(1), "min": float64(1), "bound": float64(1)}, histogram[0])
		summary := g.query(t, "SELECT isNaN(Sum) AS sum, isInfinite(ValueAtQuantiles.Value[1]) AS quantile FROM metrics_summary")
		require.Len(t, summary, 1)
		require.Equal(t, map[string]any{"sum": float64(1), "quantile": float64(1)}, summary[0])
		for _, table := range []string{"metrics_sum", "metrics_exponential_histogram"} {
			require.Equal(t, "1", g.query(t, "SELECT toString(count()) AS n FROM "+table)[0]["n"], table)
		}
	})

	t.Run("logs", func(t *testing.T) {
		ld := oneLog("non-finite-logs", "finite sibling")
		resourceLogs := ld.ResourceLogs().At(0)
		putNonFinite(resourceLogs.Resource().Attributes())
		putNonFinite(resourceLogs.ScopeLogs().At(0).Scope().Attributes())
		bad := resourceLogs.ScopeLogs().At(0).LogRecords().AppendEmpty()
		bad.SetTimestamp(pcommon.NewTimestampFromTime(sentAt))
		bad.Body().SetStr("non-finite")
		putNonFinite(bad.Attributes())
		require.NoError(t, g.logsExporter(t).ConsumeLogs(t.Context(), ld))

		rows := g.query(t, "SELECT Body,"+
			" toString(LogAttributes.`ratio.nan`) AS nan, toString(LogAttributes.`ratio.inf`) AS inf,"+
			" toString(ResourceAttributes.`ratio.nan`) AS resource, toString(ScopeAttributes.`ratio.inf`) AS scope"+
			" FROM logs WHERE ServiceName = 'non-finite-logs' ORDER BY Body")
		require.Len(t, rows, 2, "the finite log in the same push is stored too")
		require.Equal(t, map[string]any{"Body": "non-finite", "nan": "NaN", "inf": "+Inf", "resource": "NaN", "scope": "+Inf"}, rows[1])
	})

	t.Run("traces", func(t *testing.T) {
		td := ptrace.NewTraces()
		resourceSpans := td.ResourceSpans().AppendEmpty()
		resourceSpans.Resource().Attributes().PutStr("service.name", "non-finite-traces")
		putNonFinite(resourceSpans.Resource().Attributes())
		spans := resourceSpans.ScopeSpans().AppendEmpty().Spans()
		finite := spans.AppendEmpty()
		finite.SetName("finite")
		finite.SetStartTimestamp(pcommon.NewTimestampFromTime(sentAt))
		finite.SetEndTimestamp(pcommon.NewTimestampFromTime(sentAt))
		span := spans.AppendEmpty()
		span.SetName("non-finite")
		span.SetStartTimestamp(pcommon.NewTimestampFromTime(sentAt))
		span.SetEndTimestamp(pcommon.NewTimestampFromTime(sentAt))
		putNonFinite(span.Attributes())
		event := span.Events().AppendEmpty()
		event.SetName("event")
		putNonFinite(event.Attributes())
		putNonFinite(span.Links().AppendEmpty().Attributes())
		require.NoError(t, g.tracesExporter(t).ConsumeTraces(t.Context(), td))

		rows := g.query(t, "SELECT SpanName, toString(SpanAttributes.`ratio.inf`) AS inf,"+
			" toString(Events.Attributes[1].`ratio.nan`) AS event, toString(Links.Attributes[1].`ratio.inf`) AS link"+
			" FROM traces WHERE ServiceName = 'non-finite-traces' ORDER BY SpanName")
		require.Len(t, rows, 2, "the finite span in the same push is stored too")
		require.Equal(t, map[string]any{"SpanName": "non-finite", "inf": "+Inf", "event": "NaN", "link": "+Inf"}, rows[1])
	})
}

// clientRetentionSpellings are resource attributes that spell the retention
// path the exporter stamps without using its flat key.
var clientRetentionSpellings = map[string]func(pcommon.Map){
	"nested":        func(m pcommon.Map) { m.PutEmptyMap("everr").PutEmptyMap("retention").PutStr("days", "0") },
	"dotted parent": func(m pcommon.Map) { m.PutEmptyMap("everr.retention").PutStr("days", "0") },
	"dotted child":  func(m pcommon.Map) { m.PutEmptyMap("everr").PutStr("retention.days", "0") },
	"flat and nested": func(m pcommon.Map) {
		m.PutStr("everr.retention.days", "0")
		m.PutEmptyMap("everr").PutEmptyMap("retention").PutStr("days", "0")
	},
}

func collidingAttributes(m pcommon.Map) {
	m.PutStr("http.method", "GET")
	m.PutEmptyMap("http").PutStr("method", "POST")
}

func TestAnAttributePathCollisionKeepsItsBatchAndTheRetentionStampWins(t *testing.T) {
	g := openGateway(t)

	t.Run("logs", func(t *testing.T) {
		ld := oneLog("collision-logs", "colliding")
		collidingAttributes(ld.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0).Attributes())
		for spelling, spell := range clientRetentionSpellings {
			resourceLogs := oneLog("retention-logs "+spelling, spelling).ResourceLogs()
			spell(resourceLogs.At(0).Resource().Attributes())
			resourceLogs.MoveAndAppendTo(ld.ResourceLogs())
		}
		require.NoError(t, g.logsExporter(t).ConsumeLogs(t.Context(), ld))

		rows := g.query(t, "SELECT ServiceName, retention_days FROM logs ORDER BY ServiceName")
		require.Len(t, rows, 1+len(clientRetentionSpellings))
		for _, row := range rows {
			require.EqualValues(t, retentionDays, row["retention_days"], row["ServiceName"])
		}
	})

	t.Run("traces", func(t *testing.T) {
		td := ptrace.NewTraces()
		addSpan := func(service string) ptrace.ResourceSpans {
			resourceSpans := td.ResourceSpans().AppendEmpty()
			resourceSpans.Resource().Attributes().PutStr("service.name", service)
			span := resourceSpans.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
			span.SetName(service)
			span.SetStartTimestamp(pcommon.NewTimestampFromTime(sentAt))
			span.SetEndTimestamp(pcommon.NewTimestampFromTime(sentAt))
			return resourceSpans
		}
		collidingAttributes(addSpan("collision-traces").ScopeSpans().At(0).Spans().At(0).Attributes())
		for spelling, spell := range clientRetentionSpellings {
			spell(addSpan("retention-traces " + spelling).Resource().Attributes())
		}
		require.NoError(t, g.tracesExporter(t).ConsumeTraces(t.Context(), td))

		rows := g.query(t, "SELECT ServiceName, retention_days FROM traces ORDER BY ServiceName")
		require.Len(t, rows, 1+len(clientRetentionSpellings))
		for _, row := range rows {
			require.EqualValues(t, retentionDays, row["retention_days"], row["ServiceName"])
		}
	})

	t.Run("metrics", func(t *testing.T) {
		md := oneMetricOfEachKind()
		for _, spell := range clientRetentionSpellings {
			spell(md.ResourceMetrics().At(0).Resource().Attributes())
		}
		require.NoError(t, g.metricsExporter(t, nil).ConsumeMetrics(t.Context(), md))

		for _, table := range []string{"metrics_gauge", "metrics_sum", "metrics_histogram", "metrics_exponential_histogram", "metrics_summary"} {
			rows := g.query(t, "SELECT retention_days FROM "+table)
			require.Len(t, rows, 1, table)
			require.EqualValues(t, retentionDays, rows[0]["retention_days"], table)
		}
	})
}

// A kind whose insert fails is retried. The kinds that landed must not be
// inserted again. The histogram landing table is renamed so its insert fails
// after the gauge insert has committed.
func TestARetryResendsOnlyTheMetricKindsThatFailed(t *testing.T) {
	g := openGateway(t)
	g.query(t, "RENAME TABLE otel.otel_metrics_histogram TO otel.otel_metrics_histogram_away")
	md := pmetric.NewMetrics()
	oneMetricOfEachKind().ResourceMetrics().MoveAndAppendTo(md.ResourceMetrics())

	t.Run("the failed data holds only the kind that failed", func(t *testing.T) {
		err := g.metricsExporter(t, nil).ConsumeMetrics(t.Context(), oneMetricOfEachKind())

		var failed consumererror.Metrics
		require.True(t, errors.As(err, &failed), "a partial failure: %v", err)
		var names []string
		data := failed.Data()
		for i := range data.ResourceMetrics().Len() {
			for j := range data.ResourceMetrics().At(i).ScopeMetrics().Len() {
				metrics := data.ResourceMetrics().At(i).ScopeMetrics().At(j).Metrics()
				for k := range metrics.Len() {
					names = append(names, metrics.At(k).Name())
				}
			}
		}
		require.Equal(t, []string{"histogram"}, names)
	})

	landed := []string{"metrics_gauge", "metrics_sum", "metrics_exponential_histogram", "metrics_summary"}
	for _, table := range landed {
		g.query(t, "TRUNCATE TABLE "+table)
	}
	t.Run("retries leave one row per data point", func(t *testing.T) {
		retrying := g.metricsExporter(t, func(cfg *chdbexporter.Config) {
			cfg.BackOffConfig.Enabled = true
			cfg.BackOffConfig.InitialInterval = time.Millisecond
			cfg.BackOffConfig.MaxInterval = time.Millisecond
			cfg.BackOffConfig.MaxElapsedTime = 200 * time.Millisecond
			cfg.BackOffConfig.RandomizationFactor = 0
		})

		require.Error(t, retrying.ConsumeMetrics(t.Context(), md), "the histogram never lands")

		for _, table := range landed {
			require.Equal(t, "1", g.query(t, "SELECT toString(count()) AS n FROM "+table)[0]["n"], table)
		}
	})

	for _, table := range landed {
		g.query(t, "TRUNCATE TABLE "+table)
	}
	t.Run("the failed kind lands once its table is back", func(t *testing.T) {
		retrying := g.metricsExporter(t, func(cfg *chdbexporter.Config) {
			cfg.BackOffConfig.Enabled = true
			cfg.BackOffConfig.InitialInterval = 5 * time.Millisecond
			cfg.BackOffConfig.MaxInterval = 5 * time.Millisecond
			cfg.BackOffConfig.MaxElapsedTime = 10 * time.Second
			cfg.BackOffConfig.RandomizationFactor = 0
		})
		restored := make(chan error, 1)
		go func() {
			time.Sleep(100 * time.Millisecond)
			req, _ := http.NewRequest(http.MethodPost, g.sql+"/sql", strings.NewReader("RENAME TABLE otel.otel_metrics_histogram_away TO otel.otel_metrics_histogram"))
			req.Header.Set("X-Everr-Local", "1")
			resp, err := http.DefaultClient.Do(req)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode != http.StatusOK {
					err = errors.New(resp.Status)
				}
			}
			restored <- err
		}()

		require.NoError(t, retrying.ConsumeMetrics(t.Context(), oneMetricOfEachKind()))
		require.NoError(t, <-restored)

		for _, table := range append(landed, "metrics_histogram") {
			require.Equal(t, "1", g.query(t, "SELECT toString(count()) AS n FROM "+table)[0]["n"], table)
		}
	})
}

func TestAQueryCannotChangeTheDatabaseTheNextQueryReads(t *testing.T) {
	g := startGateway(t)
	g.sendLogs(t, oneLog("bare-names", "before USE"))
	g.waitRows(t, "SELECT Body FROM logs WHERE Body = 'before USE'", 1)

	g.query(t, "USE system")

	require.Equal(t, "1", g.query(t, "SELECT toString(count()) AS n FROM logs")[0]["n"])
	require.Equal(t, "app", g.query(t, "SELECT currentDatabase() AS db")[0]["db"])
	g.sendLogs(t, oneLog("bare-names", "after USE"))
	g.waitRows(t, "SELECT Body FROM logs WHERE ServiceName = 'bare-names'", 2)
}
