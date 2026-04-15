# Design: assistant instructions for `everr telemetry`

## Problem

PR #69 adds `everr telemetry traces` and `everr telemetry logs` — CLI commands that read OTLP JSON files written by the local collector sidecar. The commands are useful beyond the everr codebase itself: any locally running service or app emitting OpenTelemetry to the collector can be debugged with them.

Today, AI assistants have no way to discover these commands. The existing discovery mechanism — `everr setup-assistant` writing a managed block into `AGENTS.md` / `CLAUDE.md` — only mentions the CI-facing `everr ai-instructions`. We need a parallel path for telemetry that works for the wide audience of downstream users, not just everr developers.

## Goals

- AI assistants reach for `everr telemetry` in two situations:
  1. **Symptom-driven** — the user describes runtime behavior that on-disk telemetry can answer (slow interactions, errors, "did X fire").
  2. **Proactive verification** — after an assistant edits OTel-instrumented code, it checks recent telemetry to confirm the change landed.
- Content is generic and audience-neutral — no assumption that the reader is in the everr repo.
- Single source of truth: CLI command output. Docs point at the CLI; `setup-assistant` injects a pointer. No duplicated prose that can drift.

## Non-goals

- Changing the telemetry query engine, collector, or on-disk format.
- Auto-detecting OTel instrumentation before injecting the hint. Start unconditional; add detection later if noise becomes a problem.
- Distributing instructions to agents other than those that read `AGENTS.md` / `CLAUDE.md`. Other assistants can consult the docs page.

## Architecture

Four touchpoints:

1. **`everr_core::assistant::render_discovery_instructions()`** — extend to append one new line alongside the existing CI pointer. `setup-assistant` injects it into downstream `AGENTS.md` / `CLAUDE.md` on next run.

2. **`everr_core::assistant::render_telemetry_ai_instructions()`** *(new)* — returns the generic body printed by `everr telemetry ai-instructions`.

3. **`src-cli` wiring** — new `TelemetryCommands::AiInstructions` variant in `packages/desktop-app/src-cli/src/telemetry/mod.rs` and the clap parser, dispatching to `render_telemetry_ai_instructions()`.

4. **`packages/docs/content/docs/cli/telemetry.mdx`** *(new)* — user-facing documentation plus a copy-paste snippet for users who skip `setup-assistant` and edit their `AGENTS.md` / `CLAUDE.md` manually.

No changes to the collector, `telemetry::sidecar`, `telemetry::bridge`, or the query engine (`otlp.rs`, `query.rs`).

## Content

### Discovery line (appended to `render_discovery_instructions()`)

> For debugging a locally running service or app that emits OpenTelemetry — investigating runtime behavior, errors, slow requests/interactions, or verifying that instrumentation changes produce the expected spans/logs: call `everr telemetry ai-instructions` for full usage.

Sits as a sibling to the existing CI line. Order: CI first, telemetry second.

### Body (printed by `everr telemetry ai-instructions`)

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

## Docs page: `packages/docs/content/docs/cli/telemetry.mdx`

Sections:

- **Overview** — one paragraph on the local collector and what telemetry the CLI queries.
- **Commands** — `traces`, `logs`, with example output (reuse snippets from PR #69 description).
- **Filtering & time windows** — brief notes on date-math, `--attr`, `--trace-id` pivots.
- **AI assistant integration**
  - *Automatic (recommended)* → run `everr setup-assistant`.
  - *Manual* → copy-paste block with the discovery line + note to run `everr telemetry ai-instructions` to see the full body.

The full body is intentionally **not** duplicated in the docs — the CLI is the source of truth.

## Testing

Three narrow tests:

1. **`packages/desktop-app/src-cli/tests/telemetry_commands.rs`** — extend: `everr telemetry ai-instructions` exits 0, output is non-empty and contains `everr telemetry traces` and `everr telemetry logs`.

2. **`packages/desktop-app/src-cli/tests/assistant_commands.rs`** — extend: `everr setup-assistant` output contains the new telemetry discovery line substring.

3. **Docs sync test** — a `#[test]` in `crates/everr-core/tests/` (or an existing docs-sync test if one exists) reads `packages/docs/content/docs/cli/telemetry.mdx`, extracts the Manual-integration snippet block, and asserts equality with the telemetry portion of `render_discovery_instructions()`.

No new tests for the query engine — covered by existing `telemetry_e2e.rs` and `telemetry_commands.rs`.

## Migration / rollout

- Existing users who have already run `everr setup-assistant`: the managed block is replaced on the next `setup-assistant` run. No manual cleanup required.
- Users who edited their `AGENTS.md` / `CLAUDE.md` manually: covered by the Manual section of the docs page.
- No version gating; the discovery line is safe to ship to all users — an agent in a repo with no OTel instrumentation will simply never match the trigger.

## Open questions (to revisit post-ship)

- Should `setup-assistant` gate the telemetry line on detecting OTel instrumentation in the project (e.g. `@opentelemetry/*`, `@vercel/otel`, `opentelemetry-sdk` in deps)? Default: **no** for v1.
- `traces` currently has no `--format` flag (table-only output); docs reflect the current state. If JSON output is added to `traces` later, update the body.
- Should the discovery line also cover remote OTel backends the user might configure in future? Out of scope — the collector is local-only today.
- `docs/cli-guidelines.md` Rule 2 currently implies a single top-level `ai-instructions` is the source of truth. With this change the pattern becomes "one `ai-instructions` per domain." Worth a short update to the contributor guideline — tracking separately, not part of this spec.
