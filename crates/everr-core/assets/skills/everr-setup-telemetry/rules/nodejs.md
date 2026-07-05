# Node.js Instrumentation

Use this rule for Node.js services, CLIs, workers, background jobs, and test runners.

## Default Pattern

- Follow the framework's OpenTelemetry guidance before writing generic custom instrumentation. Read either the framework docs or the relevant OpenTelemetry contrib package README for the exact framework, version, runtime, startup hook, and error hook being used.
- MUST use the framework's telemetry module entrypoint when it has one. Otherwise, keep a custom `telemetry-setup.ts` module and load it before application imports with `--register` or the runtime equivalent, such as `NODE_OPTIONS`, CommonJS `--require`, ESM `--import`, a process-manager preload flag, or a test-runner setup file.
- Start with `@opentelemetry/sdk-node` and `@opentelemetry/auto-instrumentations-node`.
- Configure exporters in code so the environment stays small and the app can set redaction, resource attributes, metric readers, log processors, and shutdown behavior explicitly.
- Load telemetry before importing HTTP, framework, database, queue, AWS SDK, GraphQL, gRPC, logger, or job-runner modules.
- Export to OTLP over HTTP for Everr local and hosted ingest unless project constraints require a different protocol.
- Prefer framework-native OpenTelemetry support or OpenTelemetry contrib instrumentation for common libraries, then add manual spans only for work the library instrumentation cannot see.
- Use `@everr/auto-otel-errors/node` for error capture: call `init()` after `sdk.start()`. Do not hand-roll process error handlers or exception logging.

## Framework-Specific OpenTelemetry First

Do not treat the generic Node.js setup as a substitute for framework-specific
OpenTelemetry best practices. Before editing instrumentation:

1. Identify the framework and runtime path: Express, Fastify, Koa, Hapi, Hono,
   NestJS, Next.js, Tanstack Start, Remix, GraphQL/Apollo, NuxtJS, Solid Start, SvelteKit, serverless functions, job workers, or
   test runners.
2. Check current OpenTelemetry contrib docs or the framework's own docs for:
   supported versions, required preload or registration order, native OTel
   helpers, request lifecycle hooks, error hooks, route naming, context
   propagation, and known noisy instrumentations.
3. Use the framework-recommended OTel entrypoint when it exists. For example,
   Next.js uses `instrumentation.ts` and `onRequestError`, while plain Node
   services usually need a custom setup module loaded through `--register` or
   an equivalent preload/import hook.
4. If the framework docs show examples for a proprietary monitoring SDK,
   translate the same hook into OpenTelemetry APIs and OTLP export. Do not add a
   proprietary SDK just to follow an example shape.
5. Preserve framework semantics. Instrumentation must not change request
   handling, retries, response generation, error boundaries, or crash behavior.

Use this precedence order:

- Framework-native OpenTelemetry support.
- OpenTelemetry contrib instrumentation for the specific framework/library.
- Framework lifecycle or error hooks that emit OTel spans, logs, or metrics.
- Custom spans only for gaps the framework/library instrumentation cannot see.

## Packages

Follow the package manager already used by the project. For a complete traces, logs, and metrics setup, plus `@everr/auto-otel-errors` for error capture:

```bash
npm install @everr/auto-otel-errors @opentelemetry/api @opentelemetry/api-logs @opentelemetry/sdk-node @opentelemetry/sdk-trace-node @opentelemetry/sdk-metrics @opentelemetry/sdk-logs @opentelemetry/resources @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-proto @opentelemetry/exporter-metrics-otlp-proto @opentelemetry/exporter-logs-otlp-proto
```

If the app only needs traces at first, install the SDK, auto-instrumentations, resources, trace SDK, and trace exporter. Add metrics and logs packages when those signals are part of the task.

## Env vars

Local development or test:

```bash
# Optional: override the hardcoded default collector endpoint.
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:54318
```

Production Everr ingest:

```bash
EVERR_INGEST_KEY=<secret-manager-reference>
```

Hardcode a stable `service.name` in the setup module. Use existing deployment variables for `service.version` and `deployment.environment.name` if the app already has them. Do not add a large OTel env block just to enable signals; code should select the trace, metric, and log exporters.

## Setup Module

Adapt this pattern rather than copying it blindly. Resolve the service name and deployment metadata from the project first with `resolve-values.md`.

Keep the setup in a custom module. Prefer wiring each runtime entrypoint to
preload or register this module instead of relying on every application
entrypoint to remember a side-effect import, unless the framework guide suggests otherwise.

Latest Node.js versions support .ts files, stick with them if possible.

```typescript
// src/telemetry-setup.ts
import { init as initErrorTracking } from "@everr/auto-otel-errors/node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";

const stateKey = Symbol.for("app.telemetry.sdk");
const SERVICE_NAME = "app-service";
const DEFAULT_COLLECTOR_ENDPOINT = "http://127.0.0.1:54318";

const globalState = globalThis as typeof globalThis & {
  [stateKey]?: { sdk: NodeSDK };
};

if (!globalState[stateKey]) {
  globalState[stateKey] = startTelemetry();
}

function startTelemetry() {
  const config = resolveTelemetryConfig(process.env);
  const endpoint = normalizeBaseEndpoint(config.endpoint);
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": config.serviceName,
      ...(config.serviceVersion ? { "service.version": config.serviceVersion } : {}),
      ...(config.deploymentEnvironment
        ? { "deployment.environment.name": config.deploymentEnvironment }
        : {}),
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: signalUrl(endpoint, "traces"),
          headers: config.headers,
        }),
      ),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: signalUrl(endpoint, "metrics"),
          headers: config.headers,
        }),
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: signalUrl(endpoint, "logs"),
          headers: config.headers,
        }),
      ),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Error capture: install after sdk.start() so the global providers are live.
  // It owns the uncaughtException/unhandledRejection handlers (flush, then exit),
  // active-span ERROR marking, rate limiting, and redaction. Pass
  // { onFatal: 'continue' } to capture without exiting on a fatal error.
  initErrorTracking();
  installShutdownHandlers(sdk);

  return { sdk };
}

function resolveTelemetryConfig(env: NodeJS.ProcessEnv) {
  const endpoint =
    env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    (env.EVERR_INGEST_KEY ? "https://ingest.everr.dev" : DEFAULT_COLLECTOR_ENDPOINT);

  return {
    endpoint,
    serviceName: SERVICE_NAME,
    serviceVersion: env.SERVICE_VERSION,
    deploymentEnvironment: env.DEPLOYMENT_ENVIRONMENT || env.NODE_ENV,
    headers: env.EVERR_INGEST_KEY ? { Authorization: `Bearer ${env.EVERR_INGEST_KEY}` } : undefined,
  };
}

function normalizeBaseEndpoint(endpoint: string) {
  return endpoint.replace(/\/+$/, "");
}

function signalUrl(endpoint: string, signal: "traces" | "metrics" | "logs") {
  if (endpoint.endsWith(`/v1/${signal}`)) {
    return endpoint;
  }

  return `${endpoint}/v1/${signal}`;
}

function installShutdownHandlers(sdk: NodeSDK) {
  let shuttingDown = false;

  async function shutdown() {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await sdk.shutdown();
  }

  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
}
```

`@everr/auto-otel-errors` owns crash handling, so there is no `installFatalErrorHandlers` here — the library installs the `uncaughtException`/`unhandledRejection` handlers, flushes, and exits.

If the app has a singleton/hot-reload pattern already, use that pattern instead of the `Symbol.for` guard.

## Auto-Instrumentation Coverage

Node auto-instrumentation can cover common HTTP servers and clients, Express, Fastify, Koa, Hapi, GraphQL, gRPC, DNS, databases, Redis, message queues, AWS SDK, pino, winston, bunyan, and other libraries. Check the installed packages before writing custom spans.

Read the relevant instrumentation README before changing options. Many framework
instrumentations have their own hooks for route naming, request attributes, or
ignore rules; use those instead of wrapping handlers manually.

Disable instrumentation that is too noisy for the task, such as filesystem spans in many web apps. Use built-in instrumentation options to sanitize or disable unsafe capture when available.

Add manual spans for:

- Cron jobs and scheduled tasks.
- CLI commands.
- Background workers and queue consumers.
- Batch processors.
- Startup tasks.
- Domain operations not visible to library instrumentation.

## Custom Spans

Use low-cardinality span names. Prefer operation names and route templates over IDs or free-form values.

```typescript
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { captureError } from "@everr/auto-otel-errors/node";

const tracer = trace.getTracer("checkout-worker");

await tracer.startActiveSpan("invoice.send", async (span) => {
  try {
    span.setAttributes({
      "invoice.batch_size": invoices.length,
      "messaging.destination.name": "billing-email",
    });

    await sendInvoices(invoices);
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    captureError(error, {
      "error.handled": true,
      "error.source": "invoice.send",
    });
    throw error;
  } finally {
    span.end();
  }
});
```

Do not add IDs, emails, tokens, full URLs with query strings, raw SQL parameter values, or request bodies as span attributes.

## Trace Context

Use the active context instead of passing trace IDs manually through application code when possible.

For incoming requests, rely on HTTP or framework instrumentation to extract context. For queues, jobs, or custom protocols, inject and extract W3C trace context explicitly at enqueue and dequeue boundaries.

## Error Tracking

Error capture is `@everr/auto-otel-errors/node`, wired in the setup module above with `init()` after `sdk.start()`. This is the path for Node — do not hand-roll `process.on('uncaughtException')`, `unhandledRejection`, `console` patches, or per-call exception logging.

- It installs the `uncaughtException`/`unhandledRejection` handlers (flush, then exit; pass `onFatal: 'continue'` to capture without exiting), marks the active span `ERROR`, and applies rate limiting and redaction.
- Use `captureError(error, attributes)` in catch blocks for manual capture (see Custom Spans above).
- Framework adapters: `@everr/auto-otel-errors/express` (`errorHandler()` as the last middleware) and `@everr/auto-otel-errors/fastify` (`errorTrackingPlugin`).

See `error-tracking.md` for options (`onFatal`, `rateLimit`, `scrubPatterns`, `beforeSend`).

## Troubleshooting

| Symptom                       | Check                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| No traces                     | Setup import order, trace exporter URL, HTTP instrumentation enabled                                                                             |
| No metrics                    | `metricReaders` configured, metric exporter URL, process has lived long enough to export                                                         |
| No logs                       | Log provider configured, logger integration or targeted OTel logs are actually used                                                              |
| Endpoint errors               | `everr local status` endpoint, base vs per-signal URL, protocol, production key presence                                                         |
| `unknown_service`             | Hardcoded `service.name` missing from the resource config or setup module not loaded                                                             |
| Duplicate spans               | Setup module loaded more than once, both manual and auto spans wrapping the same operation                                                       |
| High cardinality              | Span names or metric/log attributes contain IDs, paths, queries, or raw messages                                                                 |
| Missing DB spans              | Database module imported before setup or unsupported driver version                                                                              |
| Missing trace-log correlation | Logger helper not reading active context or logs emitted outside active spans                                                                    |
| Each error captured twice     | `@everr/auto-otel-errors` running alongside leftover hand-rolled `uncaughtException`/`unhandledRejection` handlers — remove the hand-rolled ones |

After changes, run the instrumented path and validate with `everr local query`. Filter by `ServiceName`, a recent time window, and a run/request/test marker when practical.
