# AWS Lambda (Node.js)

Use this rule for a Node.js function on AWS Lambda. Read `nodejs.md` for exporters, resource meaning, and the exception record. This file is only what Lambda changes: the runtime freezes the process between invocations, it loads the handler after init, and a collector extension that fails to start fails every invocation before the handler.

The shape below was proven with `@opentelemetry/instrumentation-aws-lambda` 0.75, `@opentelemetry/instrumentation-aws-sdk` 0.78, and the OpenTelemetry collector Lambda layer. Re-read those packages' READMEs before copying a version number.

```text
trigger (S3, API Gateway, SQS, ...)
  Lambda, SDK started by a NODE_OPTIONS preload
    SERVER invocation span          instrumentation-aws-lambda
      CLIENT spans                  undici, AWS SDK (zip deploy only)
    flush traces, and logs via that same flush, to http://localhost:4318
  collector extension (layer)
    batch, then decouple
    export to https://ingest.everr.dev
```

Handlers stay plain exports. The invocation span comes from `@opentelemetry/instrumentation-aws-lambda`, which wraps the handler named by `_HANDLER`, loaded from `LAMBDA_TASK_ROOT`. That is why the SDK is a preload and not an import in the handler.

## When the SDK starts

Preload with `NODE_OPTIONS=--require /var/task/<preload>.js` (CommonJS) or the ESM `--import` equivalent. The preload runs before the handler module and before `@aws-sdk/*`.

The preload never throws. A throw fails Init, and every invocation fails before the handler. A broken setup costs the telemetry.

No OTLP endpoint means no SDK. `OTEL_SDK_DISABLED=true`, or all of these empty, leaves the function alone (unit tests, a stage without the collector layer):

- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`

An empty string is unset. Check the endpoint before requiring the SDK module, so a disabled function does not pay that cold start. Mark the process as started before the require, so a failed start is not retried into another throw.

```typescript
const STARTED = Symbol.for("app.lambda.telemetry");

export function startTelemetry(env: NodeJS.ProcessEnv = process.env): void {
  const g = globalThis as typeof globalThis & { [STARTED]?: boolean };
  if (g[STARTED]) return;
  g[STARTED] = true;
  if (env.OTEL_SDK_DISABLED === "true") return;
  const enabled = [
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
  ].some((name) => Boolean(env[name]));
  if (!enabled) return;
  // Lazy: the SDK is most of a cold start's telemetry cost.
  require("./telemetry-sdk").startSdk(env);
}
```

```typescript
try {
  startTelemetry();
} catch (err) {
  console.warn(
    `[telemetry] not started: ${err instanceof Error ? err.message : String(err)}`,
  );
}
```

The runtime reuses the process. Start once.

## What the function exports

The function exports OTLP/HTTP protobuf to the collector extension on `http://localhost:4318`. It does not hold the Everr ingest key. The extension does.

```json
"OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318",
"OPENTELEMETRY_COLLECTOR_CONFIG_URI": "/var/task/collector.yaml",
"OTEL_RESOURCE_ATTRIBUTES": "deployment.environment.name=<stage>",
"NODE_OPTIONS": "--require /var/task/<preload>.js"
```

Build the exporters with no URL so they read `OTEL_EXPORTER_OTLP_ENDPOINT` themselves. Set `timeoutMillis` to a few seconds (3000 worked). The flush runs inside billed time. A localhost POST answers in milliseconds. The exporter default of 10s per signal only delays the response when the collector is sick.

No metrics reader. Lambda already publishes invocations, errors, and duration, and a periodic reader does not survive the freeze.

## Resource

Merge `envDetector` last. `OTEL_RESOURCE_ATTRIBUTES` and `OTEL_SERVICE_NAME` then win over values set in code. Each stage sets `deployment.environment.name` there, so stages stay separable.

Resolve `service.name` with `resolve-values.md`, the same identity sibling services use. When the deployed function name already is that identity, `AWS_LAMBDA_FUNCTION_NAME` is the value. `OTEL_SERVICE_NAME` overrides it.

Also set, when the runtime provides them:

| Attribute | Source |
| --- | --- |
| `cloud.provider` | `aws` |
| `cloud.platform` | `aws_lambda` |
| `cloud.region` | `AWS_REGION` |
| `faas.name` | `AWS_LAMBDA_FUNCTION_NAME` |
| `faas.version` | `AWS_LAMBDA_FUNCTION_VERSION` (the published version, distinct from the release) |
| `faas.instance` | `AWS_LAMBDA_LOG_STREAM_NAME` |
| `faas.max_memory` | `AWS_LAMBDA_FUNCTION_MEMORY_SIZE`, in bytes |
| `service.version` | the deploy's version variable, else `package.json` at `LAMBDA_TASK_ROOT`. A bundle with no `package.json` leaves it unset |
| `service.instance.id` | a new id per cold start (`resources.md`) |

## Instrumentations

Register these. Add another only when the function actually imports that library.

| Instrumentation | Role |
| --- | --- |
| `@opentelemetry/instrumentation-aws-lambda` | One `SERVER` span per invocation, the FaaS attributes it can see, `faas.coldstart`, a thrown error recorded on that span, tracer provider flushed before the result returns |
| `@opentelemetry/instrumentation-undici` | `fetch`, including `traceparent`, so a downstream service joins the trace |
| `@opentelemetry/instrumentation-aws-sdk` with `suppressInternalInstrumentation: true` | S3, MediaConvert, and the other AWS calls |

AWS SDK v3 on `@smithy/core` needs `instrumentation-aws-sdk` >= 0.78. Older releases patch the SDK and produce no client spans. The 0.223 SDK line is the one that release belongs to (`instrumentation-aws-lambda` 0.75 beside it).

Require-time patching only sees modules loaded from `node_modules`. A bundle that inlines `@aws-sdk/*` produces no AWS client spans. Externalize those packages, or accept the gap and say so.

`@opentelemetry/auto-instrumentations-node` is the wrong default: filesystem and the other instrumentations add cold start, and the Lambda instrumentation is what owns the handler.

Outgoing HTTP picks up context from the undici instrumentation. Incoming context uses the extractor the Lambda instrumentation already has for that trigger (API Gateway, SNS, SQS). Set `eventContextExtractor` only for a trigger it does not extract. Read its README before writing one.

The exported handler rejects on failure. A wrapper that catches the error and returns a value leaves the invocation span unset, and the response hook never sees `err`.

## Flush before the freeze

The Lambda instrumentation calls `forceFlush` on the tracer provider before it returns the result. It does not flush the logger provider. An exception log left in a batch waits for the next invocation, or dies with the frozen environment.

Register a span processor whose `forceFlush` flushes the logger provider, so the exception record leaves with the traces. Process shutdown hooks do not run: the runtime freezes the process instead of exiting.

```typescript
export const flushLogsWithTraces = (loggerProvider): SpanProcessor => ({
  onStart() {},
  onEnd() {},
  forceFlush: () => loggerProvider.forceFlush(),
  shutdown: () => Promise.resolve(),
});
```

Processor order: redact (`onEnding`, below), then `BatchSpanProcessor`, then `flushLogsWithTraces`.

Prove it in a local run that never flushes on exit. The error log must still arrive, on the invocation span. The Error Path Gate in `validation.md` is the query.

## Errors

Read the `@everr/otel-errors` peer range for `@opentelemetry/api-logs` before choosing a path. Use `ErrorsInstrumentation` only when that range and `instrumentation-aws-sdk` (>= 0.78) resolve to one `api-logs`. As of `@everr/otel-errors` 0.2.0 the peer is `^0.218.0`. A caret on `0.x` does not cross the next minor, so 0.223 is outside it, and npm will not install both. Two copies of `api-logs` split the logger registry and the record disappears (`nodejs.md`).

Until the peer admits the Lambda line, emit the exception record by hand from the Lambda instrumentation's `responseHook`. One record per failed invocation, in the invocation span's context (`trace.setSpan`). This replaces the `ErrorsInstrumentation` registration in `nodejs.md` for this runtime. Delete the hook once the peer admits one shared `api-logs`, and register `ErrorsInstrumentation` instead.

Match the record `packages/otel-errors/src/client.ts` writes, which is what makes Everr store it as an exception:

- `eventName`: `exception`
- severity `ERROR`
- body: `Type: message`, or the type alone when there is no message
- attributes `exception.type`, `exception.message`, `exception.stacktrace` (omit the stack when there is none), `log.record.uid`
- structured `exception` (`name`, `message`, `stack`) set to those same values, so the SDK cannot refill them from the raw error

Follow `error.cause` to the depth `@everr/otel-errors` uses (5), prefixing each cause's stack with `[cause]`. A thrown non-Error is `exception.type` = `NonError`.

The Lambda instrumentation copies `err.message` onto the span status and the span exception event after the response hook. Rewrite those in a span processor `onEnding`: `status.message`, `exception.message`, `exception.stacktrace`. `onEnding` is experimental. Pin the SDK version that provides it.

Redact before export (`sensitive-data.md`). Cap the message and the stack: an HTTP error often carries the response body, and nothing else bounds it. 1000 and 8000 characters held that. A credential shape in the text is replaced first, including a masked key whose remaining characters are still the secret.

A manual child span marks where the work failed (`SpanStatusCode.ERROR`, short non-sensitive message) and rethrows. It does not emit a second exception log. The response hook records the failure once.

An early return that is not a failure sets one low-cardinality attribute on the active invocation span, `<product>.<operation>.skipped_reason`. The span stays unset. Do not wrap the handler to do this.

While instrumenting, remove any existing log that prints a secret or a payload (API key, transcript, prompt, response body).

## Expected misses

A probe that tries several keys and expects one of them to be missing is one span of yours. Run the calls under `suppressTracing` from `@opentelemetry/core`, so the AWS SDK instrumentation does not record the expected 404 as an `ERROR` child of a successful invocation. The span names what it found, with a low-cardinality attribute, and stays unset.

A lookup of a single known key stays traced. There a 404 is a real error.

## Domain attributes

The request hook adds what the invocation instrumentation cannot see. Prefer semantic conventions.

For an S3 `ObjectCreated` whose key layout the instrumentation does not describe:

- `faas.trigger` = `datasource`
- `faas.document.collection` = bucket
- `faas.document.operation` = `insert`
- `faas.document.name` = object key, only when the key is opaque ids. A key that carries names, emails, or free text stays off the span.
- `faas.document.time` = event time

Ids the rest of the system already exports go on the same span, under the prefix those services already use. Attributes Everr itself adds use the `everr.` prefix. Object contents, transcripts, prompts, and request bodies stay off the span.

A model call gets `gen_ai.provider.name` and `gen_ai.request.model`, plus sizes and language. Never the generated text.

## Collector extension

Attach the OpenTelemetry project's collector layer, architecture-matched: `opentelemetry-collector-amd64-*` for `x86_64`, the arm64 layer for `arm64`. Account `184161586896` publishes the layer. The ARN is regional. Copy the collector config into the deployment package at the path `OPENTELEMETRY_COLLECTOR_CONFIG_URI` names.

One config per AWS account when the accounts differ only by the ingest-key secret. Keep the files the same apart from that ARN. Reuse the key the account's other collectors already use. The function's environment does not receive it.

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: localhost:4318
processors:
  batch: {}
  decouple: {}
exporters:
  otlphttp:
    endpoint: https://ingest.everr.dev
    headers:
      Authorization: "Bearer ${secretsmanager:<ingest-key-secret-arn>}"
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, decouple]
      exporters: [otlphttp]
    logs:
      receivers: [otlp]
      processors: [batch, decouple]
      exporters: [otlphttp]
```

`decouple` is last. Without it the export to Everr happens inside the function's flush, before the collector answers the localhost POST. With it the collector answers at once and the extension holds the environment until the export finishes.

Declare `decouple` in the file. Collector layer 0.23.0 only installs its disable-queued-retry converter, so nothing adds `decouple` for you. Later layers add it only after a `batch` processor. Confirm the layer version you attach.

`batch` before `decouple` groups invocations into fewer exports. An invocation's data can reach Everr on a later invocation or at environment shutdown, minutes afterwards. What is still held when the environment dies without a clean shutdown (timeout, crash) is lost. The layer disables the exporter's sending queue and retries, so a failed export is dropped.

The extension reads the secret while it starts. A failed `GetSecretValue` (missing permission, missing secret, a KMS decrypt failure, throttling, an outage) is an error. The `:-default` syntax only covers an empty selector or a missing JSON field. The extension never becomes ready, Lambda fails Init, and every invocation fails before the handler. The preload's try/catch does not cover this. The extension is outside the process.

## Before the first deploy

Confirm, per account, before attaching the layer to any stage:

1. The execution role may `secretsmanager:GetSecretValue` on that account's ingest-key secret. A customer-managed KMS key also needs `kms:Decrypt`.
2. The function can reach `https://ingest.everr.dev` (443) and Secrets Manager. In a VPC that is a NAT gateway or a transit gateway on the default route. An internet gateway alone is not enough: the Lambda ENI has no public IP. A VPC endpoint covers Secrets Manager, not Everr.
3. The layer architecture matches the function, and the layer is readable. An SCP or a layer allow-list can still block the attach after a read succeeds. Confirm that with the account owner.
4. Deploy the lowest stage first. Production follows after that stage has run clean.

A Secrets Manager throttle or outage at a later cold start fails Init the same way. Reverting is removing the layer and the four environment variables, then redeploying. With no endpoint the code loads no SDK.

## Local proof

The collector layer runs only on AWS. Config resolution, the secret read, and the export to Everr are unproven until a real deploy. Locally, prove the function side.

Build the artifact the way CI builds it. Run it the way the runtime does: preload the register module through `NODE_OPTIONS`, and require the handler from `LAMBDA_TASK_ROOT` according to `_HANDLER`. Point `OTEL_EXPORTER_OTLP_ENDPOINT` at the `otlp:` URL from `everr local status`. There is no extension in this run, so `localhost:4318` is the wrong target. Drive one success and one downstream failure.

`everr local query`, by `ServiceName` and a marker on the run (`validation.md`):

- one `SERVER` invocation span per call, with `faas.coldstart` on the first, the trigger attributes, and the domain ids
- client spans for the AWS and HTTP calls, and the downstream service received `traceparent`
- the failure passes the Error Path Gate: invocation span `ERROR`, exactly one `ERROR` log with `exception.type`, `exception.message`, `exception.stacktrace`, on that same span
- the process exited without a flush of its own, and the log still arrived
- an expected-miss probe is one unset span and has no `ERROR` child for the miss
- no API key, transcript, prompt, or response body in any attribute or log body

Run the production build (or `tsc --noEmit` when that is the build). Dev transpilation skips the check.

## Common mistakes

| Mistake | What happens |
| --- | --- |
| Importing the SDK from the handler | The handler and the AWS SDK are already loaded. The wrapper and the patches never apply |
| Letting the preload throw | Init fails. Every invocation fails before the handler |
| Attaching the collector layer before the role can read the secret | Init fails the same way. The preload cannot catch it |
| Putting the ingest key in the function environment and exporting straight to Everr | The key is in the process, and the flush waits on the network inside billed time |
| Flushing only the tracer provider | The exception log stays in the batch and dies at the freeze |
| Installing `@everr/otel-errors` 0.2 beside the 0.223 line | npm duplicates `api-logs`. The record is emitted into the copy the SDK is not reading |
| Tracing an expected 404 | Every successful invocation carries an `ERROR` child |
| Bundling `@aws-sdk/*` | No AWS client spans |
| Adding a periodic metrics reader | It does not survive the freeze |
| Pointing a local run at `localhost:4318` | Nothing is listening. Use the `otlp:` URL from `everr local status` |
| Treating a clean local run as proof of the extension | The secret read and the export to Everr happen only on AWS |
