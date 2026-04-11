# `everr logs --log-failed` — Design Spec

**Date:** 2026-04-11
**Status:** Approved

## Problem

`everr logs` requires `--job-name` and `--step-number` to be known upfront. When a CI run fails, you often know the job but not which step failed — you have to run `everr show --failed` first to find the step, then copy the step number into a second command. This is friction, especially for AI assistants.

## Goal

Add `--log-failed` to `everr logs` so that the CLI automatically resolves the first failing step for a given job, removing the need to know `--step-number` in advance. Also add `--job-id` as an alternative to `--job-name` for identifying a job.

## CLI Interface

Changes to `GetLogsArgs` in `cli.rs`:

- `--job-name` — remains, but is now mutually exclusive with `--job-id`; exactly one is required
- `--job-id` — new arg, mutually exclusive with `--job-name`
- `--log-failed` — new flag, mutually exclusive with `--step-number`; when set, `--step-number` is not required
- `--step-number` — remains, mutually exclusive with `--log-failed`

### Valid combinations

| Job identifier | Step identifier | Behaviour |
|---|---|---|
| `--job-name` | `--step-number` | Existing path — no change |
| `--job-name` | `--log-failed` | Auto-resolve failing step by job name |
| `--job-id` | `--log-failed` | Auto-resolve failing step by job id |
| `--job-id` | `--step-number` | Resolve job name from id, fetch logs at given step |

## Execution Flow

`--log-failed` and `--job-id` both require a `GET /runs/{trace_id}?failed=true` call first (same endpoint used by `everr show --failed`). The response includes `failingJobs[].{ id, name, firstFailingStep: { stepNumber, stepName } }`.

All paths converge on the existing `get_step_logs` call.

### Path: `--job-name` + `--step-number`
Existing path, unchanged.

### Path: `--job-name` + `--log-failed`
1. Fetch run details with `?failed=true`
2. Find job with matching `name`
3. Extract `first_failing_step.step_number`
4. Fetch logs

### Path: `--job-id` + `--log-failed`
1. Fetch run details with `?failed=true`
2. Find job with matching `id`
3. Extract `name` and `first_failing_step.step_number`
4. Fetch logs

### Path: `--job-id` + `--step-number`
1. Fetch run details with `?failed=true`
2. Find job with matching `id`, extract `name`
3. Fetch logs using resolved `name` and the provided `step_number`

## Error Handling

- No job matching the given `--job-name` or `--job-id` → error: `"no job found matching <identifier>"`
- Job found but `first_failing_step` is `None` when `--log-failed` was used → error: `"no failing step found for job <name>"`

## Backend Changes

None. The feature is pure client-side orchestration over two existing API endpoints:
- `GET /api/cli/runs/{trace_id}?failed=true` (already used by `everr show --failed`)
- `GET /api/cli/runs/{trace_id}/logs` (already used by `everr logs`)

## Out of Scope

- Printing logs for all failing jobs in one invocation (requires job to always be specified)
- Adding `--job-id` support to `ai-instructions` (update separately once the flag ships)
