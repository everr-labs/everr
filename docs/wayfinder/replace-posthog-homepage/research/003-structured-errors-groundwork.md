# 003: Structured errors groundwork

**Answer first:** The evlog article proposes a rich, typed error object (message, code, status, why, fix, link, cause, internal) with stable machine-readable codes as the grouping key. Everr already has most of the capture and grouping pipeline in production: `@everr/auto-otel-errors` captures browser and Node errors as OTel exception log events, the web app ships browser errors to Everr via a public ingest key (the `web-error-tracking` worktree branch is fully merged into main), and grouping happens in ClickHouse via a shared `errorFingerprint` UDF that honors an explicit `error.fingerprint` attribute and otherwise hashes service + type + normalized message. What does NOT exist yet: an error code convention (evlog's `code` field), structured context fields beyond free-form OTel attributes, and any source map handling (stack traces are stored and displayed minified for production browser bundles).

## Part 1: What evlog proposes for structured errors

Source: https://www.evlog.dev/learn/structured-errors

**Error shape.** A rich error object with these fields:

- `message` (required): what happened, shown to users
- `code`: machine-readable identifier for client branching (e.g. `PAYMENT_DECLINED`, `auth/invalid-token`)
- `status`: HTTP status code, defaults to 500
- `why`: technical reason, for debugging
- `fix`: actionable solution for users
- `link`: documentation URL
- `cause`: original error, for chaining
- `internal`: backend-only context, excluded from HTTP responses

**Error codes.** Codes should be stable, machine-readable identifiers that clients branch on instead of parsing user-facing messages. Supported conventions:

- Prefixed catalogs in `${prefix}.${KEY}` format (e.g. `billing.PAYMENT_DECLINED`), built with `defineErrorCatalog()` to bundle related errors under a shared prefix
- Standalone custom codes following your own naming scheme
- Node-style system codes (e.g. `ENOENT`) flowing through the same branching logic

**Context fields.** The design splits user-facing context (`message`, `fix`, `why`) from backend-only data in `internal`, so sensitive details never leak to clients but stay available for logging and support tooling.

**Grouping.** Group by `code`, not by free-text message. The `code` surfaces on wide events so dashboards and drains can group, alert, and chart by code. Catalogs keep codes consistent across the application as the error surface grows.

## Part 2: What exists locally

### 2a. `@everr/auto-otel-errors` (published SDK, v0.2.3)

Path: `/Users/guidodorsi/workspace/everr/packages/auto-otel-errors` (README.md, package.json, src/).

A transport-less error capture SDK that emits through the global OTel API registries. If the host app has no global `LoggerProvider`, capture is a no-op. Entry points: `.` (node/browser conditional), `./node`, `./browser`, `./express`, `./fastify`, `./react`.

**Capture hooks** (`src/types.ts` `Mechanism` union, `src/integrations/`):

- Node: `uncaughtException` and `unhandledRejection` global handlers; fatal errors flush the log provider then exit 1 unless `onFatal: "continue"` (`src/integrations/node-globals.ts`)
- Browser: `window` `error` and `unhandledrejection` handlers by default (`src/integrations/browser-globals.ts`); optional `browserApiErrorsIntegration` wraps `setTimeout`/`setInterval`/`requestAnimationFrame`/`addEventListener` to catch third-party script errors with real stacks (off by default because it patches globals)
- Frameworks: Express `errorHandler()`, Fastify `errorTrackingPlugin`, React `ErrorBoundary` / `captureReactError`
- Manual: `captureError(error, attributes?, { handled? })` (`src/core.ts`)

**Event shape** (`src/client.ts`): each capture emits one OTel log record with `eventName` (`exception`, or `http.server.request.exception` for Express/Fastify), severity, `body` (type: message), and attributes `exception.type`, `exception.message`, optional `exception.stacktrace`, `everr.error.handled`, `everr.error.mechanism`, `log.record.uid` (random UUID per event). Framework integrations add `http.request.method`, `http.route`, `url.full` (query/fragment stripped), `url.path`. On Node an active span also gets `recordException` plus `ERROR` status.

**Pipeline features:** `beforeSend` mutate/drop hook; two-layer redaction (key denylist plus value regexes for tokens, emails, cards); per-error-key rate limiting (default 5 per 5s, keyed on `type|message|topFrame`); duplicate suppression via a `WeakSet` of captured error objects; cause and `AggregateError` chains rendered into the stack text up to depth 5 (`src/normalize.ts`).

**Not present:** no error `code` concept, no client-side fingerprint computation (though the `error.fingerprint` attribute is honored downstream), no source map support.

### 2b. Worktree `.claude/worktrees/web-error-tracking`

Branch `gio/web-app-prod-telemetry-key`, HEAD `fa960fd4`. **This branch is fully merged into main** (`git merge-base --is-ancestor HEAD main` confirms; `git diff main...HEAD` is empty). The large `git diff main --stat` output is only main moving ahead since. Its 15 commits delivered browser error reporting for the Everr web app itself (dogfooding):

- `40af1899` and `d2d15e09`: `packages/app/src/telemetry/client.ts` registers a browser `LoggerProvider` (BatchLogRecordProcessor + OTLP/HTTP logs exporter) then calls `init()` from `@everr/auto-otel-errors/browser`; `packages/app/src/components/root-error.tsx` is the TanStack Router default error component, reporting route render errors via `captureReactError` and showing a retry UI
- Keyless prod deploys send nothing; dev falls back to the local collector
- `4ae72f53`, `b387964e`, `98c7d22f`, `38d98a65`: public browser ingest keys, a dedicated key type with its own create dialog and table on the API keys page
- `3ae1b840`, `52b5acb8`, `c2c97cc4`: collector forwards the request Origin to the verify endpoint and enables CORS on the public OTLP receiver; origin policy tested at the handler
- `fa960fd4`: bakes `VITE_EVERR_PUBLIC_INGEST_KEY` into the prod image (`packages/app/Dockerfile`, `.github/workflows/build-and-push-images.yml`)
- `1be1d26c`: browser telemetry reference docs (now at `packages/docs/content/docs/reference/browser-telemetry.mdx` on main)

### 2c. Grouping and query layer (on main, landed after the worktree branched)

- **Fingerprint UDF:** `/Users/guidodorsi/workspace/everr/clickhouse/init/04-create-error-fingerprint-function.sql` defines `errorFingerprint(serviceName, logAttributes)`: uses the `error.fingerprint` log attribute when set, else `cityHash64(service, exception.type, normalized message)` where UUIDs become `<uuid>`, long numeric/hex ids become `<id>`, long quoted literals become `<quoted>`, truncated to 300 chars. A copy lives in the local collector at `collector/exporter/chdbexporter/internal/sqltemplates/create_error_fingerprint_function.sql` so web app, local collector chDB, agents, and skills group identically.
- **Query layer:** `/Users/guidodorsi/workspace/everr/packages/telemetry-explorer/src/errors/sql/fingerprint.ts` exports `ERROR_FINGERPRINT_SQL` and `EXCEPTION_LOG_FILTER_SQL` (SeverityNumber >= 17 and `exception.type` or `exception.message` present). `issues.ts` builds the grouped issue summaries (per-fingerprint count, trace count, first/last seen, latest occurrence) and per-fingerprint occurrence queries over `otel_logs`.
- **UI:** errors explore routes at `packages/app/src/routes/_authenticated/_dashboard/_explore/errors.tsx` and `errors_.$fingerprint.tsx`, backed by `packages/telemetry-explorer/src/errors/`.

### 2d. Source map handling

None. No sourcemap upload, storage, or symbolication code exists in `packages/app`, `packages/auto-otel-errors`, `packages/telemetry-explorer`, or `collector` (grep for `sourcemap`, `source map`, `source-map` finds nothing relevant). Production browser stacks are stored and rendered as emitted, i.e. minified frames for bundled apps.

## Options for the homepage error-tracking decision

1. **Use what is shipped, as is.** The homepage adopts `@everr/auto-otel-errors/browser` plus a public browser ingest key, exactly like `packages/app/src/telemetry/client.ts`. Zero new infrastructure; grouping via the message-normalizing UDF is decent but stacks stay minified and there are no error codes.
2. **Adopt evlog-style codes on top of the existing pipeline.** Keep the capture and storage as is, but define an error code convention (e.g. an `error.code` or reuse of the honored `error.fingerprint` attribute set from a small catalog) so homepage errors group by stable code instead of hashed messages. Cheap, aligns with https://www.evlog.dev/learn/structured-errors, and the UDF already gives explicit fingerprints priority.
3. **Invest in source map symbolication first.** Minified homepage stacks will be hard to act on; a sourcemap upload step plus server-side symbolication is the missing piece with the highest cost. Nothing exists today, so this is a net-new project and probably out of scope for the homepage swap itself.
4. **Richer structured error shape (full evlog model).** Add `why`/`fix`/`link`/`internal` style fields as OTel attributes with `beforeSend` and the redaction layers guarding leakage. Most useful for the product app's server errors; likely overkill for a marketing homepage where volume and grouping matter more than remediation metadata.

Pragmatic default: option 1 now, option 2 if homepage errors need stable dashboards or alerts, with option 3 tracked separately.
