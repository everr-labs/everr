---
name: everr-working-with-ci
description: Use when a task mentions CI, GitHub Actions, workflow runs, checks, jobs, steps, logs, build or test failures, flaky or slow CI, PR status, branch status, release pipelines, or whether a commit is green.
---

# Working With CI Using Everr

Use Everr from the repository root whenever CI state, workflow logs, test results, or pipeline timing can answer the question. Everr has structured CI data, so start from the actual run data before guessing from memory or asking for pasted logs.

If an Everr command fails, investigate why: wrong repo context, missing auth, missing import, no matching run, or CLI bug. Do not silently fall back to another source unless Everr cannot answer the task.

## Default Workflow

1. Identify the target: current branch/commit, PR branch, run id, workflow, job, or time range.
2. Check the run list or status before reading logs.
3. Drill down from run -> failed job/step -> logs.
4. For flaky, slow, or repeated failures, query cloud telemetry across runs instead of treating one log as the whole story.
5. Explain the signal you found, then make or recommend the smallest fix.
6. After changes, watch the relevant run with `everr ci watch --fail-fast` or `everr ci watch --run-id <id> --fail-fast`.

## Command Choice

| Need | Command |
| --- | --- |
| Current commit pipeline state | `everr ci status` |
| Wait for current commit | `everr ci watch --fail-fast` |
| Wait for one known run | `everr ci watch --run-id <id> --fail-fast` |
| Recent or filtered runs | `everr ci runs` |
| Jobs and steps for one run | `everr ci show <trace_id>` |
| Only failed jobs and steps | `everr ci show <trace_id> --failed` |
| Logs for a known step | `everr ci logs <trace_id> --job-name <job> --step-number <n>` |
| Logs for the first failed step in a job | `everr ci logs <trace_id> --job-name <job> --log-failed` |
| Historical CI/test analysis | `everr cloud query "<SQL>"` |

Useful filters:
- `everr ci status --commit <sha>` or `--run-id <id>` targets something specific.
- `everr ci runs --current-branch`, `--branch <name>`, `--conclusion <success|failure|cancellation>`, `--workflow-name <name>`, or `--run-id <id>` narrows run lists.
- `everr ci logs --job-id <id>` is safer than `--job-name` when a job id is available.
- `everr ci logs --egrep <pattern>` filters logs with a re2 regex; exit code 1 means no matching lines.
- `everr ci logs --tail <n>`, `--limit <n>`, and `--offset <n>` page large logs.

## Smart CI Analysis

Use `everr cloud query "<SQL>"` when the useful answer needs history, comparison, or aggregation. Start with:
- `traces`: workflow runs, jobs, steps, and test spans
- `logs`: step logs
- `metrics_gauge` and `metrics_sum`: resource metrics when needed

Common fields:
- `SpanAttributes['everr.github.workflow_job_step.number']`
- `ResourceAttributes['everr.github.workflow_job.run_attempt']`
- `SpanAttributes['everr.test.name']`
- `SpanAttributes['everr.test.result']`
- `SpanAttributes['everr.test.duration_seconds']`
- `SpanAttributes['everr.test.package']`
- `SpanAttributes['everr.test.parent_test']`

Query rules:
- Always include a time filter and a `LIMIT` under 1000.
- Add repo, branch, run id, workflow, job, or test filters when known.
- Do not add tenant filters; Everr already enforces tenant isolation.
- Do not use `PREWHERE` unless the user explicitly asks.

## Example: CI Is Failing On This Branch

1. Run `everr ci runs --current-branch`.
2. If a run failed, copy its `trace_id` and run `everr ci show <trace_id> --failed`.
3. For the failing job, run `everr ci logs <trace_id> --job-name <job> --log-failed`.
4. If the failure may be flaky, use `everr cloud query "<SQL>"` to compare recent test outcomes by test name, package, branch, and run id.
5. Summarize what failed, whether history supports flakiness or a real regression, and what evidence supports that conclusion.
