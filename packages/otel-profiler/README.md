# @everr/otel-profiler

Continuous profiling for Node.js, exported as OpenTelemetry profiles. It samples wall time, CPU time and the live heap, and sends one OTLP profiles request per window.

Wall and CPU samples taken inside a span link to that span, carry the time they were taken, and name the request they belong to (`http.route` and `everr.root_span.name`, from the span's local root). A trace can then show the code that ran during each span, and a route can show where its time goes.

Requires Node.js 24 or later: span links rely on `AsyncLocalStorage` being backed by AsyncContextFrame, the default from Node 24.

## Install

```bash
pnpm add @everr/otel-profiler @opentelemetry/api
```

## Use

```ts
import {
  ProfilingContextManager,
  ProfilingSpanProcessor,
  startProfiler,
} from "@everr/otel-profiler";
import { NodeSDK } from "@opentelemetry/sdk-node";

const resourceAttributes = { "service.name": "checkout-api" };

new NodeSDK({
  contextManager: new ProfilingContextManager(),
  spanProcessors: [new ProfilingSpanProcessor() /* , your exporting processor */],
  // ...
}).start();

const profiler = await startProfiler({ resourceAttributes });
// On shutdown: await profiler.shutdown();
```

- `ProfilingContextManager` tells the profiler which span is active. Without it, samples have no span link.
- `ProfilingSpanProcessor` tracks each span's local root, so samples get `http.route` and `everr.root_span.name`. Without it, samples still link to their span.

The profiles go to `<endpoint>/v1development/profiles`, with the same endpoint and headers as the other OTLP/HTTP signals. The collector must run with the `service.profilesSupport` feature gate (`--feature-gates=service.profilesSupport`) and have a profiles pipeline.

## Options

| Option                 | Default                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `endpoint`             | `OTEL_EXPORTER_OTLP_ENDPOINT`, then `http://localhost:4318`                                                           |
| `url`                  | `<endpoint>/v1development/profiles`                                                                                   |
| `headers`              | `OTEL_EXPORTER_OTLP_HEADERS`                                                                                          |
| `resourceAttributes`   | `service.name` from `OTEL_SERVICE_NAME`. Pass the SDK's resource attributes so profiles join other signals.           |
| `sourceRoot`           | `EVERR_PROFILER_SOURCE_ROOT`, then the nearest ancestor of the working directory with `.git` or `pnpm-workspace.yaml` |
| `sourceMapDirs`        | The entry script's directory                                                                                          |
| `exportIntervalMillis` | `15000`                                                                                                               |

File names under `sourceRoot` are sent relative to it, for example `packages/api/src/orders.ts`, so they line up with the `vcs.repository.url.full` and `vcs.ref.head.revision` resource attributes to build source links. In a container that copies only the build output, set `EVERR_PROFILER_SOURCE_ROOT` to the directory that stands for the repository root.

When source maps sit next to the entry script (a bundled or compiled server), frames are mapped back to the original sources.

## What it emits

One OTLP profile per sample type and window: `wall` and `cpu` (nanoseconds), `inuse_space` (bytes) and `inuse_objects` (count). Samples taken inside a span have:

- a link to the span (trace ID and span ID),
- a `timestamps_unix_nano` entry, the time the sample was taken,
- the attributes `http.route` (when the local root span has it) and `everr.root_span.name`.
