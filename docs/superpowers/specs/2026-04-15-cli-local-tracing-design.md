# CLI local tracing — design

**Status:** draft
**Date:** 2026-04-15
**Scope:** `packages/desktop-app/src-cli`, `crates/everr-core`

## Problem

The `everr` CLI has become noticeably slow and there is no instrumentation to tell us where time goes. We want to measure every step from process entry through each I/O operation, with enough detail to answer "what is the slowest thing this command did and why." The measurement should run on the developer's machine only — no behavior change for shipped release binaries under normal use.

## Goals

- Opt-in (or dev-default) tracing of the CLI, emitted to the existing local OTLP collector the Tauri sidecar runs.
- Full attribution tree from `main` through command handler → sync work → HTTP/FS I/O, with no unattributed gaps big enough to matter.
- Logs captured alongside spans and linked to them via `trace_id` / `span_id`, so `everr telemetry logs --trace-id <id>` surfaces the messages emitted within a traced run.
- Queryable via existing `everr telemetry traces` / `everr telemetry logs` commands — no new CLI surface.
- Zero runtime cost when disabled.

## Non-goals

- Metrics.
- Propagating the CLI trace context into the backend API via `traceparent` headers (possible follow-up).
- Replacing the CLI's user-facing `stdout`/`stderr` output with structured logging. The CLI's printed output remains the CLI's output contract.

## Architecture overview

One runtime-installed tracing subscriber in the CLI, gated by a resolution rule. When active, it exports OTLP/HTTP to the sidecar's collector at `everr_core::build::otlp_http_origin()`. The sidecar and its collector are unchanged. The `everr telemetry traces` and `everr telemetry logs` read path is unchanged.

Service identity on emitted telemetry:

- Resource attrs: `service.name = everr-cli`, `service.version = <EVERR_VERSION>`. These tag every span and log in the run and drive `everr telemetry traces --service everr-cli`.
- Span attr: `everr.command = <subcommand>` is also set on the root span so it's reachable through the existing `--attr` filter in the telemetry query engine (`packages/desktop-app/src-cli/src/telemetry/query.rs` only matches against span/log attributes, not resource attributes, so resource-only tagging would be invisible to the CLI's own query surface).

Two layers on the subscriber:

- `tracing-opentelemetry` — converts `tracing` spans into OTLP spans.
- `opentelemetry-appender-tracing::OpenTelemetryTracingBridge` — converts `tracing` events (`info!`, `warn!`, `error!`, etc.) into OTLP log records, auto-linked to the enclosing span.

## Gate: when tracing is active

Resolution order on `EVERR_TRACE`:

1. `EVERR_TRACE=0` or `EVERR_TRACE=false` → disabled. Explicit opt-out always wins, so benchmarking runs can suppress tracing overhead.
2. `EVERR_TRACE` set to any other non-empty value → enabled.
3. Env var unset → enabled in debug builds (`cfg!(debug_assertions)`), disabled in release builds.

This mirrors the existing debug-vs-release split elsewhere in the codebase (`OTLP_HTTP_PORT` 54318/54418, `telemetry[-dev]/` directory). The `everr-dev` binary developers use locally traces by default; the shipped `everr` release binary does not.

**Suppression for telemetry read commands.** The `Commands::Telemetry(_)` subcommand is used to inspect the very store the CLI would be writing into. Tracing these commands would pollute the store with "I looked at the store" spans and logs on every diagnostic run. `trace_init::init` is skipped for that command regardless of gate resolution — the dispatch in `main.rs` makes the decision based on the parsed subcommand and simply doesn't construct a `TraceGuard` for `Commands::Telemetry`.

## Subscriber init module

New module: `packages/desktop-app/src-cli/src/telemetry/trace_init.rs`.

Public API:

```rust
pub fn init(command_name: &str) -> Option<TraceGuard>;

pub struct TraceGuard { /* holds TracerProvider + LoggerProvider */ }
```

Behavior of `init`:

0. Idempotency guard: `init` is intended to be called exactly once per process, from `main.rs`. The implementation wraps the subscriber installation in a `std::sync::OnceLock` so a second call (e.g., accidentally introduced later by a refactor) is a no-op returning `None` rather than panicking inside `tracing::subscriber::set_global_default`, which would otherwise fail hard in debug builds.
1. Apply the gate resolution rule. If disabled, return `None` without installing any subscriber.
2. Build OTLP/HTTP span exporter with endpoint `format!("{}/v1/traces", otlp_http_origin())` and an OTLP/HTTP log exporter with endpoint `format!("{}/v1/logs", otlp_http_origin())`. `opentelemetry-otlp`'s `with_endpoint` uses the URL as-is and does not append signal-specific paths (confirmed by the sidecar bridge in `packages/desktop-app/src-tauri/src/telemetry/bridge.rs` which appends them explicitly). Omitting the suffix results in 404s that the exporter swallows, so tracing would silently fail to land in the collector.
3. Wrap the span exporter in a `BatchSpanProcessor` and the log exporter in a `BatchLogProcessor`, matching the sidecar's baseline. Tight instrumentation around every HTTP call and every `git` shell-out puts the exporter on the hot path if we used simple (synchronous) processors — batched export keeps the measurement out of the measurement. The shutdown step below still ensures spans flush before process exit, so latency is not lost, only deferred.
4. Build the `TracerProvider` and `LoggerProvider` with resource attrs `service.name=everr-cli`, `service.version=<EVERR_VERSION>`.
5. Install `tracing_subscriber::Registry` with:
    - `tracing-opentelemetry` layer wired to the `TracerProvider`.
    - `OpenTelemetryTracingBridge` wired to the `LoggerProvider`.
    - `EnvFilter`: default `info,everr_cli=trace,everr_core=trace,reqwest=debug`. Respects `RUST_LOG` if the user sets it.
6. Configure exporter internal-error suppression (see Failure modes).
7. Return `Some(TraceGuard)` owning both providers.

Behavior of `TraceGuard::drop`:

- Call `TracerProvider::shutdown()` and `LoggerProvider::shutdown()`, each bounded by a 1 s timeout.
- If any export error was observed during the run (see Failure modes), print a single stderr line.

**Destructor discipline in `main`.** Rust destructors don't run across `std::process::exit`. The CLI currently calls `std::process::exit(1)` from inside handler bodies in two places (`packages/desktop-app/src-cli/src/core.rs` lines 144 and 158, both the "egrep matched nothing" path in `runs_logs`). With tracing enabled those exits would skip root-span close, skip `TraceGuard::drop`, skip the flush, and skip the export-error hint.

The fix is to eliminate `std::process::exit` inside handlers and let `main` own the exit code:

- Introduce `enum CliExit { Ok, NoMatch }` (or a typed sentinel error). `runs_logs` returns `Ok(CliExit::NoMatch)` when egrep produces no lines instead of calling `std::process::exit(1)`. All other handlers return `CliExit::Ok`.
- `main` becomes `async fn main() -> ExitCode`. The dispatch match produces a `CliExit`. After dispatch: drop the root span (scope exit), drop the `TraceGuard` (flush + export-error hint), then return `ExitCode::from(...)` mapping `NoMatch → 1` and `Ok → 0`. On handler `Err`, print via the existing anyhow path and return `ExitCode::from(1)` after the guard drops.
- This is a real (small) behavior-adjacent refactor. It's in scope: tracing is useless if the commands we want to measure exit before the tracer flushes.

## Instrumentation map

**Root span — `main.rs`.** After `Cli::parse`, call `trace_init::init(command_name)` (skipping it for `Commands::Telemetry`), and enter an `info_span!("everr", everr.command = %command_name)` span that wraps the entire dispatch match. `service.name`/`service.version` live on the resource so every span and log inherits them; `everr.command` lives on the root span because the query engine's `--attr` filter only applies to span/log attributes.

Drop order matters and is made explicit rather than relying on reverse-declaration order. Sketch:

```rust
async fn main() -> ExitCode {
    let cli = Cli::parse();
    let guard = match cli.command {
        Commands::Telemetry(_) => None,
        _ => trace_init::init(command_name_of(&cli.command)),
    };

    let exit = {
        let root = info_span!("everr", everr.command = %command_name_of(&cli.command));
        let _entered = root.enter();
        dispatch(cli).await
    }; // root span closes here

    drop(guard); // explicit — flush + export-error hint after root closes

    match exit { /* ExitCode mapping */ }
}
```

The `{ ... }` block bounds `_entered` and the root `Span` so they drop before `drop(guard)` runs, independent of declaration order. This avoids a classic Rust footgun where re-ordering lets would cause the guard to flush before the root span emits its close event.

**Long-lived commands.** `core::watch` polls until pipeline runs complete, so its run can last minutes. With batched export, inner spans (per poll cycle, per HTTP call) flush on their normal cadence while the root span stays open for the whole session. This is the expected shape; the root span's final close emits once on exit. Nothing special required.

**CLI-side handlers** — `#[tracing::instrument(skip_all, fields(...))]` on each top-level handler, with fields carrying the interesting args:

- `core::status`, `core::grep`, `core::watch`, `core::test_history`, `core::slowest_tests`, `core::slowest_jobs`, `core::runs_list`, `core::runs_show`, `core::runs_logs`, `core::workflows_list`.
- `onboarding::run`, `init::run`.
- `auth::login`, `auth::logout`.
- `assistant::print_repo_instructions`, `assistant::print_ai_instructions`.
- `uninstall::run_uninstall`.
- `telemetry::commands::run` and its subcommands.

**Inside handlers** — ad-hoc `info_span!` around non-trivial sync steps so the tree has no unattributed gaps:

- Every `git` subprocess invocation (`git rev-parse`, `git remote -v`, `git symbolic-ref`, etc.) — a span per call, fields `args`.
- JSON decode of large response payloads (runs list, logs) — only where measurable.
- Output rendering (table formatting, log printing) — one `render` span per handler.

**everr-core** — `#[tracing::instrument]` on:

- `ApiClient::from_session`, `build_http_client`, `build_auth_http_client` (TLS init can dominate a cold run). **Security:** `Session` derives `Debug` and holds a raw bearer `token` as a public field (`crates/everr-core/src/state.rs`). A bare `#[instrument]` would record the whole `Session` as a span attribute via `Debug`, writing the bearer into the local telemetry store. Every instrument attribute that receives a `Session` (or anything wrapping it) MUST use `#[tracing::instrument(skip_all, fields(api_base_url = %session.api_base_url))]` (or an equivalent explicit-fields form). This rule applies to any future `#[instrument]` added to functions that take `&Session`, `&AppState`, or bearer-bearing auth context types — called out explicitly in the implementation plan and checked in code review.
- Filesystem-touching helpers in `everr_core::auth` and `everr_core::state` (`load_session`, `load_state`, config-path resolvers). Same `skip_all` discipline applies.

**HTTP calls** — not instrumented manually; handled by the middleware in the next section.

**Deliberately not instrumented.** Clap parsing (fast; runs before the subscriber exists). Trivial getters and sync string building. Parsing helpers that never show up in timing.

## HTTP instrumentation via middleware

Switch `everr-core`'s HTTP client type from `reqwest::Client` to `reqwest_middleware::ClientWithMiddleware`, with `reqwest-tracing::TracingMiddleware` attached.

Changes:

- `crates/everr-core/src/api.rs`: `ApiClient { http: ClientWithMiddleware, ... }`. In `ApiClient::from_session`, wrap the built `reqwest::Client`: `ClientBuilder::new(client).with(TracingMiddleware::default()).build()`.
- `crates/everr-core/src/auth.rs`: same transformation in `build_http_client` and `build_auth_http_client`, and update the `&reqwest::Client` parameters to `&ClientWithMiddleware` for the helpers that accept them.

Call-site APIs don't change — `ClientWithMiddleware` exposes the same `.get(..)`, `.post(..)`, `.send().await` surface as `reqwest::Client`. Each request gets an auto-span with standard OTEL HTTP semantic-convention attrs (`http.request.method`, `url.full`, `server.address`, `http.response.status_code`) and duration.

**Side effect on the Tauri sidecar.** The sidecar shares `everr-core` and already uses `tracing` + OTLP. Its HTTP calls will now emit the same spans, nested under whatever the sidecar is already tracing. This is additive — richer sidecar traces, no behavior change, no new deps pulled into the sidecar.

## Logs: instrumentation approach

Plumbing only — don't mass-convert existing `println!`/`eprintln!` to `tracing::` macros.

Targeted migration to `tracing::` events where the message is a diagnostic signal rather than user-facing output:

- Auth reauthentication retry messages.
- "Stale sibling" banner and missing-telemetry-dir hints in `telemetry::commands`.
- HTTP 5xx retry / fallback messages.
- `git` shell-out failure messages (currently `eprintln!`).

Going forward, convention inside the CLI:

- `tracing::info!` / `warn!` / `error!` / `debug!` for internal diagnostics → captured by the logs bridge.
- `println!` / `eprintln!` reserved for the CLI's user-visible output contract.

## Shutdown and failure modes

**Flush.** `BatchSpanProcessor` + `BatchLogProcessor` accumulate in-memory and export off the hot path, so instrumenting high-frequency operations (per-HTTP-call, per-`git`-shell-out) does not put exporter I/O between the measurement and the thing being measured. On guard drop, `TracerProvider::shutdown()` / `LoggerProvider::shutdown()` drain pending batches synchronously, each bounded by a 1 s timeout (OTLP exporter default is longer; we shorten it to keep CLI exit snappy). Expected overhead on a warm collector: flush of ~10–50 ms at end-of-run, which falls *outside* the root span (shutdown runs on guard drop, after the span closes) so it does not distort the measurements inside the tree.

**Concrete span volumes we expect.** Typical short commands (`everr status`, `everr runs`) produce ~10–20 spans: root + handler + 1–3 `git` subprocesses + 1–3 HTTP spans + 1 render span + a few library-internal spans (connect, TLS). Heavier commands (`everr runs-logs` with paging, `everr show --failed`) sit around 30–80. `everr watch` grows linearly with poll count but inner spans close within each iteration, so memory is bounded by batch queue size (default 2048 spans; well above anything we produce in a single session). The BatchSpanProcessor's default 5 s scheduled delay means most spans ship while the CLI is still doing work; shutdown flushes only whatever's in the current bucket.

**Collector unreachable.** `opentelemetry-otlp` `internal-logs` feature is left off for the CLI, so exporter errors do not leak to stderr directly. `trace_init` installs a lightweight shared `AtomicBool` error flag via the exporter's error-handler hook. On `TraceGuard::drop`, if the flag is set, print exactly one line to stderr: `everr: trace export failed — is the Everr Desktop app running?`. The flag is shared across both span and log exporters so the user sees at most one hint. Export failure never affects the command's exit code.

## Dependencies

**`packages/desktop-app/src-cli/Cargo.toml`** — new:

- `tracing = "0.1"`
- `tracing-subscriber = { version = "0.3", features = ["env-filter"] }`
- `tracing-opentelemetry = "0.32"` (pins to `opentelemetry 0.31`, matching the sidecar's pin).
- `opentelemetry = "0.31"`
- `opentelemetry_sdk = { version = "0.31", features = ["rt-tokio"] }` — `rt-tokio` is required because we use `BatchSpanProcessor`/`BatchLogProcessor` and want the batch loop driven by the existing tokio runtime rather than a dedicated `std::thread`, matching the sidecar setup.
- `opentelemetry-otlp = { version = "0.31", default-features = false, features = ["http-proto", "reqwest-blocking-client", "trace", "logs"] }`
- `opentelemetry-appender-tracing = { version = "0.31", features = ["experimental_use_tracing_span_context"] }` — the `experimental_*` feature is how logs get `trace_id`/`span_id` from the enclosing `tracing` span. This is the same feature the sidecar already uses; if a minor-version bump changes the API, both sites move together. The "experimental" label is called out here so future readers know `everr telemetry logs --trace-id <id>` depends on a non-stable feature flag.

**`crates/everr-core/Cargo.toml`** — new:

- `tracing = "0.1"`
- `reqwest-middleware` (pinned to a version compatible with the already-used `reqwest = "0.12.15"`).
- `reqwest-tracing` (matching major of `reqwest-middleware`).

**Workspace reqwest hygiene.** `packages/desktop-app/src-cli/Cargo.toml` currently pins `reqwest = "0.12.15"` in `[dependencies]` and `reqwest = "0.12"` (with the `blocking` feature) in `[dev-dependencies]`. Cargo's SemVer resolver collapses both to the same `0.12.x` line, so no duplicate crate is compiled. Still, when adding `reqwest-middleware`/`reqwest-tracing`, the implementation plan verifies with `cargo tree -p everr-cli -i reqwest` that only one `reqwest` version is in the build graph. Any diamond between `reqwest-middleware`'s reqwest range and our pin is resolved before merge.

Tauri sidecar alignment: the sidecar's `Cargo.toml` already pins `opentelemetry = "0.31"`, `opentelemetry-appender-tracing = "0.31"`, `opentelemetry-otlp = "0.31"`, `opentelemetry_sdk = "0.31"`, `tracing = "0.1"`, `tracing-opentelemetry = "0.32"`, `tracing-subscriber = "0.3"`. The CLI uses the same pins so the workspace resolves a single version of each. `reqwest-middleware` / `reqwest-tracing` / `everr-core::tracing` are new to the workspace — these are genuinely new deps, not alignment with existing ones.

## Testing

- **Unit (trace_init):**
    - With `EVERR_TRACE=0` in a debug build, `init` returns `None` and installs no subscriber.
    - With `EVERR_TRACE=1` in a release build, `init` returns `Some`.
    - With env var unset, `init` returns `Some` in a debug build, `None` in a release build.
- **Integration (CLI → sidecar collector):**
    - Run `everr-dev status` against a running sidecar. Assert `everr telemetry traces --service everr-cli --attr everr.command=status` returns a tree containing the root span, a `core::status` handler span, and at least one HTTP span with `http.response.status_code`.
    - Assert `everr telemetry logs --service everr-cli --trace-id <root_trace_id>` returns log records with matching `trace_id` when the run emits diagnostic `tracing::` events.
    - Run `EVERR_TRACE=0 everr-dev status` and assert no CLI-sourced spans appear for that run.
    - Run `everr-dev logs <trace-id> --job-name ... --step-number ... --egrep 'pattern-that-never-matches'`. Assert the process exits 1 *and* that `everr telemetry traces --attr everr.command=runs-logs` contains a fully-closed root span for the run (proves the destructor / flush path runs when the CLI exits non-zero).
    - Run `everr-dev telemetry traces --service everr-cli --limit 1` and assert it does **not** create a new CLI span of its own for that invocation (proves the telemetry-subcommand suppression).
    - No bearer token appears anywhere in span or log attributes across the runs above (string-scan the store).
- **Sidecar regression:** existing Tauri-side tests still pass after the `ApiClient` type change. No behavior change to HTTP semantics.

## Out of scope

- Metrics (OTLP metrics pipeline).
- `traceparent` propagation from CLI to the backend API so backend perf ties into CLI traces. Straightforward follow-up — the middleware already supports injection — deferred here to keep the change focused.
