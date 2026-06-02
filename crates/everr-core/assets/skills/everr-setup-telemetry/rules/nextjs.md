# Next.js Instrumentation

Use this rule for Next.js 13+ App Router projects that need server-side
OpenTelemetry instrumentation.

This rule is intentionally server-only. Keep device-side instrumentation out of
this setup.

## Prerequisites

- Next.js 13+ with App Router.
- Route handlers or server actions run on the Node.js runtime.
- A local or production OTLP HTTP endpoint.
- OTLP endpoint and ingest-key variables available to the server process.

Use the project package manager. Typical server packages:

```bash
npm install @opentelemetry/api \
  @opentelemetry/api-logs \
  @opentelemetry/sdk-node \
  @opentelemetry/sdk-logs \
  @opentelemetry/sdk-metrics \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

## Environment

Keep the environment surface small. The setup code configures exporters,
processors, resource attributes, and shutdown behavior directly.

## Local Collector Configuration

Use this when the Next.js server exports to the local OTLP HTTP endpoint.

Resolve the endpoint from `everr local status`, then put the values in
`.env.local` or export them before starting the server:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=<otlp-url-from-status>
```

Use existing deployment variables for version and environment if the app already
has them. Do not add sampling or protocol variables just to enable local
signals.

## Production Configuration

Use this when the Next.js server exports to hosted ingest.

Set these in the deployment platform environment, not in source code:

```bash
EVERR_INGEST_KEY=<secret-manager-reference>
```

The setup code should derive the production endpoint and bearer header from the
ingest key. Keep release and environment metadata on existing deployment
variables such as `VERCEL_GIT_COMMIT_SHA`, `VERCEL_ENV`, or `NODE_ENV`.

Read environment variables inside `register()`, not at module evaluation time.
Next.js can load env files after modules are evaluated, so top-level reads can be
stale or undefined.

## File Placement

Place the entrypoint at the project root or inside `src`:

- `instrumentation.ts`
- `src/instrumentation.ts`

Do not place it under `app` or `pages`.

For manual OpenTelemetry SDK setup, keep Node-only imports behind the runtime
guard. The Node SDK is not compatible with the edge runtime.

```typescript
// src/instrumentation.ts
import type { Instrumentation } from 'next';

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  await import('./instrumentation.node');
}

export const onRequestError: Instrumentation.onRequestError = async (
  ...args
) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { onRequestError } = await import('./instrumentation.node');
  return onRequestError(...args);
};
```

## Node SDK Setup

Create `src/instrumentation.node.ts` for the actual OpenTelemetry setup:

```typescript
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import type { Instrumentation } from 'next';

declare global {
  var __otelSdk: NodeSDK | undefined;
  var __otelLoggerProvider: LoggerProvider | undefined;
}

function otlpEndpoint(signal: 'traces' | 'metrics' | 'logs') {
  const base =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    (process.env.EVERR_INGEST_KEY ? 'https://ingest.everr.dev' : undefined) ??
    'http://localhost:4318';
  return `${base.replace(/\/+$/, '')}/v1/${signal}`;
}

function otlpHeaders() {
  return process.env.EVERR_INGEST_KEY
    ? { Authorization: `Bearer ${process.env.EVERR_INGEST_KEY}` }
    : {};
}

function serviceResource() {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'nextjs-app',
    [ATTR_SERVICE_VERSION]:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      'unknown',
    'deployment.environment.name':
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV ??
      'development',
  });
}

async function shutdown(exitCode?: number) {
  const loggerProvider = globalThis.__otelLoggerProvider;
  const sdk = globalThis.__otelSdk;

  await loggerProvider?.forceFlush();
  await Promise.allSettled([
    sdk?.shutdown(),
    loggerProvider?.shutdown(),
  ]);

  if (exitCode !== undefined) process.exit(exitCode);
}

function emitProcessException(message: string, error: Error) {
  logs.getLogger('nextjs.process').emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: 'ERROR',
    body: message,
    attributes: {
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack,
    },
  });
}

function normalizeError(reason: unknown) {
  return reason instanceof Error ? reason : new Error(String(reason));
}

if (!globalThis.__otelSdk) {
  const resource = serviceResource();
  const headers = otlpHeaders();

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: otlpEndpoint('logs'),
          headers,
        }),
      ),
    ],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: otlpEndpoint('traces'),
      headers,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: otlpEndpoint('metrics'),
        headers,
      }),
      exportIntervalMillis: 10000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();
  globalThis.__otelSdk = sdk;
  globalThis.__otelLoggerProvider = loggerProvider;

  process.once('SIGTERM', () => void shutdown(0));
  process.once('SIGINT', () => void shutdown(0));
  process.once('uncaughtException', (error) => {
    emitProcessException('uncaught.exception', error);
    void shutdown(1);
  });
  process.once('unhandledRejection', (reason) => {
    emitProcessException('unhandled.rejection', normalizeError(reason));
    void shutdown(1);
  });
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  const span = trace.getActiveSpan();
  span?.recordException(error);
  span?.setStatus({
    code: SpanStatusCode.ERROR,
    message: `${error.name}: ${error.message}`,
  });

  const digest = (error as Error & { digest?: string }).digest;

  logs.getLogger('nextjs.request').emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: 'ERROR',
    body: 'nextjs.request.error',
    attributes: {
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack,
      ...(digest ? { 'exception.digest': digest } : {}),
      'http.request.method': request.method,
      'url.path': request.path,
      'next.router.kind': context.routerKind,
      'next.route.path': context.routePath,
      'next.route.type': context.routeType,
    },
  });

  await globalThis.__otelLoggerProvider?.forceFlush();
};
```

## Setup Notes

- Use `OTEL_EXPORTER_OTLP_ENDPOINT` only for local or custom gateway export.
- Use `EVERR_INGEST_KEY` for hosted ingest and build the bearer header in code.
  Do not hardcode secrets in `instrumentation.ts`.
- Use `resourceFromAttributes`, not `new Resource()`.
- Hardcode a stable `service.name` in the setup code, and set `service.version` and `deployment.environment.name` for
  every deployment. See [resources](./resources.md).
- Development hot reload can evaluate instrumentation more than once. Use an
  idempotent guard like `globalThis.__otelSdk`.
- Disable noisy auto-instrumentations only after confirming they create
  high-volume, low-value data in this project.

## Route Handler Enrichment

Next.js creates many framework spans automatically. Add application context to
the active span instead of creating a redundant child span just to hold
attributes.

```typescript
import { trace } from '@opentelemetry/api';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const span = trace.getActiveSpan();
  span?.setAttribute('http.route', '/api/orders');
  span?.setAttribute('feature_flag.key', 'checkout-flow');
  span?.setAttribute('order.lookup.source', 'route-handler');

  // handler logic
}
```

Use optional chaining because `trace.getActiveSpan()` can return `undefined`.

## Error Handling

Use both process-level handlers and Next.js `onRequestError`:

- `uncaughtException` and `unhandledRejection` capture process failures.
- `onRequestError` captures server request failures that Next.js handles before
  they reach process-level handlers.
- Route handlers and server actions that catch errors must emit an exception log
  before returning an error response.

For final failures:

- Set the active span status to `ERROR` with a short message.
- Emit an OTel log at error severity or higher.
- Use `exception.type`, `exception.message`, and `exception.stacktrace`.
- Keep the stacktrace in the log attribute, not in the span status message.
- Preserve framework semantics: rethrow, return the intended error response, or
  let Next.js handle the failure exactly as before.

See [error tracking](./error-tracking.md) and [spans](./spans.md).

## Metrics

Create instruments once at module scope, then record values inside handlers.
Keep attributes low-cardinality and follow [metrics](./metrics.md).

```typescript
import { getMeter } from '@/lib/telemetry';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const meter = getMeter();
const requestCounter = meter.createCounter('checkout.requests', {
  description: 'Checkout requests',
  unit: '{request}',
});
const requestDuration = meter.createHistogram('checkout.request.duration', {
  description: 'Checkout request duration',
  unit: 'ms',
});

export async function POST(request: NextRequest) {
  const start = performance.now();
  const attributes = {
    'http.request.method': 'POST',
    'http.route': '/api/checkout',
  };

  try {
    requestCounter.add(1, { ...attributes, outcome: 'accepted' });
    return NextResponse.json({ ok: true });
  } finally {
    requestDuration.record(performance.now() - start, attributes);
  }
}
```

Do not attach user IDs, session IDs, raw paths, raw query strings, email
addresses, tokens, exception messages, or stacktraces to metric attributes.

## Validation

After setup:

1. Start the app with a local OTLP endpoint.
2. Hit a route handler that should produce telemetry.
3. Verify a server span exists for the route under `service.name`.
4. Verify an exception path emits an error-severity log with
   `exception.type`, `exception.message`, and `exception.stacktrace`.
5. Verify the error log has `TraceId` and `SpanId` when it happens inside an
   active span.
6. Verify metrics arrive with units and low-cardinality attributes.
7. Stop the process and confirm shutdown flushes traces, logs, and metrics.

## References

- Next.js instrumentation file convention:
  https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
- Next.js OpenTelemetry guide:
  https://nextjs.org/docs/app/guides/open-telemetry
- OpenTelemetry JavaScript instrumentation:
  https://opentelemetry.io/docs/languages/js/instrumentation/
- OpenTelemetry JavaScript exporters:
  https://opentelemetry.io/docs/languages/js/exporters/
