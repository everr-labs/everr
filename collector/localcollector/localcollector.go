// Package localcollector runs the local diagnostic collector: chDB storage,
// the SQL HTTP endpoint, and an OTLP pipeline that writes into chDB.
package localcollector

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/otelcol"
	"go.opentelemetry.io/collector/receiver"
	otlpreceiver "go.opentelemetry.io/collector/receiver/otlpreceiver"
	otelconftelemetry "go.opentelemetry.io/collector/service/telemetry/otelconftelemetry"
	"go.uber.org/zap"

	chdbexporter "github.com/everr-labs/everr/collector/exporter/chdbexporter"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
	localconfig "github.com/everr-labs/everr/collector/internal/localgateway/config"
	"github.com/everr-labs/everr/collector/internal/localgateway/sqlhttp"
)

type Options struct {
	// OTLPEndpoint and SQLEndpoint are loopback HTTP origins such as
	// http://127.0.0.1:4318.
	OTLPEndpoint string
	SQLEndpoint  string
	ChDBPath     string
	// ChDBLibraryPath is the libchdb shared library; empty uses $CHDB_LIB_PATH.
	ChDBLibraryPath string
	TTL             time.Duration
	// Version and InstanceID identify this instance on the SQL /health endpoint.
	Version    string
	InstanceID string
	Logger     *zap.Logger
}

// Gateway owns chDB and the SQL endpoint for the life of the process. The
// OTLP pipeline runs separately so it can be restarted without reopening
// chDB, which a process can only open once.
type Gateway struct {
	opts   Options
	otlp   localconfig.Endpoint
	handle *chdb.Handle
	sql    *sqlhttp.Server
	logger *zap.Logger

	mu      sync.Mutex
	running bool
}

// Open loads chDB and starts the SQL endpoint. Its /health reports
// "starting" until Run brings the OTLP pipeline up.
func Open(opts Options) (*Gateway, error) {
	otlp, err := localconfig.ParseEndpoint(opts.OTLPEndpoint)
	if err != nil {
		return nil, fmt.Errorf("otlp http endpoint: %w", err)
	}
	sql, err := localconfig.ParseEndpoint(opts.SQLEndpoint)
	if err != nil {
		return nil, fmt.Errorf("sql http endpoint: %w", err)
	}
	if opts.ChDBPath == "" {
		return nil, errors.New("chdb path must be specified")
	}
	if opts.TTL <= 0 {
		return nil, errors.New("ttl must be greater than zero")
	}
	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}

	handle, err := chdb.Open(opts.ChDBPath, chdb.WithLibraryPath(opts.ChDBLibraryPath))
	if err != nil {
		return nil, fmt.Errorf("open chdb: %w", err)
	}
	server := sqlhttp.NewServer(
		sqlhttp.Config{Endpoint: sql.ListenAddress},
		handle,
		logger,
		sqlhttp.Identity{Version: opts.Version, InstanceID: opts.InstanceID},
	)
	if err := server.Start(); err != nil {
		_ = handle.Close()
		return nil, fmt.Errorf("start sql http server: %w", err)
	}
	return &Gateway{opts: opts, otlp: otlp, handle: handle, sql: server, logger: logger}, nil
}

// Run runs the OTLP pipeline until ctx is canceled or the pipeline fails.
// The SQL endpoint reports ready only while the pipeline is running. Run can
// be called again after it returns.
func (g *Gateway) Run(ctx context.Context) error {
	g.mu.Lock()
	if g.running {
		g.mu.Unlock()
		return errors.New("collector is already running")
	}
	g.running = true
	g.mu.Unlock()
	defer func() {
		g.sql.SetReady(false)
		g.mu.Lock()
		g.running = false
		g.mu.Unlock()
	}()

	collector, err := otelcol.NewCollector(g.collectorSettings())
	if err != nil {
		return fmt.Errorf("create collector: %w", err)
	}

	done := make(chan error, 1)
	go func() { done <- collector.Run(ctx) }()

	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case err := <-done:
			return err
		case <-ticker.C:
			if collector.GetState() == otelcol.StateRunning {
				g.sql.SetReady(true)
				ticker.Stop()
			}
		case <-ctx.Done():
			collector.Shutdown()
			if err := <-done; err != nil {
				return err
			}
			return ctx.Err()
		}
	}
}

// Close stops the SQL endpoint and closes chDB. Callers must let Run return
// first.
func (g *Gateway) Close(ctx context.Context) error {
	err := g.sql.Shutdown(ctx)
	return errors.Join(err, g.handle.Close())
}

func (g *Gateway) collectorSettings() otelcol.CollectorSettings {
	rawConfig := localconfig.BuildCollectorConfigMap(localconfig.CollectorConfig{
		OTLPListenAddress: g.otlp.ListenAddress,
		TTL:               g.opts.TTL,
	})
	return otelcol.CollectorSettings{
		BuildInfo: component.BuildInfo{
			Command:     "everr-local-collector",
			Description: "Local diagnostic collector gateway",
			Version:     "0.1.0",
		},
		Factories: collectorFactories(g.handle),
		ConfigProviderSettings: otelcol.ConfigProviderSettings{
			ResolverSettings: confmap.ResolverSettings{
				URIs:              []string{localconfig.StaticURI},
				DefaultScheme:     localconfig.StaticScheme,
				ProviderFactories: []confmap.ProviderFactory{localconfig.NewStaticProviderFactory(rawConfig)},
			},
		},
		ProviderModules: map[string]string{
			localconfig.StaticScheme: "github.com/everr-labs/everr/collector/internal/localgateway/config v0.0.0",
		},
		ConverterModules: []string{},
		// The embedding process owns signal handling and stops Run through ctx.
		DisableGracefulShutdown: true,
		SkipSettingGRPCLogger:   true,
	}
}

func collectorFactories(handle *chdb.Handle) func() (otelcol.Factories, error) {
	return func() (otelcol.Factories, error) {
		var err error
		factories := otelcol.Factories{
			Telemetry: otelconftelemetry.NewFactory(),
		}

		factories.Receivers, err = otelcol.MakeFactoryMap[receiver.Factory](
			otlpreceiver.NewFactory(),
		)
		if err != nil {
			return otelcol.Factories{}, err
		}
		factories.ReceiverModules = makeModulesMap(factories.Receivers, map[component.Type]string{
			otlpreceiver.NewFactory().Type(): "go.opentelemetry.io/collector/receiver/otlpreceiver v0.152.0",
		})

		factories.Exporters, err = otelcol.MakeFactoryMap[exporter.Factory](
			chdbexporter.NewFactoryWithHandle(handle),
		)
		if err != nil {
			return otelcol.Factories{}, err
		}
		factories.ExporterModules = makeModulesMap(factories.Exporters, map[component.Type]string{
			chdbexporter.NewFactory().Type(): "github.com/everr-labs/everr/collector/exporter/chdbexporter v0.160.0",
		})

		return factories, nil
	}
}

type aliasProvider interface{ DeprecatedAlias() component.Type }

func makeModulesMap[T component.Factory](factories map[component.Type]T, modules map[component.Type]string) map[component.Type]string {
	for compType, factory := range factories {
		if ap, ok := any(factory).(aliasProvider); ok {
			alias := ap.DeprecatedAlias()
			if alias.String() != "" {
				modules[alias] = modules[compType]
			}
		}
	}
	return modules
}
