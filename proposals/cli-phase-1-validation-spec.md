# Phase 1 Design Spec: Validate CLI vs MCP (Global Assistant Integration)

## Summary

Build a Rust CLI prototype to validate that assistant workflows perform better with local CLI context than remote MCP.

Phase 1 includes:

1. Representative command subset (not full MCP parity).
2. Global assistant integration (user-level, not repo-level) for Codex, Claude, Cursor.
3. Pull-based failure notifications via background daemon.
4. `everr install` interactive wizard.
5. `everr auth logout`.

## Goals and Success Criteria

1. Median time-to-correct-answer improves >= 25% vs MCP baseline.
2. Median assistant turns/prompts improves >= 20% vs MCP baseline.
3. Correctness is non-inferior (<= 5% absolute drop).
4. Notification p95 latency <= 90s from failed-run availability.
5. Notification precision >= 90% for "my recent push on current branch failed".

## Public Interfaces and Command Surface (Phase 1)

### `everr install` (interactive-only)

1. Detect auth session and start login if none is active.
2. Prompt user to choose one or more assistants (Codex, Claude, Cursor).
3. Install daemon service if not installed yet.
4. Print setup summary (auth state, assistant integration state, daemon state).

### Auth commands

1. `everr auth login`
2. `everr auth logout`

### Core commands

1. `everr context`
2. `everr status`
3. `everr runs list`
4. `everr runs show --trace-id <id>`
5. `everr runs logs --trace-id <id> --job-name <name> --step-number <n> [--full]`
6. `everr assistant init --assistant codex|claude|cursor|all`
7. `everr notify daemon|status`

## Global Assistant Integration (Updated Requirement)

1. Integration scope is user-level only; no repository file writes for assistant wiring.
2. CLI updates global assistant config/rules in each assistant's standard user path.
3. `everr assistant init` is idempotent and preserves unrelated user customizations.
4. `everr install` invokes the same assistant integration flow from wizard selections.
5. Assistants invoke `everr` from the current working directory; CLI resolves repo and branch at runtime.

## Logout Behavior

1. Delete local token from secure storage.
2. Clear cached auth and organization context.
3. Stop daemon if it depends on removed credentials.
4. Attempt server-side token revocation (best effort); local credential deletion is authoritative.

## Pull Notification Design

1. Daemon is installed as a user-level OS service.
2. Poll interval defaults to 60 seconds.
3. Recent push detection:
   - Primary: push ledger from optional post-push hook.
   - Fallback: reflog heuristic.
4. Alert when a run for the current branch after a recent push fails.
5. Parse `git reflog` to score whether a failure is likely interesting to the current user (for example, recent local checkouts, rebases, pulls, and pushes on the same branch increase relevance).
6. Dedupe key: `repo|branch|runId|failure`.
7. Alert payload includes repo, branch, workflow, run ID, timestamp, and run/log link.

## Backend/API Additions (Phase 1)

1. WorkOS OAuth device flow for CLI auth.
2. CLI query API for operations in scope:
   - `status`
   - `runs_list`
   - `run_details`
   - `step_logs`
3. Branch-runs polling API for daemon use.
4. Token revocation endpoint for logout (if implemented in phase scope).

## Benchmark Protocol (Validation)

1. Run internal dogfood trial with scripted benchmark tasks.
2. Compare MCP flow vs CLI flow using Codex, Claude, and Cursor.
3. Capture:
   - Completion time
   - Prompt count
   - Correctness
   - Friction notes
   - Notifier precision and latency

## Test Cases and Scenarios

### Global integration

1. Fresh machine setup writes expected global assistant artifacts.
2. Existing configs are merged safely with unrelated settings preserved.
3. Multi-assistant selection configures all selected assistants.
4. Re-running setup is idempotent.

### Install and logout

1. No active session triggers login.
2. Active session skips login.
3. Daemon installs only if missing.
4. Logout while daemon running transitions daemon to stopped/unhealthy with clear status.

### CLI and notifier behavior

1. Repo context resolves from current working directory.
2. Non-git directories return actionable errors.
3. Command behavior matches phase-1 MCP subset semantics.
4. No push means no failure alert.
5. Push + failure emits one alert.
6. Repeated polls do not emit duplicate alerts.
7. Missing push ledger falls back to reflog heuristic.

## Assumptions and Defaults

1. Phase 1 is validation-first, not full MCP replacement.
2. `everr install` is the recommended onboarding path.
3. `everr install` is interactive-only in phase 1.
4. Assistant integration is strictly global in phase 1.
5. Rust implementation should avoid unnecessary `.clone()` while preserving thread safety.
