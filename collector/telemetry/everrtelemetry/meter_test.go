package everrtelemetry

import (
	"context"
	"errors"
	"sync"
	"testing"

	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/receiver"
	"go.opentelemetry.io/collector/receiver/receiverhelper"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/trace/noop"
)

type authData struct{ tenant any }

func (a authData) GetAttribute(name string) any {
	if name == "tenant_id" {
		return a.tenant
	}
	return nil
}
func (authData) GetAttributeNames() []string { return []string{"tenant_id"} }
func tenantContext(tenant any) context.Context {
	return client.NewContext(context.Background(), client.Info{Auth: authData{tenant: tenant}})
}
func newProvider(t *testing.T) (*meterProvider, *sdkmetric.ManualReader) {
	t.Helper()
	reader := sdkmetric.NewManualReader()
	sdk := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	t.Cleanup(func() { _ = sdk.Shutdown(context.Background()) })
	return &meterProvider{MeterProvider: sdk}, reader
}
func collect(t *testing.T, reader *sdkmetric.ManualReader) map[string]metricdata.Sum[int64] {
	t.Helper()
	var data metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &data); err != nil {
		t.Fatal(err)
	}
	results := map[string]metricdata.Sum[int64]{}
	for _, scope := range data.ScopeMetrics {
		for _, m := range scope.Metrics {
			if sum, ok := m.Data.(metricdata.Sum[int64]); ok {
				results[scope.Scope.Name+"/"+m.Name] = sum
			}
		}
	}
	return results
}

func TestNativeReceiverCountsRemainTenantIsolated(t *testing.T) {
	provider, reader := newProvider(t)
	report, err := receiverhelper.NewObsReport(receiverhelper.ObsReportSettings{
		ReceiverID: component.NewIDWithName(component.MustNewType("otlp"), "public"), Transport: "http",
		ReceiverCreateSettings: receiver.Settings{TelemetrySettings: component.TelemetrySettings{MeterProvider: provider, TracerProvider: noop.NewTracerProvider()}},
	})
	if err != nil {
		t.Fatal(err)
	}
	report.EndTracesOp(report.StartTracesOp(tenantContext("tenant-a")), "protobuf", 7, nil)
	report.EndTracesOp(report.StartTracesOp(tenantContext("tenant-b")), "protobuf", 13, nil)
	report.EndTracesOp(report.StartTracesOp(tenantContext("tenant-a")), "protobuf", 3, errors.New("queue full"))
	report.EndMetricsOp(report.StartMetricsOp(tenantContext("tenant-b")), "protobuf", 5, nil)
	report.EndLogsOp(report.StartLogsOp(tenantContext("tenant-a")), "protobuf", 11, nil)
	data := collect(t, reader)
	for _, tc := range []struct {
		name, tenant string
		value        int64
	}{
		{"otelcol_receiver_accepted_spans", "tenant-a", 7}, {"otelcol_receiver_accepted_spans", "tenant-b", 13},
		{"otelcol_receiver_refused_spans", "tenant-a", 3}, {"otelcol_receiver_accepted_metric_points", "tenant-b", 5},
		{"otelcol_receiver_accepted_log_records", "tenant-a", 11},
	} {
		sum := data[receiverScope+"/"+tc.name]
		if !sum.IsMonotonic || sum.Temporality != metricdata.CumulativeTemporality {
			t.Fatalf("%s: wrong counter shape", tc.name)
		}
		found := false
		for _, point := range sum.DataPoints {
			id, _ := point.Attributes.Value(attribute.Key(TenantKey))
			if id.AsString() != tc.tenant {
				continue
			}
			found = true
			if point.Value != tc.value {
				t.Errorf("%s/%s = %d, want %d", tc.name, tc.tenant, point.Value, tc.value)
			}
			receiverID, _ := point.Attributes.Value("receiver")
			transport, _ := point.Attributes.Value("transport")
			if receiverID.AsString() != "otlp/public" || transport.AsString() != "http" {
				t.Errorf("lost native labels: %v", point.Attributes)
			}
		}
		if !found {
			t.Errorf("missing %s/%s", tc.name, tc.tenant)
		}
	}
}

func TestOnlyNativeReceiverCountersAreEnriched(t *testing.T) {
	provider, reader := newProvider(t)
	ctx := tenantContext("trusted")
	for _, tc := range []struct {
		scope, name string
		enriched    bool
	}{
		{receiverScope, "otelcol_receiver_accepted_spans", true},
		{receiverScope, "otelcol_receiver_refused_metric_points", true},
		{receiverScope, "otelcol_receiver_failed_log_records", true},
		{receiverScope, "unrelated_counter", false},
		{"customer.instrumentation", "otelcol_receiver_accepted_spans", false},
	} {
		counter, err := provider.Meter(tc.scope).Int64Counter(tc.name)
		if err != nil {
			t.Fatal(err)
		}
		counter.Add(ctx, 1)
	}
	data := collect(t, reader)
	for key, sum := range data {
		_, found := sum.DataPoints[0].Attributes.Value(attribute.Key(TenantKey))
		expected := key == receiverScope+"/otelcol_receiver_accepted_spans" || key == receiverScope+"/otelcol_receiver_refused_metric_points" || key == receiverScope+"/otelcol_receiver_failed_log_records"
		if found != expected {
			t.Errorf("%s: enrichment=%t, want %t", key, found, expected)
		}
	}
}

func TestTrustedIdentityOverridesCallerWithoutMutatingOptions(t *testing.T) {
	provider, reader := newProvider(t)
	counter, err := provider.Meter(receiverScope).Int64Counter("otelcol_receiver_accepted_spans")
	if err != nil {
		t.Fatal(err)
	}
	options := make([]metric.AddOption, 1, 2)
	options[0] = metric.WithAttributes(attribute.String(TenantKey, "forged"))
	sentinel := metric.WithAttributes(attribute.String("sentinel", "unchanged"))
	backing := options[:2]
	backing[1] = sentinel
	counter.Add(tenantContext("trusted"), 1, options...)
	if backing[1] != sentinel {
		t.Fatal("mutated caller option storage")
	}
	sum := collect(t, reader)[receiverScope+"/otelcol_receiver_accepted_spans"]
	id, _ := sum.DataPoints[0].Attributes.Value(attribute.Key(TenantKey))
	if id.AsString() != "trusted" {
		t.Fatalf("tenant=%s", id.AsString())
	}
}

func TestMissingOrInvalidAuthenticationKeepsNativeMeasurements(t *testing.T) {
	provider, reader := newProvider(t)
	counter, err := provider.Meter(receiverScope).Int64Counter("otelcol_receiver_accepted_spans")
	if err != nil {
		t.Fatal(err)
	}
	for _, ctx := range []context.Context{context.Background(), tenantContext(""), tenantContext(42)} {
		counter.Add(ctx, 2)
	}
	sum := collect(t, reader)[receiverScope+"/otelcol_receiver_accepted_spans"]
	if len(sum.DataPoints) != 1 || sum.DataPoints[0].Value != 6 {
		t.Fatalf("unexpected points: %v", sum.DataPoints)
	}
	if _, found := sum.DataPoints[0].Attributes.Value(attribute.Key(TenantKey)); found {
		t.Fatal("invented tenant identity")
	}
}

func TestConcurrentTenants(t *testing.T) {
	provider, reader := newProvider(t)
	counter, err := provider.Meter(receiverScope).Int64Counter("otelcol_receiver_accepted_spans")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for _, id := range []string{"a", "b", "c"} {
		wg.Go(func() {
			for range 1000 {
				counter.Add(tenantContext(id), 1)
			}
		})
	}
	wg.Wait()
	sum := collect(t, reader)[receiverScope+"/otelcol_receiver_accepted_spans"]
	if len(sum.DataPoints) != 3 {
		t.Fatalf("got %d streams", len(sum.DataPoints))
	}
	for _, point := range sum.DataPoints {
		if point.Value != 1000 {
			t.Errorf("value=%d", point.Value)
		}
	}
}
