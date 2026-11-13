// Package commandtelemetry records each CLI invocation as a root span plus
// invocation and result log events, exported as Everr's own product telemetry.
package commandtelemetry

import (
	"context"
	"errors"
	"maps"
	"net/http"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/spf13/cobra"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/log"
	logglobal "go.opentelemetry.io/otel/log/global"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/everr-labs/everr/packages/cli/internal/build"
	"github.com/everr-labs/everr/packages/cli/internal/cmdutil"
	"github.com/everr-labs/everr/packages/cli/internal/internaltelemetry"
)

const (
	serviceName     = "everr-cli"
	eventName       = "everr.cli.command"
	resultEventName = "everr.cli.command.result"
	// Instrumentation scope of the command events; the previous CLI used its
	// tracing target, which the exporter reported as the scope name.
	eventScope      = "everr_cli_command"
	shutdownTimeout = 750 * time.Millisecond
)

// Init configures the exporters and installs them as the global tracer and
// logger providers, with the W3C propagator so API requests made inside the
// command span carry its trace context. The returned function flushes and
// shuts them down; main calls it before exiting.
func Init() (shutdown func()) {
	config := internaltelemetry.FromEnv(internaltelemetry.SourceCLI)
	if config == nil {
		return func() {}
	}
	// Export failures are expected (no local collector, offline) and must
	// never reach the user's terminal.
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(error) {}))

	ctx := context.Background()
	res := newResource()
	client := &http.Client{
		Timeout: internaltelemetry.ExportTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	headers := map[string]string{}
	for name := range config.Headers {
		headers[name] = config.Headers.Get(name)
	}

	// Every option is set explicitly: options win over the OTEL_EXPORTER_OTLP_*
	// and OTEL_BSP_*/OTEL_BLRP_* variables, which belong to the customer's
	// applications, not to Everr.
	spanExporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL(config.SignalEndpoint("traces")),
		otlptracehttp.WithHeaders(maps.Clone(headers)),
		otlptracehttp.WithCompression(otlptracehttp.NoCompression),
		otlptracehttp.WithTimeout(internaltelemetry.ExportTimeout),
		otlptracehttp.WithRetry(otlptracehttp.RetryConfig{Enabled: false}),
		otlptracehttp.WithHTTPClient(client),
	)
	if err != nil {
		return func() {}
	}
	logExporter, err := otlploghttp.New(ctx,
		otlploghttp.WithEndpointURL(config.SignalEndpoint("logs")),
		otlploghttp.WithHeaders(maps.Clone(headers)),
		otlploghttp.WithCompression(otlploghttp.NoCompression),
		otlploghttp.WithTimeout(internaltelemetry.ExportTimeout),
		otlploghttp.WithRetry(otlploghttp.RetryConfig{Enabled: false}),
		otlploghttp.WithHTTPClient(client),
	)
	if err != nil {
		return func() {}
	}

	tracerProvider := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithBatcher(spanExporter,
			sdktrace.WithBatchTimeout(5*time.Second),
			sdktrace.WithMaxQueueSize(sdktrace.DefaultMaxQueueSize),
			sdktrace.WithMaxExportBatchSize(sdktrace.DefaultMaxExportBatchSize),
			sdktrace.WithExportTimeout(internaltelemetry.ExportTimeout),
		),
	)
	loggerProvider := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(logExporter,
			sdklog.WithMaxQueueSize(64),
			sdklog.WithExportMaxBatchSize(1),
			sdklog.WithExportInterval(time.Second),
			sdklog.WithExportTimeout(internaltelemetry.ExportTimeout),
		)),
	)
	otel.SetTracerProvider(tracerProvider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	logglobal.SetLoggerProvider(loggerProvider)

	return func() {
		ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		var wg sync.WaitGroup
		wg.Go(func() { _ = tracerProvider.Shutdown(ctx) })
		wg.Go(func() { _ = loggerProvider.Shutdown(ctx) })
		wg.Wait()
	}
}

// newResource deliberately skips resource detection from OTEL_RESOURCE_ATTRIBUTES
// and OTEL_SERVICE_NAME so customer attributes never land in Everr's telemetry.
func newResource() *resource.Resource {
	res, err := resource.New(context.Background(),
		resource.WithTelemetrySDK(),
		resource.WithAttributes(
			semconv.ServiceName(serviceName),
			semconv.ServiceVersion(build.Version()),
			semconv.DeploymentEnvironmentName(internaltelemetry.DeploymentEnvironment()),
		),
	)
	if err != nil {
		return resource.Empty()
	}
	return res
}

// Start opens the root span for cmd and records the invocation. finish records
// the command's result and ends the span. argv starts with the program name.
func Start(ctx context.Context, cmd *cobra.Command, argv []string) (_ context.Context, finish func(error)) {
	inv := newInvocation(cmd, argv)
	ctx, span := otel.Tracer(serviceName).Start(ctx, eventName, trace.WithAttributes(
		attribute.String("everr.cli.command", inv.command),
		attribute.String("everr.cli.subcommand", inv.subcommand),
		semconv.OSTypeKey.String(runtime.GOOS),
	))
	logger := logglobal.GetLoggerProvider().Logger(eventScope)

	attrs := []attribute.KeyValue{
		attribute.String("event.name", eventName),
		attribute.String("everr.cli.command", inv.command),
	}
	if inv.subcommand != "" {
		attrs = append(attrs, attribute.String("everr.cli.subcommand", inv.subcommand))
	}
	attrs = append(attrs,
		attribute.String("everr.cli.options", strings.Join(inv.options, ",")),
		attribute.String("os.type", runtime.GOOS),
	)
	emit(ctx, logger, log.SeverityInfo, eventName, attrs)

	return ctx, func(err error) {
		attrs := []attribute.KeyValue{
			attribute.String("event.name", resultEventName),
			attribute.String("everr.cli.command", inv.command),
			attribute.String("everr.cli.subcommand", inv.subcommand),
		}
		if failed(err) {
			span.SetStatus(codes.Error, "")
			attrs = append(attrs,
				attribute.String("everr.cli.status", "error"),
				attribute.String("error.message", internaltelemetry.CommandError(err)),
				attribute.String("os.type", runtime.GOOS),
			)
			emit(ctx, logger, log.SeverityError, resultEventName, attrs)
		} else {
			attrs = append(attrs,
				attribute.String("everr.cli.status", "ok"),
				attribute.String("os.type", runtime.GOOS),
			)
			emit(ctx, logger, log.SeverityInfo, resultEventName, attrs)
		}
		span.End()
	}
}

func failed(err error) bool {
	if err == nil {
		return false
	}
	if exit, ok := errors.AsType[*cmdutil.ExitError](err); ok && exit.Code == 0 {
		return false
	}
	return true
}

func emit(ctx context.Context, logger log.Logger, severity log.Severity, name string, attrs []attribute.KeyValue) {
	var record log.Record
	now := time.Now()
	record.SetTimestamp(now)
	record.SetObservedTimestamp(now)
	record.SetEventName(name)
	record.SetSeverity(severity)
	record.SetSeverityText(severityText(severity))
	record.SetBody(attribute.StringValue(name))
	record.AddAttributes(attrs...)
	logger.Emit(ctx, record)
}

func severityText(severity log.Severity) string {
	if severity >= log.SeverityError {
		return "ERROR"
	}
	return "INFO"
}

type invocation struct {
	command    string
	subcommand string
	options    []string
}

func newInvocation(cmd *cobra.Command, argv []string) invocation {
	var path []string
	for c := cmd; c != nil && c.HasParent(); c = c.Parent() {
		path = append([]string{c.Name()}, path...)
	}
	var inv invocation
	if len(path) > 0 {
		inv.command = path[0]
	}
	if len(path) > 1 {
		inv.subcommand = path[1]
	}
	// Everything after `wrap` belongs to the wrapped command and may hold
	// secrets, even without a `--` separator.
	if inv.command != "wrap" {
		inv.options = optionNames(argv)
	}
	return inv
}

// optionNames returns the sorted, de-duplicated option names in argv (which
// starts with the program name), never their values.
func optionNames(argv []string) []string {
	names := map[string]bool{}
	for _, arg := range argv[min(1, len(argv)):] {
		if !utf8.ValidString(arg) {
			continue
		}
		if arg == "--" {
			break
		}
		if long, ok := strings.CutPrefix(arg, "--"); ok {
			name, _, _ := strings.Cut(long, "=")
			if name != "" {
				names[name] = true
			}
			continue
		}
		if short, ok := strings.CutPrefix(arg, "-"); ok && short != "" && isASCIIAlpha(short) {
			for _, flag := range short {
				names[string(flag)] = true
			}
		}
	}
	return slices.Sorted(maps.Keys(names))
}

func isASCIIAlpha(s string) bool {
	for _, r := range s {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') {
			return false
		}
	}
	return true
}
