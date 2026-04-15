# CLI Local Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument the `everr` CLI so every step from process entry through each I/O operation is captured as OTLP spans and logs in the existing local collector, opt-in (or dev-default) and queryable via `everr telemetry traces`/`logs`.

**Architecture:** A new `telemetry::trace_init` module installs a `tracing-subscriber` with `tracing-opentelemetry` + `OpenTelemetryTracingBridge` layers, gated by `EVERR_TRACE` with a debug-default-on / release-default-off fallback. `main.rs` refactors to return `ExitCode` so destructors run and pending spans flush before exit. Shared HTTP client in `everr-core` gains `reqwest-middleware` + `reqwest-tracing` for automatic HTTP spans. Handlers in both crates get `#[tracing::instrument]` with strict `skip_all` discipline where bearer tokens or `Session` appear in scope.

**Tech Stack:** Rust 2024, tokio, clap, reqwest, `tracing`, `tracing-subscriber`, `tracing-opentelemetry` 0.32, `opentelemetry` 0.31 + `opentelemetry-otlp` 0.31 + `opentelemetry_sdk` 0.31 + `opentelemetry-appender-tracing` 0.31, `reqwest-middleware`, `reqwest-tracing`.

**Spec:** `docs/superpowers/specs/2026-04-15-cli-local-tracing-design.md`.

**Commit policy for this repo:** The user manages their own commits. The "Commit" steps below are suggested checkpoints where the tree is green and logically cohesive; do not run `git commit` unless the user explicitly asks. Instead, after each task, report that the checkpoint is reached and await direction.

**Working directory:** `/Users/guidodorsi/workspace/everr`. All paths are relative to this root unless absolute.

**Build CLI note:** The CLI package is `everr-cli`; it builds a binary named `everr` (see `[[bin]]` in `packages/desktop-app/src-cli/Cargo.toml`). When the plan says "run the CLI" during a step, invoke it via `cargo run -p everr-cli -- <args>`. If your environment has an `everr-dev` symlink on `PATH` pointing at the debug build, that works too; otherwise use the `cargo run` form.

---

## File Structure

**New files:**

- `packages/desktop-app/src-cli/src/telemetry/trace_init.rs` — gate resolution, subscriber install, `TraceGuard` lifecycle, OTLP exporter wiring. Small surface: `gate_is_active`, `init`, `init_with_endpoint` (test seam accepting an `env_override: Option<&str>`), `TraceGuard`.
- `packages/desktop-app/src-cli/src/exit_code.rs` — `CliExit` enum mapping to `std::process::ExitCode`. Tiny module, kept separate so `main.rs`/`lib.rs` and `core.rs` can both import without circularity.
- `packages/desktop-app/src-cli/src/lib.rs` — library target added in Task 12. Owns the CLI module tree (`pub mod core;`, `pub mod telemetry;`, …) and exposes `pub async fn run() -> ExitCode`. `main.rs` becomes a thin shim that calls `everr_cli::run().await`. This avoids double-compiling the module tree and gives `tests/*.rs` a stable import path (`use everr_cli::telemetry::trace_init;`).
- `packages/desktop-app/src-cli/tests/tracing_export.rs` — integration test: mock OTLP collector, assert spans post on guard drop.
- `packages/desktop-app/src-cli/tests/tracing_gate_off.rs` — integration test in its own binary (fresh `OnceLock`): assert `init_with_endpoint` returns `None` when gate explicitly off.

**Modified files:**

- `packages/desktop-app/src-cli/Cargo.toml` — add tracing + OTLP deps; add `mockito` in dev-deps if not already present.
- `crates/everr-core/Cargo.toml` — add `tracing`, `reqwest-middleware`, `reqwest-tracing`.
- `crates/everr-core/src/api.rs` — `http` field becomes `ClientWithMiddleware`; `#[instrument(skip_all, fields(...))]` on methods accepting `&Session`.
- `crates/everr-core/src/auth.rs` — HTTP builders return `ClientWithMiddleware`; parameter types updated.
- `crates/everr-core/src/state.rs` — `#[instrument]` on fs-touching helpers; no bearer leak.
- `crates/everr-core/src/lib.rs` — no change expected unless re-exports drift.
- `packages/desktop-app/src-cli/src/main.rs` — after Task 7 it returns `ExitCode`, installs the subscriber (skipping `Commands::Telemetry`), enters the root span in a scoped block, and drops the guard explicitly. After Task 12 it is reduced to a `fn main() -> ExitCode { everr_cli::run().await }` shim; the former body moves verbatim into `lib.rs::run`.
- `packages/desktop-app/src-cli/src/telemetry/mod.rs` — expose new `trace_init` submodule.
- `packages/desktop-app/src-cli/src/core.rs` — `runs_logs` returns `CliExit` instead of calling `std::process::exit(1)`; `#[instrument(skip_all, fields(...))]` on all handlers; ad-hoc `info_span!` around git shell-outs and render paths.
- `packages/desktop-app/src-cli/src/auth.rs`, `assistant.rs`, `onboarding.rs`, `init.rs`, `uninstall.rs`, `telemetry/commands.rs` — `#[instrument(skip_all, fields(...))]` on top-level handlers.
- `packages/desktop-app/src-tauri/...` — should require no changes, but every file that constructs an `ApiClient` or passes `&reqwest::Client` must be updated to `&ClientWithMiddleware`. Task 3 enumerates call sites.

---

## Task 1: Add CLI tracing dependencies

**Files:**
- Modify: `packages/desktop-app/src-cli/Cargo.toml`

- [ ] **Step 1: Add tracing + OTLP deps**

Add to `[dependencies]` in `packages/desktop-app/src-cli/Cargo.toml`, after the existing `tokio` line:

```toml
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
tracing-opentelemetry = "0.32"
opentelemetry = "0.31"
opentelemetry_sdk = { version = "0.31", features = ["rt-tokio"] }
opentelemetry-otlp = { version = "0.31", default-features = false, features = ["http-proto", "reqwest-blocking-client", "trace", "logs"] }
opentelemetry-appender-tracing = { version = "0.31", features = ["experimental_use_tracing_span_context"] }
```

Add to `[dev-dependencies]` if `mockito` is not already present (it is — leave it as is):

```toml
# mockito already present
```

- [ ] **Step 2: Verify build**

Run: `cargo build -p everr-cli`
Expected: Clean build, no compile errors. Possibly warnings about unused imports — ignore for now; later tasks will use the deps.

- [ ] **Step 3: Verify reqwest is a single version**

Run: `cargo tree -p everr-cli -i reqwest`
Expected: A single `reqwest` line (e.g., `reqwest v0.12.x`). If two versions appear, stop and investigate — the OTLP deps likely pulled in a conflicting range. Adjust pins before proceeding.

- [ ] **Step 4: Commit checkpoint (ask user)**

Suggested message: `chore(cli): add tracing + OTLP dependencies`. Wait for explicit user confirmation before running `git commit`.

---

## Task 2: Add everr-core tracing + HTTP middleware dependencies

**Files:**
- Modify: `crates/everr-core/Cargo.toml`

- [ ] **Step 1: Add deps**

Add to `[dependencies]` in `crates/everr-core/Cargo.toml`:

```toml
tracing = "0.1"
reqwest-middleware = "0.5"
reqwest-tracing = "0.7"
```

**Why these specific minors:** `reqwest-middleware < 0.5` and `reqwest-tracing < 0.7` depend on `reqwest 0.11`; this workspace is on `reqwest 0.12`. Mixing would pull two copies of reqwest and immediately break `ClientWithMiddleware` interop because the two reqwest versions would be distinct types. If `cargo build` reports a resolver conflict anyway, run `cargo tree -i reqwest` and adjust only as far as necessary to restore a single reqwest version.

- [ ] **Step 2: Verify build**

Run: `cargo build -p everr-core`
Expected: Clean build. No new warnings beyond preexisting.

- [ ] **Step 3: Verify workspace still builds**

Run: `cargo build --workspace`
Expected: Everything including `everr-cli` and the Tauri sidecar (`everr-desktop-app`) still builds green. If the sidecar fails, stop — Task 3 will cascade the `reqwest::Client` type change.

- [ ] **Step 4: Commit checkpoint (ask user)**

Suggested message: `chore(core): add tracing + reqwest-middleware dependencies`.

---

## Task 3: Switch everr-core HTTP clients to ClientWithMiddleware

**Files:**
- Modify: `crates/everr-core/src/api.rs`
- Modify: `crates/everr-core/src/auth.rs`
- Modify: (call sites — enumerated in Step 3)

Change the runtime HTTP client type from `reqwest::Client` to `reqwest_middleware::ClientWithMiddleware`. Attach `reqwest_tracing::TracingMiddleware::default()` to every client constructor. Call-site API is unchanged because `ClientWithMiddleware` exposes the same `.get()`, `.post()`, `.send().await` surface.

- [ ] **Step 1: Update `ApiClient::from_session`**

In `crates/everr-core/src/api.rs`, change the struct field type and the constructor. Replace:

```rust
pub struct ApiClient {
    http: reqwest::Client,
    base_url: String,
    base_endpoint: String,
}
```

with:

```rust
pub struct ApiClient {
    http: reqwest_middleware::ClientWithMiddleware,
    base_url: String,
    base_endpoint: String,
}
```

And in `ApiClient::from_session`, replace the `.build()` section:

```rust
let http = reqwest::Client::builder()
    .default_headers(headers)
    .build()
    .context("failed to build HTTP client")?;
```

with:

```rust
let http = reqwest::Client::builder()
    .default_headers(headers)
    .build()
    .context("failed to build HTTP client")?;
let http = reqwest_middleware::ClientBuilder::new(http)
    .with(reqwest_tracing::TracingMiddleware::default())
    .build();
```

- [ ] **Step 2: Update `build_http_client` and `build_auth_http_client` in `crates/everr-core/src/auth.rs`**

Replace:

```rust
fn build_http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .build()
        .context("failed to build HTTP client")
}

pub fn build_auth_http_client() -> Result<reqwest::Client> {
    build_http_client()
}
```

with:

```rust
fn build_http_client() -> Result<reqwest_middleware::ClientWithMiddleware> {
    let http = reqwest::Client::builder()
        .build()
        .context("failed to build HTTP client")?;
    Ok(reqwest_middleware::ClientBuilder::new(http)
        .with(reqwest_tracing::TracingMiddleware::default())
        .build())
}

pub fn build_auth_http_client() -> Result<reqwest_middleware::ClientWithMiddleware> {
    build_http_client()
}
```

- [ ] **Step 3: Update all `&reqwest::Client` parameter types**

Search for parameters typed `&reqwest::Client` inside `everr-core`:

```
grep -rn "&reqwest::Client" crates/everr-core/src
```

Expected hits include (at least): `crates/everr-core/src/auth.rs:71`, `:99`, `:205`, and any helpers called from there. For each function signature, replace `&reqwest::Client` with `&reqwest_middleware::ClientWithMiddleware`.

- [ ] **Step 4: Fix up sidecar call sites**

The sidecar consumes the changed functions in `packages/desktop-app/src-tauri/src/auth.rs`:

- line 24: `let client = build_auth_http_client()?;` — binding type is now `ClientWithMiddleware`, transparent to callers because `start_device_authorization` will also have its signature updated in Step 3.
- line 57: same call as above, followed by `poll_device_authorization(&client, ...)`.
- line 162: `ApiClient::from_session(session)` — unchanged, `ApiClient` encapsulates its own middleware client internally.

After running `cargo build --workspace`, these three locations should compile without edits (they only take the return value of the now-middleware-wrapped builders and pass it along). If you see errors elsewhere — e.g., another Tauri module constructs a bare `reqwest::Client` and passes it to a helper whose signature changed — wrap that site with the same middleware pattern:

```rust
let http = reqwest_middleware::ClientBuilder::new(http)
    .with(reqwest_tracing::TracingMiddleware::default())
    .build();
```

If no sidecar errors appear, this step is a no-op and you can continue.

- [ ] **Step 5: Run the full test suite**

Run: `cargo test --workspace`
Expected: all existing tests pass. HTTP behavior is unchanged; only the carrier type is different.

- [ ] **Step 6: Commit checkpoint (ask user)**

Suggested message: `refactor(core): wrap shared HTTP clients with tracing middleware`.

---

## Task 4: Introduce `CliExit` enum and plumb it through `main`

Rust destructors do not run across `std::process::exit`. The CLI currently calls `std::process::exit(1)` inside `runs_logs` for the "egrep matched nothing" case. Once tracing is installed, that path would skip the trace guard's flush. The fix is to lift the exit decision to `main` and return an `ExitCode`.

**Files:**
- Create: `packages/desktop-app/src-cli/src/exit_code.rs`
- Modify: `packages/desktop-app/src-cli/src/main.rs`
- Modify: `packages/desktop-app/src-cli/src/core.rs`

- [ ] **Step 1: Write a failing test for the exit-code mapping**

Create `packages/desktop-app/src-cli/src/exit_code.rs` with a test-first skeleton:

```rust
use std::process::ExitCode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliExit {
    Ok,
    NoMatch,
}

impl CliExit {
    pub fn to_exit_code(self) -> ExitCode {
        match self {
            CliExit::Ok => ExitCode::from(0),
            CliExit::NoMatch => ExitCode::from(1),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_maps_to_zero() {
        // ExitCode doesn't expose its inner u8 directly, so compare Debug repr.
        assert_eq!(format!("{:?}", CliExit::Ok.to_exit_code()), format!("{:?}", ExitCode::from(0)));
    }

    #[test]
    fn no_match_maps_to_one() {
        assert_eq!(format!("{:?}", CliExit::NoMatch.to_exit_code()), format!("{:?}", ExitCode::from(1)));
    }
}
```

- [ ] **Step 2: Register the module**

In `packages/desktop-app/src-cli/src/main.rs`, add to the `mod` list near the top:

```rust
mod exit_code;
```

- [ ] **Step 3: Run the tests**

Run: `cargo test -p everr-cli exit_code`
Expected: Both tests pass.

- [ ] **Step 4: Refactor `main` to return `ExitCode`**

Before blindly pasting, `cat packages/desktop-app/src-cli/src/main.rs` and diff it against the snippet below. The module declarations at the top of the file may have drifted since this plan was written; preserve any that this snippet omits (e.g. a newly added `mod foo;`). The key behavioral changes are: the return type becomes `ExitCode`, command dispatch moves into a `dispatch` fn returning `Result<CliExit>`, and `runs_logs` threads its `CliExit` back up instead of short-circuiting with `std::process::exit`.

Replace the existing `main.rs` body with:

```rust
mod api;
mod assistant;
mod auth;
mod cli;
mod core;
mod exit_code;
mod init;
mod onboarding;
mod telemetry;
mod uninstall;

use std::process::ExitCode;

use clap::Parser;

use cli::{Cli, Commands};
use exit_code::CliExit;

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();

    let result: anyhow::Result<CliExit> = dispatch(cli).await;

    match result {
        Ok(exit) => exit.to_exit_code(),
        Err(err) => {
            eprintln!("Error: {err:#}");
            ExitCode::from(1)
        }
    }
}

async fn dispatch(cli: Cli) -> anyhow::Result<CliExit> {
    match cli.command {
        Commands::Uninstall => {
            uninstall::run_uninstall()?;
            Ok(CliExit::Ok)
        }
        Commands::Login(login) => {
            auth::login(login).await?;
            Ok(CliExit::Ok)
        }
        Commands::Logout => {
            auth::logout()?;
            Ok(CliExit::Ok)
        }
        Commands::SetupAssistant => {
            assistant::print_repo_instructions();
            Ok(CliExit::Ok)
        }
        Commands::AiInstructions => {
            assistant::print_ai_instructions();
            Ok(CliExit::Ok)
        }
        Commands::Status(args) => {
            core::status(args).await?;
            Ok(CliExit::Ok)
        }
        Commands::Grep(args) => {
            core::grep(args).await?;
            Ok(CliExit::Ok)
        }
        Commands::TestHistory(args) => {
            core::test_history(args).await?;
            Ok(CliExit::Ok)
        }
        Commands::SlowestTests(args) => {
            core::slowest_tests(args).await?;
            Ok(CliExit::Ok)
        }
        Commands::SlowestJobs(args) => {
            core::slowest_jobs(args).await?;
            Ok(CliExit::Ok)
        }
        Commands::Watch(args) => {
            core::watch(args).await?;
            Ok(CliExit::Ok)
        }
        Commands::RunsList(args) => {
            core::runs_list(args).await?;
            Ok(CliExit::Ok)
        }
        Commands::RunsShow(args) => {
            core::runs_show(args).await?;
            Ok(CliExit::Ok)
        }
        Commands::RunsLogs(args) => core::runs_logs(args).await,
        Commands::WorkflowsList(args) => {
            core::workflows_list(args).await?;
            Ok(CliExit::Ok)
        }
        Commands::Setup => {
            onboarding::run().await?;
            Ok(CliExit::Ok)
        }
        Commands::Init => {
            init::run().await?;
            Ok(CliExit::Ok)
        }
        Commands::Telemetry(args) => {
            telemetry::commands::run(args)?;
            Ok(CliExit::Ok)
        }
    }
}
```

- [ ] **Step 5: Change `core::runs_logs` to return `CliExit`**

In `packages/desktop-app/src-cli/src/core.rs`, change the signature of `runs_logs` from `pub async fn runs_logs(args: GetLogsArgs) -> Result<()>` to `pub async fn runs_logs(args: GetLogsArgs) -> Result<CliExit>`. Replace the two `std::process::exit(1)` call sites:

At the paged-output branch (currently around line 144):

```rust
if args.egrep.is_some() && paged_logs.logs.is_empty() {
    std::process::exit(1);
}
return Ok(());
```

with:

```rust
if args.egrep.is_some() && paged_logs.logs.is_empty() {
    return Ok(CliExit::NoMatch);
}
return Ok(CliExit::Ok);
```

At the tail-output branch (currently around line 157):

```rust
if args.egrep.is_some() && response.logs.is_empty() {
    std::process::exit(1);
}
Ok(())
```

with:

```rust
if args.egrep.is_some() && response.logs.is_empty() {
    return Ok(CliExit::NoMatch);
}
Ok(CliExit::Ok)
```

Import at the top of `core.rs`:

```rust
use crate::exit_code::CliExit;
```

- [ ] **Step 6: Build and test**

Run: `cargo build -p everr-cli`
Expected: Clean build.

Run: `cargo test -p everr-cli`
Expected: All existing tests pass. The CLI tests that spawn the binary and assert exit codes still work because the behavior (exit 1 on no match) is unchanged.

- [ ] **Step 7: Commit checkpoint (ask user)**

Suggested message: `refactor(cli): return ExitCode from main so destructors run on no-match exits`.

---

## Task 5: Create `trace_init` module with gate logic and unit tests

This task introduces the module and its pure gate function with tests. The subscriber-install internals come in Task 6 so this task stays small and testable.

**Files:**
- Create: `packages/desktop-app/src-cli/src/telemetry/trace_init.rs`
- Modify: `packages/desktop-app/src-cli/src/telemetry/mod.rs`

- [ ] **Step 1: Write the failing gate tests**

Create `packages/desktop-app/src-cli/src/telemetry/trace_init.rs` with:

```rust
//! Subscriber init for CLI-local OTLP tracing.
//!
//! Gate: `EVERR_TRACE` runtime env var overrides the default, with a
//! debug-assertions fallback so `everr-dev` traces out of the box.

pub(crate) fn gate_is_active(env_value: Option<&str>, is_debug_build: bool) -> bool {
    match env_value {
        Some("0" | "false") => false,
        Some(value) if !value.trim().is_empty() => true,
        _ => is_debug_build,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unset_env_enables_in_debug_build() {
        assert!(gate_is_active(None, true));
    }

    #[test]
    fn unset_env_disables_in_release_build() {
        assert!(!gate_is_active(None, false));
    }

    #[test]
    fn explicit_zero_overrides_debug_default() {
        assert!(!gate_is_active(Some("0"), true));
    }

    #[test]
    fn explicit_false_overrides_debug_default() {
        assert!(!gate_is_active(Some("false"), true));
    }

    #[test]
    fn any_nonempty_value_enables_even_in_release() {
        assert!(gate_is_active(Some("1"), false));
        assert!(gate_is_active(Some("yes"), false));
    }

    #[test]
    fn empty_or_whitespace_falls_back_to_build_default() {
        assert!(gate_is_active(Some(""), true));
        assert!(!gate_is_active(Some(""), false));
        assert!(gate_is_active(Some("   "), true));
        assert!(!gate_is_active(Some("   "), false));
    }
}
```

- [ ] **Step 2: Register the new submodule**

Edit `packages/desktop-app/src-cli/src/telemetry/mod.rs` and add:

```rust
pub mod trace_init;
```

(Alongside the existing `pub mod commands;`, `pub mod otlp;`, etc.)

- [ ] **Step 3: Run the tests**

Run: `cargo test -p everr-cli trace_init`
Expected: All gate tests pass.

- [ ] **Step 4: Commit checkpoint (ask user)**

Suggested message: `feat(cli/telemetry): add trace_init gate with unit tests`.

---

## Task 6: Implement `trace_init::init` with OTLP providers and `TraceGuard`

Now the subscriber install itself. The implementation uses a `OnceLock` to guarantee single install, builds OTLP exporters with signal-specific paths, wraps them in batch processors, builds providers with resource attrs, installs the two-layer subscriber, and returns a guard that flushes on drop.

**Files:**
- Modify: `packages/desktop-app/src-cli/src/telemetry/trace_init.rs`

- [ ] **Step 0: Read the sidecar's OTLP setup and mirror its API usage exactly**

Read `packages/desktop-app/src-tauri/src/telemetry/bridge.rs` first. The sidecar is already on `opentelemetry_sdk 0.31` and has the working incantation for building providers. Points to carry over verbatim:

- `SpanExporter::builder().with_http().with_endpoint(...).build()` (this crate pins `opentelemetry-otlp` 0.31 with `http-proto` + `reqwest-blocking-client`; confirm those features are enabled in `Cargo.toml` from Task 1).
- Provider construction: `SdkTracerProvider::builder().with_batch_exporter(exporter).with_resource(resource).build()`. Note the method is `with_batch_exporter(exporter)` — it wraps in a `BatchSpanProcessor` internally. The sample code below uses that form; if your local `opentelemetry_sdk` minor has renamed it, adjust.
- `Resource::builder().with_attributes([...]).build()` for the attribute set.
- Shutdown: `provider.shutdown_with_timeout(...)` on `Drop`.

Any deviation from these shapes is likely a red flag. If the sidecar's file has been refactored in the meantime, trust the sidecar and adapt the snippet below accordingly.

- [ ] **Step 1: Extend `trace_init.rs` with the `init` implementation**

Append to `packages/desktop-app/src-cli/src/telemetry/trace_init.rs`:

```rust
use std::env;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use opentelemetry::{KeyValue, trace::TracerProvider as _};
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::{LogExporter, SpanExporter, WithExportConfig};
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::Resource;
use tracing_subscriber::{EnvFilter, Registry, layer::SubscriberExt};
use tracing_subscriber::util::SubscriberInitExt;

const ENV_VAR: &str = "EVERR_TRACE";
const CLI_VERSION: &str = env!("EVERR_VERSION");
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(1);
const EXPORT_FAILURE_HINT: &str =
    "everr: trace export failed — is the Everr Desktop app running?";
const DEFAULT_ENV_FILTER: &str = "info,everr_cli=trace,everr_core=trace,reqwest=debug";

static INIT_ONCE: OnceLock<()> = OnceLock::new();
static EXPORT_ERROR_FLAG: OnceLock<Arc<AtomicBool>> = OnceLock::new();

pub struct TraceGuard {
    tracer_provider: Option<SdkTracerProvider>,
    logger_provider: Option<SdkLoggerProvider>,
    export_error_flag: Arc<AtomicBool>,
}

impl Drop for TraceGuard {
    fn drop(&mut self) {
        if let Some(tp) = self.tracer_provider.take() {
            // `shutdown_with_timeout` drains the batch queue synchronously.
            let _ = tp.shutdown_with_timeout(SHUTDOWN_TIMEOUT);
        }
        if let Some(lp) = self.logger_provider.take() {
            let _ = lp.shutdown_with_timeout(SHUTDOWN_TIMEOUT);
        }
        if self.export_error_flag.load(Ordering::Relaxed) {
            eprintln!("{EXPORT_FAILURE_HINT}");
        }
    }
}

pub fn init(command_name: &str) -> Option<TraceGuard> {
    let endpoint = everr_core::build::otlp_http_origin();
    let env_value = env::var(ENV_VAR).ok();
    init_with_endpoint(&endpoint, command_name, env_value.as_deref())
}

pub fn init_with_endpoint(
    endpoint: &str,
    command_name: &str,
    env_override: Option<&str>,
) -> Option<TraceGuard> {
    if !gate_is_active(env_override, cfg!(debug_assertions)) {
        return None;
    }

    // OnceLock guarantees a single global subscriber install.
    if INIT_ONCE.set(()).is_err() {
        return None;
    }

    let resource = Resource::builder()
        .with_attributes([
            KeyValue::new("service.name", "everr-cli"),
            KeyValue::new("service.version", CLI_VERSION),
            KeyValue::new("everr.command", command_name.to_string()),
        ])
        .build();

    let export_error_flag = Arc::new(AtomicBool::new(false));
    // Register the shared flag so the OTEL error hook (installed below) can
    // flip it on async export failures after init has returned.
    let _ = EXPORT_ERROR_FLAG.set(export_error_flag.clone());

    let trace_endpoint = format!("{}/v1/traces", endpoint.trim_end_matches('/'));
    let log_endpoint = format!("{}/v1/logs", endpoint.trim_end_matches('/'));

    let span_exporter = match SpanExporter::builder()
        .with_http()
        .with_endpoint(&trace_endpoint)
        .build()
    {
        Ok(exporter) => exporter,
        Err(_err) => {
            export_error_flag.store(true, Ordering::Relaxed);
            return None;
        }
    };
    let log_exporter = match LogExporter::builder()
        .with_http()
        .with_endpoint(&log_endpoint)
        .build()
    {
        Ok(exporter) => exporter,
        Err(_err) => {
            export_error_flag.store(true, Ordering::Relaxed);
            return None;
        }
    };

    // Mirror the sidecar's provider shape (see bridge.rs): `with_batch_exporter`
    // owns batch-processor construction — don't hand-build a BatchSpanProcessor.
    let tracer_provider = SdkTracerProvider::builder()
        .with_batch_exporter(span_exporter)
        .with_resource(resource.clone())
        .build();

    let logger_provider = SdkLoggerProvider::builder()
        .with_batch_exporter(log_exporter)
        .with_resource(resource)
        .build();

    // Wire async export errors to our flag. The exact hook name/signature is
    // `opentelemetry::global::set_error_handler` in most 0.31.x versions; if
    // your pinned minor renamed/removed it (the API has moved around), look
    // for `opentelemetry::otel_error!` macro or `global::handle_error` and
    // register the equivalent closure. If no hook is available, keep the
    // build-time error path above — it still catches the common "collector
    // not running" case because the exporter pre-flights at build time.
    let flag_for_hook = export_error_flag.clone();
    let _ = opentelemetry::global::set_error_handler(move |_err| {
        flag_for_hook.store(true, Ordering::Relaxed);
    });

    let tracer = tracer_provider.tracer("everr-cli");
    let span_layer = tracing_opentelemetry::layer().with_tracer(tracer);
    let log_layer = OpenTelemetryTracingBridge::new(&logger_provider);

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(DEFAULT_ENV_FILTER));

    let subscriber = Registry::default()
        .with(env_filter)
        .with(span_layer)
        .with(log_layer);

    if subscriber.try_init().is_err() {
        return None;
    }

    Some(TraceGuard {
        tracer_provider: Some(tracer_provider),
        logger_provider: Some(logger_provider),
        export_error_flag,
    })
}
```

Notes for reviewers:
- `shutdown_with_timeout` on both providers is the 0.31 API; if your locally-resolved minor ships a differently-named method (`shutdown()` returning a `Result` is the other common form), `cargo doc --open -p opentelemetry_sdk` and adjust.
- `opentelemetry::global::set_error_handler` has moved around between minors. If the symbol isn't resolvable at compile time, check `opentelemetry::global`'s re-exports and swap for whatever the current canonical hook is. Worst case, delete that block — the build-time `store(true)` path still catches "collector not running" because the exporter pre-flights.
- `subscriber.try_init()` fails if another subscriber was already installed. Our own `OnceLock` prevents this from our code path, so a failure here means something else in the workspace set one up. Bail out quietly.

- [ ] **Step 2: Verify it compiles**

Run: `cargo build -p everr-cli`
Expected: Clean build. Any type-name drift (e.g., `Resource::builder` vs `Resource::new`) will surface here — consult the rustdoc for the exact pinned version and adjust the call.

- [ ] **Step 3: Unit test — call twice returns `None` second time**

Append to the test module in `trace_init.rs`:

```rust
    #[test]
    fn second_init_with_endpoint_returns_none() {
        // Test relies on the OnceLock state being process-global, so only
        // one of these will return Some(). We don't care which.
        let first = init_with_endpoint("http://127.0.0.1:0", "first", Some("1"));
        let second = init_with_endpoint("http://127.0.0.1:0", "second", Some("1"));
        assert!(!(first.is_some() && second.is_some()));
    }
```

(Using `127.0.0.1:0` is a harmless unreachable address; spans will fail to export but won't affect the test. The explicit `Some("1")` third argument forces the gate on without mutating the process env.)

- [ ] **Step 4: Run the tests**

Run: `cargo test -p everr-cli trace_init`
Expected: gate tests still pass, new `second_init_with_endpoint_returns_none` passes.

- [ ] **Step 5: Commit checkpoint (ask user)**

Suggested message: `feat(cli/telemetry): implement trace_init::init with OTLP batch providers`.

---

## Task 7: Wire `trace_init` into `main`

Install the subscriber in `main` for every command except `Commands::Telemetry(_)`. Enter the root span inside a scoped block. Drop the guard explicitly after the block closes so the flush happens after the root span emits its close event.

**Files:**
- Modify: `packages/desktop-app/src-cli/src/main.rs`

- [ ] **Step 1: Update `main` with subscriber install and scoped root span**

Replace the body of `async fn main` from Task 4:

```rust
#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    let command_name = command_name_of(&cli.command);

    // Suppress the subscriber for telemetry read commands so inspecting
    // the local store doesn't write new CLI spans into it.
    let guard = match cli.command {
        Commands::Telemetry(_) => None,
        _ => telemetry::trace_init::init(command_name),
    };

    let result: anyhow::Result<CliExit> = {
        let root = tracing::info_span!("everr", "everr.command" = %command_name);
        let _entered = root.enter();
        dispatch(cli).await
    };

    drop(guard);

    match result {
        Ok(exit) => exit.to_exit_code(),
        Err(err) => {
            eprintln!("Error: {err:#}");
            ExitCode::from(1)
        }
    }
}

fn command_name_of(command: &Commands) -> &'static str {
    match command {
        Commands::Uninstall => "uninstall",
        Commands::Login(_) => "login",
        Commands::Logout => "logout",
        Commands::SetupAssistant => "setup-assistant",
        Commands::AiInstructions => "ai-instructions",
        Commands::Status(_) => "status",
        Commands::Grep(_) => "grep",
        Commands::TestHistory(_) => "test-history",
        Commands::SlowestTests(_) => "slowest-tests",
        Commands::SlowestJobs(_) => "slowest-jobs",
        Commands::Watch(_) => "watch",
        Commands::RunsList(_) => "runs",
        Commands::RunsShow(_) => "show",
        Commands::RunsLogs(_) => "logs",
        Commands::WorkflowsList(_) => "workflows",
        Commands::Setup => "setup",
        Commands::Init => "init",
        Commands::Telemetry(_) => "telemetry",
    }
}
```

Keep `dispatch` as written in Task 4.

Add near the top with the other imports:

```rust
use tracing;
```

(Not strictly necessary — `tracing::info_span!` is fully-qualified — but keeps the top-of-file imports honest.)

- [ ] **Step 2: Build**

Run: `cargo build -p everr-cli`
Expected: Clean build.

- [ ] **Step 3: Smoke test — run a command end-to-end without a collector**

Run: `cargo run -p everr-cli -- ai-instructions >/dev/null`
Expected: Command prints AI instructions to stdout (suppressed above). Exit code 0. A single stderr line `everr: trace export failed — is the Everr Desktop app running?` is acceptable if the collector is not running — that confirms the guard's drop path executed.

Run: `EVERR_TRACE=0 cargo run -p everr-cli -- ai-instructions >/dev/null`
Expected: No stderr hint about trace export failure (tracing disabled).

- [ ] **Step 4: Run existing tests**

Run: `cargo test -p everr-cli`
Expected: all pass.

- [ ] **Step 5: Commit checkpoint (ask user)**

Suggested message: `feat(cli): install trace subscriber and root span in main`.

---

## Task 8: Instrument CLI handlers with `#[tracing::instrument]`

Add `#[tracing::instrument(skip_all, fields(...))]` to every top-level command handler. `skip_all` is the default discipline; each function explicitly chooses which args to record as fields (never the full args struct, which may contain sensitive values).

**Files:**
- Modify: `packages/desktop-app/src-cli/src/core.rs`
- Modify: `packages/desktop-app/src-cli/src/auth.rs`
- Modify: `packages/desktop-app/src-cli/src/assistant.rs`
- Modify: `packages/desktop-app/src-cli/src/onboarding.rs`
- Modify: `packages/desktop-app/src-cli/src/init.rs`
- Modify: `packages/desktop-app/src-cli/src/uninstall.rs`
- Modify: `packages/desktop-app/src-cli/src/telemetry/commands.rs`

- [ ] **Step 1: Instrument `core.rs` handlers**

For each handler listed below, add the attribute directly above the `pub async fn` (or `pub fn`) signature. Field choices pick out small, safe, useful values.

```rust
#[tracing::instrument(skip_all, fields(repo = args.repo.as_deref().unwrap_or(""), branch = args.branch.as_deref().unwrap_or(""), commit = args.commit.as_deref().unwrap_or("")))]
pub async fn status(args: StatusArgs) -> Result<()> { ... }

#[tracing::instrument(skip_all, fields(repo = args.repo.as_deref().unwrap_or(""), pattern = %args.pattern, limit = args.limit))]
pub async fn grep(args: GrepArgs) -> Result<()> { ... }

#[tracing::instrument(skip_all, fields(repo = args.repo.as_deref().unwrap_or(""), branch = args.branch.as_deref().unwrap_or(""), commit = args.commit.as_deref().unwrap_or(""), fail_fast = args.fail_fast))]
pub async fn watch(args: WatchArgs) -> Result<()> { ... }

#[tracing::instrument(skip_all, fields(repo = args.repo.as_deref().unwrap_or(""), test_name = args.test_name.as_deref().unwrap_or(""), module = args.test_module.as_deref().unwrap_or(""), limit = args.limit))]
pub async fn test_history(args: TestHistoryArgs) -> Result<()> { ... }

#[tracing::instrument(skip_all, fields(repo = args.repo.as_deref().unwrap_or(""), branch = args.branch.as_deref().unwrap_or(""), limit = args.limit))]
pub async fn slowest_tests(args: SlowestTestsArgs) -> Result<()> { ... }

#[tracing::instrument(skip_all, fields(repo = args.repo.as_deref().unwrap_or(""), branch = args.branch.as_deref().unwrap_or(""), limit = args.limit))]
pub async fn slowest_jobs(args: SlowestJobsArgs) -> Result<()> { ... }

#[tracing::instrument(skip_all, fields(repo = args.repo.as_deref().unwrap_or(""), branch = args.branch.as_deref().unwrap_or(""), limit = args.limit, offset = args.offset))]
pub async fn runs_list(args: ListRunsArgs) -> Result<()> { ... }

#[tracing::instrument(skip_all, fields(trace_id = %args.trace_id, failed_only = args.failed))]
pub async fn runs_show(args: ShowRunArgs) -> Result<()> { ... }

#[tracing::instrument(skip_all, fields(trace_id = %args.trace_id, job_name = args.job_name.as_deref().unwrap_or(""), job_id = args.job_id.as_deref().unwrap_or(""), step_number = args.step_number.as_deref().unwrap_or(""), log_failed = args.log_failed))]
pub async fn runs_logs(args: GetLogsArgs) -> Result<CliExit> { ... }

#[tracing::instrument(skip_all, fields(repo = args.repo.as_deref().unwrap_or(""), branch = args.branch.as_deref().unwrap_or("")))]
pub async fn workflows_list(args: WorkflowsListArgs) -> Result<()> { ... }
```

Add `use tracing;` near the top of `core.rs` if it is not already present.

- [ ] **Step 2: Instrument `auth.rs`, `assistant.rs`, `onboarding.rs`, `init.rs`, `uninstall.rs`**

Add attributes to top-level handlers in each file. Concrete signatures and fields:

```rust
// auth.rs
#[tracing::instrument(skip_all)]
pub async fn login(_args: LoginArgs) -> anyhow::Result<()> { ... }

#[tracing::instrument(skip_all)]
pub fn logout() -> anyhow::Result<()> { ... }

// assistant.rs
#[tracing::instrument(skip_all)]
pub fn print_repo_instructions() { ... }

#[tracing::instrument(skip_all)]
pub fn print_ai_instructions() { ... }

// onboarding.rs
#[tracing::instrument(skip_all)]
pub async fn run() -> anyhow::Result<()> { ... }

// init.rs
#[tracing::instrument(skip_all)]
pub async fn run() -> anyhow::Result<()> { ... }

// uninstall.rs
#[tracing::instrument(skip_all)]
pub fn run_uninstall() -> anyhow::Result<()> { ... }
```

- [ ] **Step 3: Instrument `telemetry/commands.rs`**

Even though `main.rs` skips subscriber install for `Commands::Telemetry`, leave the handlers annotated for completeness. They cost nothing when no subscriber is active.

```rust
// telemetry/commands.rs
#[tracing::instrument(skip_all)]
pub fn run(args: TelemetryArgs) -> anyhow::Result<()> { ... }
```

(If there are per-subcommand helpers worth instrumenting, annotate them too with `skip_all, fields(...)`. Not required for correctness.)

- [ ] **Step 4: Build and test**

Run: `cargo build -p everr-cli`
Expected: Clean build. If a field expression doesn't compile (e.g., `args.field.as_deref()` on a non-Option), remove the field or switch to `%args.field`.

Run: `cargo test -p everr-cli`
Expected: all existing tests pass.

- [ ] **Step 5: Commit checkpoint (ask user)**

Suggested message: `feat(cli): instrument top-level handlers with tracing spans`.

---

## Task 9: Instrument everr-core ApiClient, auth, and state — with security discipline

**Bearer safety rule (repeat from spec):** Every `#[instrument]` that sees a `&Session`, `&AppState`, or any type holding a bearer `token` **must** use `skip_all` with an explicit `fields(...)` allowlist. Never rely on `Debug` capture.

**Files:**
- Modify: `crates/everr-core/src/api.rs`
- Modify: `crates/everr-core/src/auth.rs`
- Modify: `crates/everr-core/src/state.rs`

- [ ] **Step 1: Instrument `ApiClient::from_session`**

In `crates/everr-core/src/api.rs`, above `impl ApiClient { pub fn from_session(...) }`, add:

```rust
impl ApiClient {
    #[tracing::instrument(skip_all, fields(api_base_url = %session.api_base_url))]
    pub fn from_session(session: &Session) -> Result<Self> { ... }
```

Record `api_base_url` only. Do **not** record `session` or `token`.

- [ ] **Step 2: Instrument `build_http_client`, `build_auth_http_client`, and auth helpers**

In `crates/everr-core/src/auth.rs`:

```rust
#[tracing::instrument(skip_all)]
fn build_http_client() -> Result<reqwest_middleware::ClientWithMiddleware> { ... }

#[tracing::instrument(skip_all)]
pub fn build_auth_http_client() -> Result<reqwest_middleware::ClientWithMiddleware> { ... }
```

For any other `&Session` / `&reqwest_middleware::ClientWithMiddleware`-taking helpers that become useful to trace, annotate with `#[tracing::instrument(skip_all, fields(...))]` recording only safe fields.

- [ ] **Step 3: Instrument state filesystem helpers**

In `crates/everr-core/src/state.rs`:

```rust
impl AppStateStore {
    #[tracing::instrument(skip_all, fields(namespace = %self.namespace, state_file_name = %self.state_file_name))]
    pub fn load_state(&self) -> Result<AppState> { ... }

    #[tracing::instrument(skip_all, fields(namespace = %self.namespace))]
    pub fn load_session(&self) -> Result<Session> { ... }

    #[tracing::instrument(skip_all, fields(namespace = %self.namespace, expected = %expected_api_base_url))]
    pub fn load_session_for_api_base_url(&self, expected_api_base_url: &str) -> Result<Session> { ... }

    #[tracing::instrument(skip_all, fields(namespace = %self.namespace))]
    pub fn has_active_session(&self) -> Result<bool> { ... }

    // save_state / save_session / update_state / clear_session / wipe also
    // get skip_all with only namespace / path-metadata fields — never the
    // AppState or Session itself.
    #[tracing::instrument(skip_all, fields(namespace = %self.namespace))]
    pub fn save_session(&self, session: &Session) -> Result<()> { ... }
}
```

Apply the same pattern to the other methods as indicated in the comment. None of them may record `session`, `state`, or `token`.

- [ ] **Step 4: Build and run workspace tests**

Run: `cargo build --workspace`
Expected: Clean build.

Run: `cargo test --workspace`
Expected: all tests pass.

- [ ] **Step 5: Grep for bearer leaks**

Run the following grep over the final diff for this task to confirm no sensitive field is being recorded:

```
grep -n "session" crates/everr-core/src/state.rs crates/everr-core/src/auth.rs crates/everr-core/src/api.rs | grep instrument
```

Expected: No line shows a `session` or `token` field inside a `fields(...)` list.

- [ ] **Step 6: Commit checkpoint (ask user)**

Suggested message: `feat(core): instrument ApiClient, auth, and state with bearer-safe spans`.

---

## Task 10: Add ad-hoc spans around git shell-outs and render paths

**Files:**
- Modify: `packages/desktop-app/src-cli/src/core.rs`
- Modify: `crates/everr-core/src/git.rs` (if git helpers live there)

- [ ] **Step 1: Wrap git shell-outs**

In `crates/everr-core/src/git.rs`, `run_git` has the signature `pub fn run_git<const N: usize>(args: [&str; N], cwd: &Path) -> Option<String>` — a const-generic fixed-size array, not an `IntoIterator`. Do not rewrite the signature; just wrap the existing body in a span:

```rust
pub fn run_git<const N: usize>(args: [&str; N], cwd: &std::path::Path) -> Option<String> {
    let span = tracing::info_span!("git", args = ?args);
    let _entered = span.enter();
    // ... existing body unchanged ...
}
```

`args` is `Copy` here (it's an array of `&str`), so no clone is needed — `?args` formats it directly via `Debug`. If `use tracing;` is not already at the top of the file, add it. Confirm: `cargo build -p everr-core`.

- [ ] **Step 2: Wrap render paths in `core.rs`**

Find each handler's output-printing section (look for `writeln!`, `println!`, or helper fns like `print_step_logs`, `print_runs_table`, etc.). Wrap the final print block in a `render` span. Example for `runs_list`:

```rust
{
    let _s = tracing::info_span!("render").entered();
    print_runs_table(&runs)?;
}
```

Do the same for `runs_show`, `runs_logs`, `grep`, `status`, `test_history`, `slowest_tests`, `slowest_jobs`, `workflows_list`, and `watch`'s final render (if it has one).

- [ ] **Step 3: Build**

Run: `cargo build -p everr-cli`
Expected: Clean build.

- [ ] **Step 4: Commit checkpoint (ask user)**

Suggested message: `feat(cli): add ad-hoc spans around git shell-outs and render paths`.

---

## Task 11: Targeted eprintln → tracing migrations

Convert diagnostic messages that aren't part of the CLI's user-facing output contract to `tracing::warn!`/`error!`/`info!` so they appear as linked log records on the traced run.

**Files:**
- Modify: `packages/desktop-app/src-cli/src/auth.rs` (reauth retry messages)
- Modify: `packages/desktop-app/src-cli/src/telemetry/commands.rs` (stale-sibling banner, missing-dir hint)
- Modify: `crates/everr-core/src/auth.rs` and/or `crates/everr-core/src/api.rs` (HTTP 5xx retry messages, if present)
- Modify: `crates/everr-core/src/git.rs` (git shell-out failure messages)

For each file, find `eprintln!` or `println!` calls that print diagnostic status (not command output). Typical phrasing: "retrying...", "warning:", "failed to...", "ignoring...". Replace:

```rust
eprintln!("some diagnostic message: {err}");
```

with the appropriate level:

```rust
tracing::warn!(error = %err, "some diagnostic message");
```

`info!` for informational steps. `warn!` for recoverable issues. `error!` for failures that bubble up. Keep the exact phrasing consistent with what users currently see on stderr, since developers may grep for it.

Leave untouched: anything that is the CLI's primary output (render tables, `println!` of logs, command-result printing) — those remain `println!`/`writeln!`.

- [ ] **Step 1: Grep for candidate sites**

```
grep -n "eprintln!" packages/desktop-app/src-cli/src crates/everr-core/src
```

For each hit, decide: is this a diagnostic (migrate) or part of CLI output (leave)?

- [ ] **Step 2: Migrate diagnostic call sites**

Apply the pattern above. Add `use tracing;` at the top of any file that gains `tracing::` calls but doesn't already have the import.

- [ ] **Step 3: Build and test**

Run: `cargo build --workspace`
Run: `cargo test --workspace`
Expected: All green. Tests that assert exact stderr output may need updates if their matched text moves from stderr to the log bridge. Address on a case-by-case basis — prefer to loosen the assertion rather than keep the `eprintln!`.

- [ ] **Step 4: Commit checkpoint (ask user)**

Suggested message: `refactor: migrate diagnostic eprintlns to tracing events`.

---

## Task 12: Expose CLI as a library and add the export integration test

Prove that `trace_init::init_with_endpoint` actually posts OTLP payloads to the configured URL. This requires the CLI to be reachable as a library from `tests/*.rs`.

**Layout decision:** Make `lib.rs` the source of truth for the module tree and have `main.rs` be a thin shim that calls `everr_cli::run()`. This avoids compiling the module tree twice (once as part of the bin, once as part of the lib) and avoids `OnceLock`/`static` duplication between the two crates.

**Files:**
- Modify: `packages/desktop-app/src-cli/Cargo.toml`
- Create: `packages/desktop-app/src-cli/src/lib.rs`
- Modify: `packages/desktop-app/src-cli/src/main.rs`
- Create: `packages/desktop-app/src-cli/tests/tracing_export.rs`

- [ ] **Step 1: Add `mockito` dev-dep check**

Confirm `mockito` is in `[dev-dependencies]` in `packages/desktop-app/src-cli/Cargo.toml`. If absent, add `mockito = "1"`.

- [ ] **Step 2: Add the `[lib]` target**

In `packages/desktop-app/src-cli/Cargo.toml`, add (keeping the existing `[[bin]]` entry):

```toml
[lib]
name = "everr_cli"
path = "src/lib.rs"
```

- [ ] **Step 3: Move module declarations + run loop into `lib.rs`**

Create `packages/desktop-app/src-cli/src/lib.rs` with the module tree and the former `main` body, renamed to `run`:

```rust
pub mod api;
pub mod assistant;
pub mod auth;
pub mod cli;
pub mod core;
pub mod exit_code;
pub mod init;
pub mod onboarding;
pub mod telemetry;
pub mod uninstall;

use std::process::ExitCode;

use clap::Parser;

use cli::{Cli, Commands};
use exit_code::CliExit;

pub async fn run() -> ExitCode {
    let cli = Cli::parse();
    let command_name = command_name_of(&cli.command);

    let guard = match cli.command {
        Commands::Telemetry(_) => None,
        _ => telemetry::trace_init::init(command_name),
    };

    let result: anyhow::Result<CliExit> = {
        let root = tracing::info_span!("everr", "everr.command" = %command_name);
        let _entered = root.enter();
        dispatch(cli).await
    };

    drop(guard);

    match result {
        Ok(exit) => exit.to_exit_code(),
        Err(err) => {
            eprintln!("Error: {err:#}");
            ExitCode::from(1)
        }
    }
}

async fn dispatch(cli: Cli) -> anyhow::Result<CliExit> {
    // ... same body as Task 4 Step 4 ...
}

fn command_name_of(command: &Commands) -> &'static str {
    // ... same body as Task 7 Step 1 ...
}
```

Replace `packages/desktop-app/src-cli/src/main.rs` with a thin shim:

```rust
use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    everr_cli::run().await
}
```

Confirm: `cargo build -p everr-cli` still produces the `everr` binary, and the binary and lib now share the same module tree (no duplicate compilation).

- [ ] **Step 4: Write the export integration test**

Create `packages/desktop-app/src-cli/tests/tracing_export.rs`:

```rust
use everr_cli::telemetry::trace_init;
use mockito::Matcher;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn init_with_endpoint_exports_spans_on_shutdown() {
    let mut server = mockito::Server::new_async().await;

    let _traces_mock = server
        .mock("POST", "/v1/traces")
        .match_header("content-type", Matcher::Any)
        .with_status(200)
        .with_body("")
        .expect_at_least(1)
        .create_async()
        .await;

    let _logs_mock = server
        .mock("POST", "/v1/logs")
        .with_status(200)
        .with_body("")
        .expect_at_least(0)
        .create_async()
        .await;

    // Force gate on via explicit param — no env mutation, no unsafe.
    let guard = trace_init::init_with_endpoint(&server.url(), "integration-test", Some("1"))
        .expect("trace subscriber installs");

    {
        let s = tracing::info_span!("integration-span", "everr.command" = "test");
        let _e = s.enter();
        tracing::info!("hello from test");
    }

    drop(guard);
    // Mockito's drop-time verification fails the test if `expect_at_least(1)`
    // for /v1/traces was not met.
}
```

- [ ] **Step 5: Run the export test**

Run: `cargo test -p everr-cli --test tracing_export`
Expected: Passes. The mockito server received at least one POST to `/v1/traces` when the guard dropped.

- [ ] **Step 6: Commit checkpoint (ask user)**

Suggested message: `test(cli): add integration test asserting OTLP exporter posts spans on shutdown`.

---

## Task 13: Integration test — gate-off suppresses all exports

Put this test in its own file so it runs in a separate test binary with a fresh `OnceLock` — no interference with the Task 12 test's subscriber install.

**Files:**
- Create: `packages/desktop-app/src-cli/tests/tracing_gate_off.rs`

- [ ] **Step 1: Write the gate-off test in a dedicated file**

Create `packages/desktop-app/src-cli/tests/tracing_gate_off.rs`:

```rust
use everr_cli::telemetry::trace_init;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn explicit_off_installs_nothing() {
    let mut server = mockito::Server::new_async().await;
    let _mock = server
        .mock("POST", "/v1/traces")
        .with_status(200)
        .expect(0)
        .create_async()
        .await;

    // Explicit gate off via the env_override parameter — no env mutation.
    let guard = trace_init::init_with_endpoint(&server.url(), "off-test", Some("0"));
    assert!(guard.is_none(), "gate-off must return None");

    drop(guard);
    // Mockito drop verification asserts zero hits on /v1/traces.
}
```

Rationale for the separate file: each `tests/*.rs` file is compiled into its own integration-test binary, so the `OnceLock<()>` that guards subscriber init starts fresh per file. Keeping the two tests in one file would make test-ordering load-bearing.

- [ ] **Step 2: Run both test binaries**

Run: `cargo test -p everr-cli --test tracing_export --test tracing_gate_off`
Expected: Both pass.

- [ ] **Step 3: Commit checkpoint (ask user)**

Suggested message: `test(cli): add integration test for gate-off suppression`.

---

## Task 14: Integration test — runs_logs egrep-no-match still exits 1 cleanly

**Files:**
- Modify: `packages/desktop-app/src-cli/tests/` (probably append to an existing integration test file that already exercises CLI binary behavior via `assert_cmd`).

- [ ] **Step 1: Locate the existing `assert_cmd`-based integration tests**

```
grep -rln "assert_cmd" packages/desktop-app/src-cli/tests
```

If a file already exercises `runs_logs` via the CLI binary, append there. Otherwise create `packages/desktop-app/src-cli/tests/logs_nomatch_exit.rs`.

- [ ] **Step 2: Add the no-match exit test**

Using `assert_cmd` patterns already in the codebase, add a test that:

- Stands up a mockito server returning a logs response with entries that won't match the egrep pattern.
- Builds a session pointing at the mockito URL (reuse whatever harness the existing tests use to inject a fake session).
- Runs `everr logs <trace-id> --job-name <name> --step-number 1 --egrep 'xxxxxxxxxxx-never-matches'`.
- Asserts the process exits with code 1.

Exact test code depends on the existing harness; follow the same conventions as neighboring integration tests. The new assertion is simply: `.failure().code(1)`.

- [ ] **Step 3: Run**

Run: `cargo test -p everr-cli` (the specific test or the whole suite).
Expected: Passes. If a pre-existing test already asserts exit 1 for this case, it should still pass after the `ExitCode` refactor in Task 4 — this task is partly about verifying that.

- [ ] **Step 4: Commit checkpoint (ask user)**

Suggested message: `test(cli): verify runs_logs egrep-no-match exits 1 via ExitCode path`.

---

## Task 15: Manual verification against a running sidecar

Automated tests exercise the export pipeline against mockito. The last sanity check exercises the real collector.

- [ ] **Step 1: Start the Everr Desktop app** (or run `cargo tauri dev` in `packages/desktop-app`) so the sidecar's collector is up at `http://127.0.0.1:54318`.

- [ ] **Step 2: Run a traced debug build**

```
cargo run -p everr-cli -- status
```

Expected: Command runs. No stderr hint about trace export failure.

- [ ] **Step 3: Query the spans**

```
cargo run -p everr-cli -- telemetry traces --service everr-cli --attr everr.command=status --limit 1
```

Expected: A root span `everr`, a child `core::status` span, at least one HTTP span with `http.response.status_code` attr, and no span or log attribute anywhere containing a bearer-looking string (`Bearer …`, or the raw token).

- [ ] **Step 4: Query the logs**

```
cargo run -p everr-cli -- telemetry logs --service everr-cli --trace-id <root-trace-id>
```

Expected: Log records whose `trace_id` matches. May be empty if the traced run emitted no migrated `tracing::info!`/`warn!` events — that is still a passing signal because it confirms the bridge is not erroring.

- [ ] **Step 5: Verify gate-off**

```
EVERR_TRACE=0 cargo run -p everr-cli -- status
cargo run -p everr-cli -- telemetry traces --service everr-cli --limit 1 --from now-10s
```

Expected: The second query returns nothing from the last 10 seconds (no new CLI spans from the gate-off run).

- [ ] **Step 6: Verify telemetry-subcommand suppression**

```
cargo run -p everr-cli -- telemetry traces --limit 1
cargo run -p everr-cli -- telemetry traces --service everr-cli --limit 1 --from now-10s
```

Expected: The second query does not return a span for the first `telemetry traces` invocation — proof that the subscriber was never installed for that command.

- [ ] **Step 7: Final commit checkpoint (ask user)**

If everything above passed: suggested final message `docs(plans): mark cli local tracing implementation complete` or similar — but the user may prefer to squash/edit commits at this point.

---

## Self-review checklist (run after executing the plan, before the final review)

- Spec coverage: every section in `docs/superpowers/specs/2026-04-15-cli-local-tracing-design.md` maps to at least one Task above.
    - Architecture, gate, subscriber init → Tasks 5, 6, 7.
    - `CliExit` / ExitCode refactor → Task 4.
    - Instrumentation map (CLI + everr-core) → Tasks 8, 9, 10.
    - HTTP middleware → Task 3.
    - Logs appender + targeted migrations → Tasks 6 (bridge wiring), 11 (migrations).
    - Shutdown + failure modes → Task 6 (`TraceGuard::drop`, `EXPORT_FAILURE_HINT`).
    - Dependencies → Tasks 1, 2.
    - Testing → Tasks 12, 13, 14, 15.
- No placeholders: search the plan for `TBD`, `TODO`, `implement later`. Expected: none.
- Type consistency: `CliExit` appears identically in Tasks 4, 8, and 5 (core.rs), and so do `TraceGuard`, `init`, `init_with_endpoint`.
- Bearer safety: Tasks 8 and 9 both call out `skip_all`; Task 9 includes a grep check.

---

## Out of scope (do not implement in this plan)

- OTLP metrics pipeline.
- `traceparent` propagation from CLI to the backend API (follow-up).
- Converting CLI user-facing `println!` output to `tracing::` calls.
