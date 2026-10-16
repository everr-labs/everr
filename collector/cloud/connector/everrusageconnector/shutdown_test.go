package everrusageconnector

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	usage "github.com/everr-labs/everr/collector/extension/everrusageextension"
	meterprocessor "github.com/everr-labs/everr/collector/processor/everrusageprocessor"
	filestorage "github.com/open-telemetry/opentelemetry-collector-contrib/extension/storage/filestorage"
	cumulative "github.com/open-telemetry/opentelemetry-collector-contrib/processor/deltatocumulativeprocessor"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/configoptional"
	"go.opentelemetry.io/collector/connector"
	"go.opentelemetry.io/collector/connector/forwardconnector"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/exporter/exporterhelper"
	"go.opentelemetry.io/collector/exporter/exportertest"
	"go.opentelemetry.io/collector/extension"
	"go.opentelemetry.io/collector/extension/extensiontest"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/collector/pipeline"
	"go.opentelemetry.io/collector/processor"
	"go.opentelemetry.io/collector/receiver"
	"go.opentelemetry.io/collector/service"
	"go.opentelemetry.io/collector/service/pipelines"
	"go.opentelemetry.io/collector/service/telemetry"
)

type source struct {
	emit func(context.Context) error
}

func (s *source) Start(ctx context.Context, _ component.Host) error { return s.emit(ctx) }
func (s *source) Shutdown(ctx context.Context) error {
	return s.emit(ctx)
}
func sourceFactory() receiver.Factory {
	return receiver.NewFactory(component.MustNewType("source"), func() component.Config { return &struct{}{} },
		receiver.WithLogs(func(_ context.Context, _ receiver.Settings, _ component.Config, n consumer.Logs) (receiver.Logs, error) {
			return &source{emit: func(ctx context.Context) error {
				d := plog.NewLogs()
				r := d.ResourceLogs().AppendEmpty()
				r.Resource().Attributes().PutStr(usage.TenantKey, "customer")
				r.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty().Body().SetStr("hello")
				return n.ConsumeLogs(ctx, d)
			}}, nil
		}, component.StabilityLevelDevelopment),
		receiver.WithTraces(func(_ context.Context, _ receiver.Settings, _ component.Config, n consumer.Traces) (receiver.Traces, error) {
			return &source{emit: func(ctx context.Context) error {
				d := ptrace.NewTraces()
				r := d.ResourceSpans().AppendEmpty()
				r.Resource().Attributes().PutStr(usage.TenantKey, "customer")
				r.ScopeSpans().AppendEmpty().Spans().AppendEmpty().SetName("hello")
				return n.ConsumeTraces(ctx, d)
			}}, nil
		}, component.StabilityLevelDevelopment),
		receiver.WithMetrics(func(_ context.Context, _ receiver.Settings, _ component.Config, n consumer.Metrics) (receiver.Metrics, error) {
			return &source{emit: func(ctx context.Context) error {
				d := pmetric.NewMetrics()
				r := d.ResourceMetrics().AppendEmpty()
				r.Resource().Attributes().PutStr(usage.TenantKey, "customer")
				m := r.ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
				m.SetName("test")
				m.SetEmptyGauge().DataPoints().AppendEmpty().SetIntValue(1)
				return n.ConsumeMetrics(ctx, d)
			}}, nil
		}, component.StabilityLevelDevelopment))
}

type results struct {
	mu      sync.Mutex
	bytes   map[string]int64
	records map[string]int
	usage   map[string]map[string]int64
}

func (r *results) source(signal string, n int, bytes int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.records[signal] += n
	r.bytes[signal] += bytes
}
func storageFactory(r *results) exporter.Factory {
	options := func(set exporter.Settings) []exporterhelper.Option {
		q := exporterhelper.NewDefaultQueueConfig()
		id := component.MustNewID("file_storage")
		q.StorageID = &id
		q.WaitForResult = false
		q.BlockOnOverflow = set.ID.Name() == "usage"
		q.NumConsumers = 10
		q.Batch.GetOrInsertDefault().MinSize = 8192
		q.Batch.Get().FlushTimeout = time.Second
		return []exporterhelper.Option{exporterhelper.WithQueue(configoptional.Some(q))}
	}
	return exporter.NewFactory(component.MustNewType("storage"), func() component.Config { return &struct{}{} },
		exporter.WithLogs(func(ctx context.Context, s exporter.Settings, c component.Config) (exporter.Logs, error) {
			return exporterhelper.NewLogs(ctx, s, c, func(_ context.Context, d plog.Logs) error {
				n := d.LogRecordCount()
				for _, res := range d.ResourceLogs().All() {
					res.Resource().Attributes().Remove(usage.TenantKey)
				}
				r.source("logs", n, int64((&plog.ProtoMarshaler{}).LogsSize(d)))
				return nil
			}, options(s)...)
		}, component.StabilityLevelDevelopment),
		exporter.WithTraces(func(ctx context.Context, s exporter.Settings, c component.Config) (exporter.Traces, error) {
			return exporterhelper.NewTraces(ctx, s, c, func(_ context.Context, d ptrace.Traces) error {
				n := d.SpanCount()
				for _, res := range d.ResourceSpans().All() {
					res.Resource().Attributes().Remove(usage.TenantKey)
				}
				r.source("traces", n, int64((&ptrace.ProtoMarshaler{}).TracesSize(d)))
				return nil
			}, options(s)...)
		}, component.StabilityLevelDevelopment),
		exporter.WithMetrics(func(ctx context.Context, s exporter.Settings, c component.Config) (exporter.Metrics, error) {
			return exporterhelper.NewMetrics(ctx, s, c, func(_ context.Context, d pmetric.Metrics) error {
				originals := pmetric.NewMetrics()
				for _, res := range d.ResourceMetrics().All() {
					m := res.ScopeMetrics().At(0).Metrics().At(0)
					if m.Name() != usage.MetricName {
						copy := originals.ResourceMetrics().AppendEmpty()
						res.CopyTo(copy)
						copy.Resource().Attributes().Remove(usage.TenantKey)
						continue
					}
					owner, _ := res.Resource().Attributes().Get(usage.TenantKey)
					for _, point := range m.Sum().DataPoints().All() {
						signal, _ := point.Attributes().Get("everr.ingestion.signal")
						r.mu.Lock()
						if r.usage[owner.Str()] == nil {
							r.usage[owner.Str()] = map[string]int64{}
						}
						r.usage[owner.Str()][signal.Str()] += point.IntValue()
						r.mu.Unlock()
					}
				}
				if originals.DataPointCount() > 0 {
					r.source("metrics", originals.DataPointCount(), int64((&pmetric.ProtoMarshaler{}).MetricsSize(originals)))
				}
				return nil
			}, options(s)...)
		}, component.StabilityLevelDevelopment))
}

type admin struct {
	component.StartFunc
	component.ShutdownFunc
	next consumer.Metrics
}

func (*admin) Capabilities() consumer.Capabilities { return consumer.Capabilities{MutatesData: true} }
func (a *admin) ConsumeMetrics(ctx context.Context, d pmetric.Metrics) error {
	for _, r := range d.ResourceMetrics().All() {
		r.Resource().Attributes().PutStr(usage.TenantKey, "admin")
	}
	return a.next.ConsumeMetrics(ctx, d)
}
func adminFactory() processor.Factory {
	return processor.NewFactory(component.MustNewType("admin"), func() component.Config { return &struct{}{} },
		processor.WithMetrics(func(_ context.Context, _ processor.Settings, _ component.Config, n consumer.Metrics) (processor.Metrics, error) {
			return &admin{next: n}, nil
		}, component.StabilityLevelDevelopment))
}

type restoreHost map[component.ID]component.Component

func (h restoreHost) GetExtensions() map[component.ID]component.Component { return h }
func restoreQueues(t *testing.T, sf extension.Factory, sc component.Config, ef exporter.Factory) func() {
	ext, err := sf.Create(t.Context(), extensiontest.NewNopSettings(sf.Type()), sc)
	require.NoError(t, err)
	host := restoreHost{component.NewID(sf.Type()): ext}
	require.NoError(t, ext.Start(t.Context(), host))
	settings := exportertest.NewNopSettings(ef.Type())
	settings.ID = component.NewID(ef.Type())
	l, err := ef.CreateLogs(t.Context(), settings, ef.CreateDefaultConfig())
	require.NoError(t, err)
	tr, err := ef.CreateTraces(t.Context(), settings, ef.CreateDefaultConfig())
	require.NoError(t, err)
	m, err := ef.CreateMetrics(t.Context(), settings, ef.CreateDefaultConfig())
	require.NoError(t, err)
	settings.ID = component.NewIDWithName(ef.Type(), "usage")
	u, err := ef.CreateMetrics(t.Context(), settings, ef.CreateDefaultConfig())
	require.NoError(t, err)
	for _, c := range []component.Component{l, tr, m, u} {
		require.NoError(t, c.Start(t.Context(), host))
	}
	return func() {
		for _, c := range []component.Component{l, tr, m, u, ext} {
			require.NoError(t, c.Shutdown(context.Background()))
		}
	}
}

func TestRealCollectorShutdownGraph(t *testing.T) {
	for _, withAdmin := range []bool{false, true} {
		t.Run(fmt.Sprint("admin=", withAdmin), func(t *testing.T) {
			for iteration := 0; iteration < 3; iteration++ {
				r := &results{bytes: map[string]int64{}, records: map[string]int{}, usage: map[string]map[string]int64{}}
				uf, mf, sf, af, rf, ef, cf, ff, adf := usage.NewFactory(), meterprocessor.NewFactory(), filestorage.NewFactory(), NewFactory(), sourceFactory(), storageFactory(r), cumulative.NewFactory(), forwardconnector.NewFactory(), adminFactory()
				sc := sf.CreateDefaultConfig().(*filestorage.Config)
				sc.Directory = t.TempDir()
				sc.FSync = true
				ac := af.CreateDefaultConfig().(*Config)
				ac.Interval = time.Hour // Isolate the final shutdown snapshot.
				set := service.Settings{
					BuildInfo: component.NewDefaultBuildInfo(), AsyncErrorChannel: make(chan error, 10), TelemetryFactory: telemetry.NewFactory(func() component.Config { return nil }),
					ExtensionsConfigs:   map[component.ID]component.Config{component.NewID(uf.Type()): uf.CreateDefaultConfig(), component.NewID(sf.Type()): sc},
					ExtensionsFactories: map[component.Type]extension.Factory{uf.Type(): uf, sf.Type(): sf},
					ReceiversConfigs:    map[component.ID]component.Config{component.NewID(rf.Type()): rf.CreateDefaultConfig()},
					ReceiversFactories:  map[component.Type]receiver.Factory{rf.Type(): rf},
					ProcessorsConfigs:   map[component.ID]component.Config{component.NewID(mf.Type()): mf.CreateDefaultConfig(), component.NewID(cf.Type()): cf.CreateDefaultConfig(), component.NewID(adf.Type()): adf.CreateDefaultConfig()},
					ProcessorsFactories: map[component.Type]processor.Factory{mf.Type(): mf, cf.Type(): cf, adf.Type(): adf},
					ExportersConfigs:    map[component.ID]component.Config{component.NewID(ef.Type()): ef.CreateDefaultConfig(), component.NewIDWithName(ef.Type(), "usage"): ef.CreateDefaultConfig()},
					ExportersFactories:  map[component.Type]exporter.Factory{ef.Type(): ef},
					ConnectorsConfigs:   map[component.ID]component.Config{component.NewID(af.Type()): ac, component.NewID(ff.Type()): ff.CreateDefaultConfig()},
					ConnectorsFactories: map[component.Type]connector.Factory{af.Type(): af, ff.Type(): ff},
				}
				pipes := pipelines.Config{}
				for _, signal := range []pipeline.Signal{pipeline.SignalLogs, pipeline.SignalTraces, pipeline.SignalMetrics} {
					pipes[pipeline.NewIDWithName(signal, fmt.Sprintf("input_%d", iteration))] = &pipelines.PipelineConfig{
						Receivers:  []component.ID{component.NewID(rf.Type())},
						Processors: []component.ID{component.NewID(mf.Type())},
						Exporters:  []component.ID{component.NewID(ef.Type()), component.NewID(af.Type())},
					}
				}
				output := component.NewIDWithName(ef.Type(), "usage")
				if withAdmin {
					output = component.NewID(ff.Type())
				}
				pipes[pipeline.NewIDWithName(pipeline.SignalMetrics, "usage")] = &pipelines.PipelineConfig{
					Receivers: []component.ID{component.NewID(af.Type())}, Processors: []component.ID{component.NewID(cf.Type())}, Exporters: []component.ID{output},
				}
				if withAdmin {
					for _, owner := range []string{"customer", "admin"} {
						conf := &pipelines.PipelineConfig{Receivers: []component.ID{component.NewID(ff.Type())}, Exporters: []component.ID{component.NewIDWithName(ef.Type(), "usage")}}
						if owner == "admin" {
							conf.Processors = []component.ID{component.NewID(adf.Type())}
						}
						pipes[pipeline.NewIDWithName(pipeline.SignalMetrics, owner)] = conf
					}
				}
				srv, err := service.New(t.Context(), set, service.Config{Extensions: []component.ID{component.NewID(sf.Type()), component.NewID(uf.Type())}, Pipelines: pipes})
				require.NoError(t, err)
				require.NoError(t, srv.Start(t.Context()))
				require.NoError(t, srv.Shutdown(context.Background()))

				// Queued snapshots can be delivered after restart.
				stopRecovery := restoreQueues(t, sf, sc, ef)
				require.Eventually(t, func() bool {
					r.mu.Lock()
					defer r.mu.Unlock()
					if r.records["logs"] != 2 || r.records["traces"] != 2 || r.records["metrics"] != 2 {
						return false
					}
					for _, signal := range []string{"logs", "traces", "metrics"} {
						if r.bytes[signal] != r.usage["customer"][signal] {
							return false
						}
						if withAdmin && r.usage["customer"][signal] != r.usage["admin"][signal] {
							return false
						}
					}
					return true
				}, 5*time.Second, time.Millisecond)
				stopRecovery()
				if iteration == 0 {
					t.Log("stored bytes and usage", r.bytes, r.usage)
				}
			}
		})
	}
}
