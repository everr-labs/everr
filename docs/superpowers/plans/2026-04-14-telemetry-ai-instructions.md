# Telemetry AI Instructions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate `everr telemetry` into the assistant-discovery surface so AI assistants know when and how to query local OTel traces/logs, both via `setup-assistant`-managed blocks and via `everr telemetry ai-instructions`.

**Architecture:** Add a new asset `telemetry-instructions.md` rendered by a new function in `everr_core::assistant`, wire a `telemetry ai-instructions` clap subcommand, extend the existing `discovery-instructions.md` with a pointer line, and publish a user-facing docs page. Single source of truth for the full body: the CLI asset. Docs-sync test guards the short discovery line against drift.

**Tech Stack:** Rust (everr-core, src-cli, clap), Markdown (assets, docs), Fumadocs (`packages/docs`).

**Spec:** `docs/superpowers/specs/2026-04-14-telemetry-ai-instructions-design.md`

**Commit policy:** Do **not** run `git commit` automatically. At the end of each task, stop and let the user decide when to commit. If the user asks you to commit, do it then.

---

## File map

**Create:**
- `crates/everr-core/assets/telemetry-instructions.md` — generic body for `everr telemetry ai-instructions`
- `packages/docs/content/docs/cli/telemetry.mdx` — user-facing docs page
- `crates/everr-core/tests/docs_sync.rs` — cross-package docs sync test

**Modify:**
- `crates/everr-core/src/assistant.rs` — add `render_telemetry_ai_instructions()`, re-export from `lib.rs`
- `crates/everr-core/assets/discovery-instructions.md` — append telemetry pointer line
- `packages/desktop-app/src-cli/src/cli.rs` — add `TelemetrySubcommand::AiInstructions` variant
- `packages/desktop-app/src-cli/src/telemetry/commands.rs` — dispatch new variant
- `packages/desktop-app/src-cli/tests/telemetry_commands.rs` — test the new subcommand
- `packages/desktop-app/src-cli/tests/assistant_commands.rs` — assert telemetry pointer appears in setup-assistant output
- `packages/docs/content/docs/cli/meta.json` — register the new page

---

## Task 1: Add telemetry ai-instructions asset and render function

**Files:**
- Create: `crates/everr-core/assets/telemetry-instructions.md`
- Modify: `crates/everr-core/src/assistant.rs`
- Modify: `crates/everr-core/src/lib.rs` (if `render_telemetry_ai_instructions` needs to be re-exported at crate root — check current pattern first)

- [ ] **Step 1: Create the telemetry instructions asset**

Create `crates/everr-core/assets/telemetry-instructions.md` with this exact content:

```
Use Everr telemetry when debugging a locally running OpenTelemetry-instrumented
service or app — investigate runtime behavior, errors, slow requests/interactions,
or verify that instrumentation changes produce the expected spans/logs. Data is
sourced from OTLP JSON files the local collector writes to disk; it exists only
while the service that emits it is running.

Commands:
- `everr telemetry traces`: recent traces as a tree view, newest first
  - `--from <date-math>` (default now-1h) / `--to <date-math>`: time window
    (e.g. now-10m, now-1h, now-7d/d)
  - `--name <pattern>`: substring match on span name; matches are highlighted
  - `--service <name>`: filter by `service.name` resource attribute
  - `--trace-id <id>`: inspect one trace end-to-end
  - `--attr <key=value>`: filter by OTLP attribute; repeatable
  - `--limit <n>` (default 50)
- `everr telemetry logs`: recent log records as a table
  - `--from <date-math>` (default now-1h) / `--to <date-math>`
  - `--level <DEBUG|INFO|WARN|ERROR>`: filter by severity
  - `--target <name>`: filter by tracing target / scope
  - `--service <name>`: filter by `service.name` resource attribute
  - `--egrep <regex>`: re2 regex filter on the message
  - `--trace-id <id>`: logs correlated to a specific trace
  - `--attr <key=value>`: repeatable
  - `--limit <n>` (default 200)
  - `--format <table|json>` (default table)

Investigation playbook:
- Start broad, then narrow: use the default `now-1h` window first, then add
  `--service`, `--target`, or `--name` once you know where to look.
- Use `logs` for *what* happened, `traces` for *why it was slow* or how a
  request flowed.
- Pivot from a log to its trace: copy the `trace_id` from `logs --format json`
  and pass it to `traces --trace-id <id>` for the full causal tree.
- If results are empty, check the "newest file age" line in the output — a
  stale or missing file means the emitting service isn't running or isn't
  pointed at the local collector.

After modifying instrumented code, verify the change landed:
- Trigger the code path you edited in the running service
- `everr telemetry logs --from now-2m --target <module>` to confirm new log output
- `everr telemetry traces --from now-2m --service <service.name> --name <span>`
  to confirm new or changed spans
- Don't claim "verified" unless the returned rows reflect the code you just
  edited (timestamps within the window, attribute values that match the change).
```

- [ ] **Step 2: Write a failing unit test for `render_telemetry_ai_instructions`**

In `crates/everr-core/src/assistant.rs`, append at the bottom of the existing `#[cfg(test)] mod tests { … }` block (find where `render_discovery_instructions` tests live — add alongside):

```rust
#[test]
fn telemetry_ai_instructions_includes_both_commands_and_playbook() {
    let rendered = render_telemetry_ai_instructions();
    assert!(rendered.contains("everr telemetry traces"));
    assert!(rendered.contains("everr telemetry logs"));
    assert!(rendered.contains("Investigation playbook:"));
    assert!(rendered.contains("After modifying instrumented code"));
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test -p everr-core assistant::tests::telemetry_ai_instructions_includes_both_commands_and_playbook`

Expected: FAIL — `render_telemetry_ai_instructions` is undefined.

- [ ] **Step 4: Add the constant and function**

In `crates/everr-core/src/assistant.rs`, next to the existing `DISCOVERY_INSTRUCTIONS` constant (~line 10):

```rust
const TELEMETRY_INSTRUCTIONS: &str = include_str!("../assets/telemetry-instructions.md");
```

Next to the existing `render_discovery_instructions` (~line 263):

```rust
pub fn render_telemetry_ai_instructions() -> &'static str {
    TELEMETRY_INSTRUCTIONS
}
```

- [ ] **Step 5: Re-export if needed**

Check `crates/everr-core/src/lib.rs` — if other `assistant::render_*` functions are re-exported, follow the same pattern. If the module is just `pub mod assistant;`, no change needed.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cargo test -p everr-core assistant::tests::telemetry_ai_instructions_includes_both_commands_and_playbook`

Expected: PASS.

- [ ] **Step 7: Run the full everr-core test suite to confirm nothing else broke**

Run: `cargo test -p everr-core`

Expected: all tests pass.

- [ ] **Step 8: Stop. Let the user decide whether to commit.**

---

## Task 2: Wire the `everr telemetry ai-instructions` subcommand

**Files:**
- Modify: `packages/desktop-app/src-cli/src/cli.rs` (the `TelemetrySubcommand` enum ~line 77)
- Modify: `packages/desktop-app/src-cli/src/telemetry/commands.rs` (the `run` function ~line 19)
- Modify: `packages/desktop-app/src-cli/tests/telemetry_commands.rs`

- [ ] **Step 1: Write the failing integration test**

Append to `packages/desktop-app/src-cli/tests/telemetry_commands.rs`:

```rust
#[test]
fn telemetry_ai_instructions_prints_full_guidance() {
    let env = support::CliTestEnv::new();
    env.command()
        .args(["telemetry", "ai-instructions"])
        .assert()
        .success()
        .stdout(predicate::str::contains("everr telemetry traces"))
        .stdout(predicate::str::contains("everr telemetry logs"))
        .stdout(predicate::str::contains("Investigation playbook:"))
        .stdout(predicate::str::contains("After modifying instrumented code"));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p everr-cli --test telemetry_commands telemetry_ai_instructions_prints_full_guidance`

Expected: FAIL — clap reports `ai-instructions` is not a valid `telemetry` subcommand.

- [ ] **Step 3: Add the clap variant**

In `packages/desktop-app/src-cli/src/cli.rs`, modify `TelemetrySubcommand` (~line 77):

```rust
#[derive(Subcommand, Debug)]
pub enum TelemetrySubcommand {
    /// Show recent spans
    Traces(TelemetryQueryArgs),
    /// Show recent log records
    Logs(TelemetryLogsArgs),
    /// Print AI-oriented guidance for `everr telemetry`
    #[command(name = "ai-instructions")]
    AiInstructions,
}
```

- [ ] **Step 4: Dispatch the new variant**

In `packages/desktop-app/src-cli/src/telemetry/commands.rs`, modify `run` (~line 19):

```rust
pub fn run(args: TelemetryArgs) -> Result<()> {
    match args.command {
        TelemetrySubcommand::Traces(q) => run_traces(q),
        TelemetrySubcommand::Logs(q) => run_logs(q),
        TelemetrySubcommand::AiInstructions => run_ai_instructions(),
    }
}

fn run_ai_instructions() -> Result<()> {
    print!("{}", everr_core::assistant::render_telemetry_ai_instructions());
    Ok(())
}
```

(If `everr_core::assistant::render_telemetry_ai_instructions` is not directly visible, confirm the re-export pattern from Task 1 step 5. The function lives in `everr_core::assistant` by default.)

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `cargo test -p everr-cli --test telemetry_commands telemetry_ai_instructions_prints_full_guidance`

Expected: PASS.

- [ ] **Step 6: Run the full telemetry test suite to confirm no regression**

Run: `cargo test -p everr-cli --test telemetry_commands`

Expected: all tests pass.

- [ ] **Step 7: Sanity check the CLI end-to-end**

Run: `cargo run -p everr-cli --bin everr -- telemetry ai-instructions | head -5`

Expected: prints the first lines of the body starting with `Use Everr telemetry when debugging a locally running OpenTelemetry-instrumented`.

- [ ] **Step 8: Stop. Let the user decide whether to commit.**

---

## Task 3: Extend the discovery instructions with the telemetry pointer

**Files:**
- Modify: `crates/everr-core/assets/discovery-instructions.md`
- Modify: `packages/desktop-app/src-cli/tests/assistant_commands.rs`

- [ ] **Step 1: Write the failing test in `assistant_commands.rs`**

In `packages/desktop-app/src-cli/tests/assistant_commands.rs`, extend the existing `setup_assistant_prints_repo_instructions` test (~line 13). Replace its body with:

```rust
#[test]
fn setup_assistant_prints_repo_instructions() {
    let env = CliTestEnv::new();

    env.command()
        .arg("setup-assistant")
        .assert()
        .success()
        .stdout(contains("call `everr ai-instructions` for full usage."))
        .stdout(contains("`everr status`"))
        .stdout(contains("call `everr telemetry ai-instructions` for full usage."))
        .stdout(contains("OpenTelemetry"));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p everr-cli --test assistant_commands setup_assistant_prints_repo_instructions`

Expected: FAIL — the telemetry pointer substring is not present in the existing discovery output.

- [ ] **Step 3: Append the pointer line to the discovery asset**

Current content of `crates/everr-core/assets/discovery-instructions.md`:

```
For CI, GitHub Actions, pipelines, workflow logs, or test performance tasks: call `everr ai-instructions` for full usage.

Quick start — run `everr status` to get the current commit's pipeline state while you plan your next steps.
```

Replace with:

```
For CI, GitHub Actions, pipelines, workflow logs, or test performance tasks: call `everr ai-instructions` for full usage.

For debugging a locally running service or app that emits OpenTelemetry — investigating runtime behavior, errors, slow requests/interactions, or verifying that instrumentation changes produce the expected spans/logs: call `everr telemetry ai-instructions` for full usage.

Quick start — run `everr status` to get the current commit's pipeline state while you plan your next steps.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p everr-cli --test assistant_commands setup_assistant_prints_repo_instructions`

Expected: PASS.

- [ ] **Step 5: Run the full assistant test suite to confirm no regression**

Run: `cargo test -p everr-cli --test assistant_commands`

Expected: all tests pass.

- [ ] **Step 6: Run the existing everr-core assistant tests**

The `discovery-instructions.md` asset is `include_str!`'d by `everr-core`. Confirm no existing test there pinned the exact content length or hashed the string.

Run: `cargo test -p everr-core assistant`

Expected: all tests pass. If any existing test asserts exact content, update it to accept the new line.

- [ ] **Step 7: Stop. Let the user decide whether to commit.**

---

## Task 4: Publish the user-facing docs page

**Files:**
- Create: `packages/docs/content/docs/cli/telemetry.mdx`
- Modify: `packages/docs/content/docs/cli/meta.json`

- [ ] **Step 1: Create the docs page**

Create `packages/docs/content/docs/cli/telemetry.mdx` with the following content:

````mdx
---
title: Telemetry
description: Query local OpenTelemetry traces and logs written by the Everr Desktop collector.
---

## Overview

The Everr Desktop app runs a local OpenTelemetry Collector as a Tauri sidecar that receives OTLP over gRPC (`:4317`) and HTTP (`:4318`), writing newline-delimited JSON files to disk. The `everr telemetry` commands read those files — no daemon, no network, no database.

Any locally running service or app you instrument with OpenTelemetry and point at the local collector will be visible to these commands.

## Commands

### `everr telemetry traces`

Shows recent traces as a tree, newest first.

```shell
everr telemetry traces --from now-10m --limit 5
```

Useful flags:

- `--from <date-math>` (default `now-1h`) / `--to <date-math>`
- `--name <pattern>` — substring match on span name
- `--service <name>` — filter by `service.name`
- `--trace-id <id>` — inspect one trace end-to-end
- `--attr key=value` — OTLP attribute filter (repeatable)
- `--limit <n>` (default 50)

### `everr telemetry logs`

Shows recent log records in a table.

```shell
everr telemetry logs --from now-10m --level WARN
```

Useful flags:

- `--from` / `--to` as above
- `--level <DEBUG|INFO|WARN|ERROR>`
- `--target <name>` — tracing target / scope
- `--service <name>`
- `--egrep <regex>` — re2 regex on the message
- `--trace-id <id>` — logs correlated to a specific trace
- `--attr key=value` — repeatable
- `--limit <n>` (default 200)
- `--format <table|json>` (default `table`)

### Pivoting between logs and traces

Find a log of interest, grab its `trace_id` from JSON output, and pass it to `traces`:

```shell
everr telemetry logs --level ERROR --format json --limit 1
everr telemetry traces --trace-id <id>
```

## AI assistant integration

`everr telemetry ai-instructions` prints the full usage guide in a format optimized for AI assistants. There are two ways to make your assistant discover it.

### Automatic (recommended)

```shell
everr setup-assistant
```

This writes a managed block to your project's `AGENTS.md` or `CLAUDE.md` containing both the CI and telemetry pointers.

### Manual

If you manage your `AGENTS.md` / `CLAUDE.md` by hand, add this block:

<!-- AI_INTEGRATION_SNIPPET_START -->
```markdown
For debugging a locally running service or app that emits OpenTelemetry — investigating runtime behavior, errors, slow requests/interactions, or verifying that instrumentation changes produce the expected spans/logs: call `everr telemetry ai-instructions` for full usage.
```
<!-- AI_INTEGRATION_SNIPPET_END -->

The full body is intentionally not duplicated here — run `everr telemetry ai-instructions` to see what your assistant will read.
````

- [ ] **Step 2: Register the page in `meta.json`**

Current content of `packages/docs/content/docs/cli/meta.json`:

```json
{
  "title": "CLI",
  "pages": ["index", "commands"]
}
```

Replace with:

```json
{
  "title": "CLI",
  "pages": ["index", "commands", "telemetry"]
}
```

- [ ] **Step 3: Verify the docs build picks up the new page**

Run: `pnpm --filter docs build` (or `pnpm --filter @everr/docs build` depending on package name — check `packages/docs/package.json`).

Expected: build succeeds and emits a `telemetry` page route.

If the docs package uses a dev server instead of a separate build script, run `pnpm --filter docs dev` and visit `http://localhost:3000/docs/cli/telemetry` to confirm rendering.

- [ ] **Step 4: Stop. Let the user decide whether to commit.**

---

## Task 5: Add the docs-sync test

**Files:**
- Create: `crates/everr-core/tests/docs_sync.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/everr-core/tests/docs_sync.rs`:

```rust
//! Guards cross-package drift between the discovery instructions shipped
//! with the CLI (`everr_core::assistant`) and the Manual-integration snippet
//! in the docs site (`packages/docs/content/docs/cli/telemetry.mdx`).

use std::fs;
use std::path::PathBuf;

use everr_core::assistant::render_discovery_instructions;

const SNIPPET_START: &str = "<!-- AI_INTEGRATION_SNIPPET_START -->";
const SNIPPET_END: &str = "<!-- AI_INTEGRATION_SNIPPET_END -->";

#[test]
fn docs_manual_snippet_matches_discovery_telemetry_line() {
    let telemetry_line = render_discovery_instructions()
        .lines()
        .find(|line| line.contains("everr telemetry ai-instructions"))
        .expect("discovery instructions should contain the telemetry pointer line");

    let docs_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/docs/content/docs/cli/telemetry.mdx");
    let docs = fs::read_to_string(&docs_path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", docs_path.display()));

    let start = docs
        .find(SNIPPET_START)
        .expect("docs page should contain AI_INTEGRATION_SNIPPET_START marker");
    let end = docs
        .find(SNIPPET_END)
        .expect("docs page should contain AI_INTEGRATION_SNIPPET_END marker");
    assert!(start < end, "snippet markers out of order");

    let snippet = &docs[start + SNIPPET_START.len()..end];
    assert!(
        snippet.contains(telemetry_line.trim()),
        "\nDocs manual snippet missing the current telemetry discovery line.\n\
         Expected substring:\n  {}\n\n\
         Snippet block was:\n{}\n",
        telemetry_line.trim(),
        snippet
    );
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cargo test -p everr-core --test docs_sync`

Expected: PASS — Tasks 3 and 4 already produced matching content.

- [ ] **Step 3: Deliberately break the sync to verify the test catches drift**

Temporarily edit `crates/everr-core/assets/discovery-instructions.md` to change a word in the telemetry line (e.g., change "OpenTelemetry" to "OpenTelemetryX").

Run: `cargo test -p everr-core --test docs_sync`

Expected: FAIL — test reports the docs snippet no longer contains the current line.

- [ ] **Step 4: Revert the deliberate break**

Restore `crates/everr-core/assets/discovery-instructions.md` to the Task 3 final state.

Run: `cargo test -p everr-core --test docs_sync`

Expected: PASS.

- [ ] **Step 5: Run the full workspace test suite one last time**

Run: `cargo test` (from the repo root, or scope as appropriate — e.g. `cargo test -p everr-core && cargo test -p everr-cli`).

Expected: all tests pass.

- [ ] **Step 6: Stop. Let the user decide whether to commit.**

---

## Post-implementation checks

Before handing back to the user, confirm:

- `cargo test -p everr-core` passes
- `cargo test -p everr-cli` passes
- `cargo run -p everr-cli --bin everr -- setup-assistant` prints both the CI and telemetry pointer lines
- `cargo run -p everr-cli --bin everr -- telemetry ai-instructions` prints the full body (first line: `Use Everr telemetry when debugging a locally running OpenTelemetry-instrumented`)
- The docs page renders (either via build or dev server)

No release/distribution changes are required — `everr setup-assistant` updates existing users' managed blocks automatically on next invocation.
