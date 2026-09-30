# @everr/otel-errors

## 0.2.0

### Minor Changes

- 99c4eb4: Unhandled rejections no longer stop the process by default. The new `onUnhandledRejection` option defaults to `"warn"`: the rejection is written to stderr, captured with `ERROR` severity, and the process keeps running, as with Sentry. Pass `onUnhandledRejection: "strict"` to keep the previous behavior (captured as `FATAL`, flushed, then the process exits).

### Patch Changes

- 5da5dff: Detect the app's own `unhandledRejection` listener under Next.js. Next.js keeps these listeners in a private queue behind one filter listener and shows them only through `process.listeners`, so the check with `process.listenerCount` saw no other listener and exited the process.
- 726e757: Install no crash handlers in a worker thread. The handler's `process.exit(1)` ended the worker without the parent's `error` event, so a pool that restarts or retries on that event did not see the crash.

## 0.1.0

### Minor Changes

- adfe27a: Renamed from `@everr/auto-otel-errors`, and reduced to the Node runtime.

  `init()` is gone. The package now exports an OpenTelemetry instrumentation, registered with the SDK like any other:

  ```ts
  new NodeSDK({ instrumentations: [new ErrorsInstrumentation()] });
  ```

  The SDK injects its own `LoggerProvider`, so the package no longer reads the `logs` global to emit, and a fatal error now flushes logs, spans, and metrics (previously logs only) before exiting.

  Removed: the `browser`, `express`, `fastify`, and `react` entries. Browser error capture lives in `@everr/otel-web`, which owns the `window` handlers, the React error boundary, and its own capture path.

  Added: a `./core` entry with the runtime-neutral capture path (`Client`, normalization, redaction, rate limiting) for SDKs that drive it themselves.

  `Client` takes only options now: the `runtime` and `integrations` parameters are gone, and it always marks the active span. The `Mechanism` type accepts any string so a consuming SDK can report its own vocabulary.

  The OTel instrumentation scope on every emitted record changes from `@everr/auto-otel-errors` to `@everr/otel-errors`. Queries filtering on the old scope name return no rows after upgrading.

The entries below 0.1.0 belong to `@everr/auto-otel-errors`, this package's
former name, which is deprecated on npm. Its version line reached 0.2.3; 0.1.0
restarts numbering because the rename also dropped the browser and framework
entries and replaced `init()` with an OpenTelemetry instrumentation. There is
no in-place upgrade between the two lines.

## 0.2.3

### Patch Changes

- 28e8199: Retry release with NPM_TOKEN authentication.

## 0.2.2

### Patch Changes

- 6b94d92: Retry release with NPM_TOKEN authentication.

## 0.2.1

### Patch Changes

- 34d39ac: Fix npm package publishing to use trusted publishing.

## 0.2.0

### Minor Changes

- 34e86aa: Rename sensitive data configuration options from `scrubKeys` and `scrubPatterns` to `redactKeys` and `redactPatterns`, and preserve attributes when key-based redaction is disabled.
