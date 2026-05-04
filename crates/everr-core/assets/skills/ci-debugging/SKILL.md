---
name: ci-debugging
description: Use when a task mentions CI failures, GitHub Actions, pipeline status, workflow logs, failing jobs or steps, flaky tests, slow tests or jobs, branch comparisons, or validating a CI fix with Everr.
---

# CI Debugging With Everr

Use Everr from the repository root when investigating CI state, GitHub Actions failures, workflow logs, or CI test performance.

## Default Workflow

1. Start with `everr status` unless the user already provided a `trace_id`, `run_id`, job id, or exact step.
2. Copy exact identifiers from Everr output. Do not guess `trace_id`, job names, job ids, or step numbers.
3. Prefer the narrowest command that answers the question; fetch targeted logs instead of broad dumps.
4. After a fix, suggest `everr watch --fail-fast` to confirm the current commit.

## Command Choice

| Need | Command |
| --- | --- |
| Current commit pipeline state | `everr status` |
| Wait for the current commit | `everr watch --fail-fast` |
| Recent or filtered runs | `everr runs` |
| Jobs and steps for one run | `everr show <trace_id>` |
| Only failed jobs and steps | `everr show <trace_id> --failed` |
| Logs for a known step | `everr logs <trace_id> --job-name <job> --step-number <n>` |
| Logs for the first failed step in a job | `everr logs <trace_id> --job-name <job> --log-failed` |
| Search similar failures on other branches | `everr grep --pattern <text>` |
| Workflow/job inventory | `everr workflows` |
| One test's history | `everr test-history --module <module> --test-name <name>` |
| Slow test or job analysis | `everr slowest-tests` or `everr slowest-jobs` |

Useful flags:
- `everr status --commit <sha>` targets another commit.
- `everr runs --current-branch`, `--branch <name>`, `--conclusion <success|failure|cancellation>`, `--workflow-name <name>`, or `--run-id <id>` narrows run lists.
- `everr logs --job-id <id>` is safer than `--job-name` when a job id is available.
- `everr logs --egrep <pattern>` filters logs with a re2 regex; exit code 1 means no matching lines.
- `everr logs --tail <n>`, `--limit <n>`, and `--offset <n>` page large logs.

## Integrated Example

For "CI is failing on this branch":
1. Run `everr status`.
2. If a run failed, copy its `trace_id` and run `everr show <trace_id> --failed`.
3. For the failing job, run `everr logs <trace_id> --job-name <job> --log-failed`.
4. If the error looks familiar but unclear, search history with `everr grep --pattern <distinct error text>`.
5. Explain the failure signal, make or recommend the smallest fix, then use `everr watch --fail-fast` to verify.
