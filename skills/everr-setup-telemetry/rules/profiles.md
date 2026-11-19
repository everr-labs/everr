# Profiles

Use this rule to add continuous profiling to a service. Everr ingests OTLP profiles, an experimental OpenTelemetry signal, at `<endpoint>/v1development/profiles` on the same OTLP/HTTP endpoint and with the same `Authorization: Bearer <ingest-key>` as traces, logs, and metrics. Profiles land in the `profiles` table, one row per sample.

OpenTelemetry has no profiles SDK for most languages yet, so each runtime below uses a small in-process profiler that converts pprof to OTLP. eBPF profiling is not covered here.

## Go

Use `github.com/everr-labs/everr/sdk/go/profiler`. Every interval (15s by default) it posts:

- a CPU profile: `cpu`/`nanoseconds` and `samples`/`count`.
- a heap profile: `inuse_space`/`bytes` and `inuse_objects`/`count`, snapshots of live memory as of the last GC, plus `alloc_space`/`bytes` and `alloc_objects`/`count`, what was allocated during the interval (not since process start).

Goroutine labels set with `pprof.Do` or `pprof.SetGoroutineLabels` become sample attributes, readable as `SampleAttributes['<label>']`. Keep their values low cardinality and free of user data.

```bash
go get github.com/everr-labs/everr/sdk/go/profiler
```

Start it at the top of `main`, next to the tracer provider, and stop it on shutdown so the last interval is exported:

```go
import "github.com/everr-labs/everr/sdk/go/profiler"

prof, err := profiler.Start(profiler.Config{
	ServiceName: "checkout-api",
	ResourceAttributes: map[string]string{
		"deployment.environment.name": env,
		"service.version":             version,
	},
})
if err != nil {
	log.Printf("profiling disabled: %v", err)
} else {
	defer prof.Stop(context.Background())
}

// Links CPU samples to the span that was running when they were taken.
otel.SetTracerProvider(profiler.TracerProvider(tracerProvider))
```

Unset `Config` fields fall back to the standard variables: `OTEL_EXPORTER_OTLP_ENDPOINT` (the profiler appends `/v1development/profiles`), or `OTEL_EXPORTER_OTLP_PROFILES_ENDPOINT` for the full URL; `OTEL_EXPORTER_OTLP_HEADERS` (for example `Authorization=Bearer%20<ingest-key>`); `OTEL_SERVICE_NAME`; and `OTEL_RESOURCE_ATTRIBUTES`. Use the same endpoint and key as the service's other OTLP exporters. `Start` returns an error when no endpoint is configured, so a local run without telemetry stays quiet.

Span links:

- `profiler.TracerProvider` labels the goroutine with `trace_id` and `span_id` while a sampled span is active. Goroutines started inside the span inherit the labels. The profiler turns them into the sample's `TraceId` and `SpanId`.
- Call `span.End()` on the goroutine that started the span (the usual `defer span.End()`), since it restores the goroutine's previous labels.
- Heap samples are never linked: Go records no labels on allocations.

Notes:

- Go allows one CPU profile per process. While something else holds it, such as a `/debug/pprof/profile` request, that interval has no CPU profile and the next one retries.
- Export errors go to the OpenTelemetry error handler (`otel.SetErrorHandler`), which logs them by default.

Validate with the service's time window and name:

```sql
SELECT SampleType, SampleUnit, uniqExact(ProfileId) AS profiles, count() AS samples, countIf(TraceId != '') AS linked
FROM profiles
WHERE Timestamp > now() - INTERVAL 15 MINUTE AND ServiceName = '<service>'
GROUP BY SampleType, SampleUnit
LIMIT 20
```

Expect `cpu`, `samples`, `inuse_space`, `inuse_objects`, `alloc_space`, and `alloc_objects`, with `linked` above zero for `cpu` when traffic ran inside spans.

## Node.js

Use `@everr/otel-profiler` (Node.js 24 or later). Every interval (15s by default) it posts:

- a wall profile: `wall`/`nanoseconds`, time spent in each stack whether running or waiting.
- a CPU profile: `cpu`/`nanoseconds`.
- a heap profile: `inuse_space`/`bytes` and `inuse_objects`/`count`, snapshots of live memory.

```bash
npm install @everr/otel-profiler
```

Add it to the existing setup module (see [Node.js](nodejs.md)), next to the `NodeSDK`, and shut it down with the SDK so the last interval is exported:

```typescript
import {
  ProfilingContextManager,
  ProfilingSpanProcessor,
  startProfiler,
} from "@everr/otel-profiler";

const resourceAttributes = {
  "service.name": SERVICE_NAME,
  // ...the same attributes as the SDK resource
};

const sdk = new NodeSDK({
  resource: resourceFromAttributes(resourceAttributes),
  // Links wall and CPU samples to the span that was active when they were taken.
  contextManager: new ProfilingContextManager(),
  spanProcessors: [
    // Labels samples with the request's http.route and root span name.
    new ProfilingSpanProcessor(),
    new BatchSpanProcessor(/* ... */),
  ],
  // ...
});
sdk.start();

// Resolves once source maps are loaded; profiling starts then.
const profiler = startProfiler({
  endpoint, // the same base endpoint as the other exporters, without /v1/<signal>
  headers: config.headers,
  resourceAttributes,
});

// On shutdown, next to sdk.shutdown():
await profiler.then((p) => p.shutdown());
```

The profiler posts to `<endpoint>/v1development/profiles`. Unset options fall back to `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, and `OTEL_SERVICE_NAME`. Pass the SDK's resource attributes so profiles join the service's other signals. If the service exports through its own OpenTelemetry Collector rather than straight to Everr, run that collector with `--feature-gates=service.profilesSupport` and add a `profiles` pipeline, or every export fails (the profiler logs the first failure once).

What a sample inside a span carries:

- `TraceId` and `SpanId` of the active span.
- One `TimestampsUnixNano` entry, the time the sample was taken, so a span's samples can be laid out on a timeline.
- `SampleAttributes['http.route']` when the local root span has `http.route` (set by the HTTP or framework instrumentation, even after the span started), and `SampleAttributes['everr.root_span.name']`.

Source links:

- File names under the repository root are sent relative to it, for example `packages/api/src/orders.ts`. The root is the nearest ancestor of the working directory with `.git` or `pnpm-workspace.yaml`; override it with the `sourceRoot` option or `EVERR_PROFILER_SOURCE_ROOT`. In a container image that copies only build output, set `EVERR_PROFILER_SOURCE_ROOT` to the directory that stands for the repository root, and keep the output at its repository-relative path so source maps resolve there.
- Source maps next to the entry script are applied, so bundled or compiled servers report TypeScript sources. Ship the `.map` files in the image.
- Set the resource attributes `vcs.repository.url.full` (for example `https://github.com/acme/shop`) and `vcs.ref.head.revision` (the commit SHA) from the CI or platform variables (`GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_SHA`, `VERCEL_GIT_REPO_OWNER`/`VERCEL_GIT_REPO_SLUG`/`VERCEL_GIT_COMMIT_SHA`). A Docker image needs them passed as build arguments, since those variables do not exist at runtime.

Event loop and GC: `getNodeAutoInstrumentations()` includes `@opentelemetry/instrumentation-runtime-node`, which records `nodejs.eventloop.delay.*`, `nodejs.eventloop.utilization`, and `v8js.gc.duration`. Keep it enabled next to the profiler: these metrics explain wall time that no stack accounts for.

Validate with the service's time window and name:

```sql
SELECT SampleType, count() AS samples, countIf(TraceId != '') AS linked,
       countIf(SampleAttributes['everr.root_span.name'] != '') AS with_root,
       countIf(length(TimestampsUnixNano) > 0) AS timed
FROM profiles
WHERE Timestamp > now() - INTERVAL 15 MINUTE AND ServiceName = '<service>'
GROUP BY SampleType
LIMIT 20
```

Expect `wall`, `cpu`, `inuse_space`, and `inuse_objects`, with `linked`, `with_root`, and `timed` above zero for `wall` when traffic ran inside spans.

Other runtimes that can produce pprof, such as Pyroscope or Datadog profilers for Python, Ruby, or Java, are not supported yet: their output needs converting to OTLP first.
