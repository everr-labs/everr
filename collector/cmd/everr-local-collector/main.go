package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/otelcol"
	"go.opentelemetry.io/collector/processor"
	batchprocessor "go.opentelemetry.io/collector/processor/batchprocessor"
	"go.opentelemetry.io/collector/receiver"
	otlpreceiver "go.opentelemetry.io/collector/receiver/otlpreceiver"
	otelconftelemetry "go.opentelemetry.io/collector/service/telemetry/otelconftelemetry"
	"go.uber.org/zap"

	chdbexporter "github.com/everr-labs/everr/collector/exporter/chdbexporter"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
	localconfig "github.com/everr-labs/everr/collector/internal/localgateway/config"
	"github.com/everr-labs/everr/collector/internal/localgateway/health"
	"github.com/everr-labs/everr/collector/internal/localgateway/sqlhttp"
)

const (
	defaultOTLPEndpoint   = "http://127.0.0.1:4318"
	defaultHealthEndpoint = "http://127.0.0.1:13133"
	defaultSQLEndpoint    = "http://127.0.0.1:8080"
	defaultChDBPath       = "./chdb"
	defaultTTL            = 7 * 24 * time.Hour
)

type options struct {
	OTLP     localconfig.Endpoint
	Health   localconfig.Endpoint
	SQL      localconfig.Endpoint
	ChDBPath string
	TTL      time.Duration
}

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "everr-local-collector: %v\n", err)
		os.Exit(1)
	}
}

func parseOptions(args []string) (options, error) {
	fs := flag.NewFlagSet("everr-local-collector", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	otlpEndpoint := fs.String("otlp-http-endpoint", defaultOTLPEndpoint, "OTLP HTTP endpoint apps send telemetry to")
	healthEndpoint := fs.String("health-http-endpoint", defaultHealthEndpoint, "HTTP readiness endpoint")
	sqlEndpoint := fs.String("sql-http-endpoint", defaultSQLEndpoint, "SQL HTTP endpoint")
	chdbPath := fs.String("chdb-path", defaultChDBPath, "chDB database path")
	ttl := defaultTTL
	fs.Var(ttlFlag{value: &ttl}, "ttl", "local telemetry TTL")

	if err := fs.Parse(args); err != nil {
		return options{}, err
	}

	otlp, err := localconfig.ParseEndpoint(*otlpEndpoint)
	if err != nil {
		return options{}, fmt.Errorf("otlp http endpoint: %w", err)
	}
	healthEndpointParsed, err := localconfig.ParseEndpoint(*healthEndpoint)
	if err != nil {
		return options{}, fmt.Errorf("health http endpoint: %w", err)
	}
	sql, err := localconfig.ParseEndpoint(*sqlEndpoint)
	if err != nil {
		return options{}, fmt.Errorf("sql http endpoint: %w", err)
	}
	if *chdbPath == "" {
		return options{}, fmt.Errorf("chdb path must be specified")
	}
	if ttl <= 0 {
		return options{}, fmt.Errorf("ttl must be greater than zero")
	}

	return options{
		OTLP:     otlp,
		Health:   healthEndpointParsed,
		SQL:      sql,
		ChDBPath: *chdbPath,
		TTL:      ttl,
	}, nil
}

type ttlFlag struct {
	value *time.Duration
}

func (f ttlFlag) Set(raw string) error {
	ttl, err := parseTTL(raw)
	if err != nil {
		return err
	}
	*f.value = ttl
	return nil
}

func (f ttlFlag) String() string {
	if f.value == nil {
		return ""
	}
	if *f.value%(24*time.Hour) == 0 {
		return fmt.Sprintf("%dd", *f.value/(24*time.Hour))
	}
	return f.value.String()
}

func parseTTL(raw string) (time.Duration, error) {
	if strings.HasSuffix(raw, "d") {
		days, err := strconv.Atoi(strings.TrimSuffix(raw, "d"))
		if err != nil {
			return 0, fmt.Errorf("parse ttl days: %w", err)
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}
	return time.ParseDuration(raw)
}

func run(ctx context.Context, args []string) error {
	opts, err := parseOptions(args)
	if err != nil {
		return err
	}

	logger, err := zap.NewProduction()
	if err != nil {
		return fmt.Errorf("create logger: %w", err)
	}
	defer func() { _ = logger.Sync() }()

	handle, err := chdb.Open(opts.ChDBPath)
	if err != nil {
		return fmt.Errorf("open chdb: %w", err)
	}
	defer func() { _ = handle.Close() }()

	healthServer := health.NewServer(opts.Health.ListenAddress)
	if err := healthServer.Start(); err != nil {
		return fmt.Errorf("start health server: %w", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = healthServer.Shutdown(shutdownCtx)
	}()

	sqlServer := sqlhttp.NewServer(sqlhttp.Config{Endpoint: opts.SQL.ListenAddress}, handle, logger)
	if err := sqlServer.Start(); err != nil {
		return fmt.Errorf("start sql http server: %w", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = sqlServer.Shutdown(shutdownCtx)
	}()

	collectorConfig := localconfig.BuildCollectorConfigMap(localconfig.CollectorConfig{
		OTLPListenAddress: opts.OTLP.ListenAddress,
		TTL:               opts.TTL,
	})
	collector, err := otelcol.NewCollector(collectorSettings(handle, collectorConfig))
	if err != nil {
		return fmt.Errorf("create collector: %w", err)
	}

	done := make(chan error, 1)
	go func() {
		done <- collector.Run(ctx)
	}()

	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case err := <-done:
			return err
		case <-ticker.C:
			if collector.GetState() == otelcol.StateRunning {
				healthServer.SetReady(true)
				return <-done
			}
		case <-ctx.Done():
			collector.Shutdown()
			err := <-done
			if err != nil {
				return err
			}
			return ctx.Err()
		}
	}
}

func collectorSettings(handle *chdb.Handle, rawConfig map[string]any) otelcol.CollectorSettings {
	staticProviderFactory := localconfig.NewStaticProviderFactory(rawConfig)
	return otelcol.CollectorSettings{
		BuildInfo: component.BuildInfo{
			Command:     "everr-local-collector",
			Description: "Local diagnostic collector gateway",
			Version:     "0.1.0",
		},
		Factories: collectorFactories(handle),
		ConfigProviderSettings: otelcol.ConfigProviderSettings{
			ResolverSettings: confmap.ResolverSettings{
				URIs:              []string{localconfig.StaticURI},
				DefaultScheme:     localconfig.StaticScheme,
				ProviderFactories: []confmap.ProviderFactory{staticProviderFactory},
			},
		},
		ProviderModules: map[string]string{
			localconfig.StaticScheme: "github.com/everr-labs/everr/collector/internal/localgateway/config v0.0.0",
		},
		ConverterModules: []string{},
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
			chdbexporter.NewFactory().Type(): "github.com/everr-labs/everr/collector/exporter/chdbexporter v0.152.0",
		})

		factories.Processors, err = otelcol.MakeFactoryMap[processor.Factory](
			batchprocessor.NewFactory(),
		)
		if err != nil {
			return otelcol.Factories{}, err
		}
		factories.ProcessorModules = makeModulesMap(factories.Processors, map[component.Type]string{
			batchprocessor.NewFactory().Type(): "go.opentelemetry.io/collector/processor/batchprocessor v0.152.0",
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
