package clickhouseexporter

import (
	"context"
	"testing"
	"time"

	"github.com/everr-labs/chdbexporter/chdbhandle"
	"go.opentelemetry.io/collector/component/componenttest"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.uber.org/zap/zaptest"
)

func TestPushMetricsRoundTrip(t *testing.T) {
	t.Cleanup(chdbhandle.ResetForTesting)

	cfg := &Config{
		Path: t.TempDir(),
		TTL:  48 * time.Hour,
	}
	exporter := newMetricsExporter(zaptest.NewLogger(t), cfg)
	if err := exporter.start(context.Background(), componenttest.NewNopHost()); err != nil {
		t.Fatal(err)
	}

	metrics := pmetric.NewMetrics()
	rm := metrics.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "unit")
	scopeMetrics := rm.ScopeMetrics().AppendEmpty().Metrics()

	now := pcommon.NewTimestampFromTime(time.Now())

	gauge := scopeMetrics.AppendEmpty()
	gauge.SetName("gauge")
	gdp := gauge.SetEmptyGauge().DataPoints().AppendEmpty()
	gdp.SetTimestamp(now)
	gdp.SetIntValue(1)

	sum := scopeMetrics.AppendEmpty()
	sum.SetName("sum")
	sdp := sum.SetEmptySum().DataPoints().AppendEmpty()
	sdp.SetTimestamp(now)
	sdp.SetIntValue(1)

	histogram := scopeMetrics.AppendEmpty()
	histogram.SetName("histogram")
	hdp := histogram.SetEmptyHistogram().DataPoints().AppendEmpty()
	hdp.SetTimestamp(now)
	hdp.SetCount(1)
	hdp.SetSum(1)

	expHistogram := scopeMetrics.AppendEmpty()
	expHistogram.SetName("exp_histogram")
	ehdp := expHistogram.SetEmptyExponentialHistogram().DataPoints().AppendEmpty()
	ehdp.SetTimestamp(now)
	ehdp.SetCount(1)
	ehdp.SetSum(1)

	summary := scopeMetrics.AppendEmpty()
	summary.SetName("summary")
	sdp2 := summary.SetEmptySummary().DataPoints().AppendEmpty()
	sdp2.SetTimestamp(now)
	sdp2.SetCount(1)
	sdp2.SetSum(1)

	if err := exporter.pushMetricsData(context.Background(), metrics); err != nil {
		t.Fatalf("push metrics: %v", err)
	}

	if got := countRows(t, exporter.handle, cfg.metricsGaugeTableName()); got != 1 {
		t.Fatalf("want 1 gauge row, got %d", got)
	}
	if got := countRows(t, exporter.handle, cfg.metricsSumTableName()); got != 1 {
		t.Fatalf("want 1 sum row, got %d", got)
	}
	if got := countRows(t, exporter.handle, cfg.metricsHistogramTableName()); got != 1 {
		t.Fatalf("want 1 histogram row, got %d", got)
	}
	if got := countRows(t, exporter.handle, cfg.metricsExponentialHistogramTableName()); got != 1 {
		t.Fatalf("want 1 exponential histogram row, got %d", got)
	}
	if got := countRows(t, exporter.handle, cfg.metricsSummaryTableName()); got != 1 {
		t.Fatalf("want 1 summary row, got %d", got)
	}
}
