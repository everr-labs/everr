---
name: everr-working-with-ci
description: Use when a task mentions CI, GitHub Actions, workflow runs, checks, jobs, steps, logs, build or test failures, flaky or slow CI, PR status, branch status, release pipelines, or whether a commit is green.
---

## Startup Access

Before using the everr CLI, request for the smallest sandbox access that lets Everr commands work:

- Filesystem read: `~/Library/Application Support/everr/session.json`, `~/Library/Application Support/everr/session-dev.json`, and their parent directory.
- Local network: `127.0.0.1`, `localhost`, and the ports 54318, 54320, 54418, 54420.
- Production network: `https://app.everr.dev`

If the current tool cannot ask for a blanket permission grant, request scoped command approvals before the first Everr command instead of trying a sandboxed command that is expected to fail.

# Working With CI Using Everr

Use Everr from the repository root for CI state, workflow logs, test results, and pipeline timing. Start with Everr's structured GitHub Actions data before `gh`, the GitHub UI, memory, or pasted logs.

If Everr fails, capture the exact command and error, then investigate wrong repo context, missing auth, missing import, no matching run, stale data, or CLI bugs. Use `gh` only after Everr cannot answer, or as a cross-check.

## Workflow

1. Identify the target: current branch/commit, PR branch, run id, workflow, job, or time range.
2. Check status or runs before logs: current commit with `everr ci status`, known commit with `everr ci status --commit <sha>`, known run with `everr ci status --run-id <id>`, or branch with `everr ci runs --current-branch`.
3. Drill down: run -> `everr ci show <trace_id> --failed` -> `everr ci logs <trace_id> --job-name <job> --log-failed`.
4. For flaky, slow, or repeated failures, compare history with `everr ci runs` and `everr cloud query`; one run or log is not proof.
5. If Everr errors, diagnose that failure before using `gh`.
6. Explain the signal, make or recommend the smallest fix, then watch: `everr ci watch --fail-fast` or `everr ci watch --run-id <id> --fail-fast`.

## Commands

| Need                          | Command                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| Current commit pipeline state | `everr ci status`                                             |
| Known commit pipeline state   | `everr ci status --commit <sha>`                              |
| Recent or filtered runs       | `everr ci runs`                                               |
| Jobs and steps for one run    | `everr ci show <trace_id>`                                    |
| Only failed jobs and steps    | `everr ci show <trace_id> --failed`                           |
| Logs for a step               | `everr ci logs <trace_id> --job-name <job> --step-number <n>` |
| First failed step logs        | `everr ci logs <trace_id> --job-name <job> --log-failed`      |
| Historical CI/test analysis   | `everr cloud query "<SQL>"`                                   |

Useful flags: `--branch`, `--current-branch`, `--conclusion`, `--workflow-name`, and `--run-id` narrow runs; `--job-id` is safer than `--job-name`; `--egrep` filters logs; `--tail`, `--limit`, and `--offset` page large logs.

## Historical Queries

Use `everr cloud query "<SQL>"` when the answer needs history, comparison, or aggregation: flaky tests, slow jobs, retries, failure rates, or "real regression?" questions. Start with `traces` for runs/jobs/steps/test spans, `logs` for step logs, and metrics tables for resource signals.

Always include a time filter, scoped repo/branch/run/workflow/job/test filters when known, and a `LIMIT` under 1000. For CI trace queries, include `ServiceName = 'github-actions'`. Do not add tenant filters or `PREWHERE`.

## Querying The Everr DB

Run read-only ClickHouse SQL with `everr cloud query "<SQL>"`. Use `SHOW TABLES`, `DESCRIBE TABLE traces`, or `DESCRIBE TABLE logs` when unsure about columns. Cloud CI data usually starts in `traces`; step log lines are in `logs`; metrics are in `metrics_gauge` and `metrics_sum`.

Everr CI follows OpenTelemetry semantic conventions where they exist. The conventions used in CI data include:

- `service.name` as `ServiceName` (`github-actions`)
- `vcs.repository.name`
- `vcs.ref.head.name`
- `vcs.ref.head.revision`
- `cicd.pipeline.name`
- `cicd.pipeline.result`
- `cicd.pipeline.run.id`
- `cicd.pipeline.task.name`
- `cicd.pipeline.task.run.id`
- `cicd.pipeline.task.run.result`
- `cicd.pipeline.task.run.url.full`
- `cicd.worker.name`

Recent run history:

```sql
SELECT
  max(Timestamp) AS last_seen,
  TraceId,
  anyLast(ResourceAttributes['cicd.pipeline.run.id']) AS run_id,
  anyLast(ResourceAttributes['cicd.pipeline.name']) AS workflow,
  anyLast(ResourceAttributes['vcs.ref.head.name']) AS branch,
  anyLast(ResourceAttributes['vcs.ref.head.revision']) AS sha,
  anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) AS result
FROM traces
WHERE Timestamp > now() - INTERVAL 7 DAY
  AND ServiceName = 'github-actions'
  AND ResourceAttributes['vcs.repository.name'] = '<owner/repo>'
  AND ResourceAttributes['cicd.pipeline.run.id'] != ''
  AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
  AND SpanAttributes['everr.test.name'] = ''
GROUP BY TraceId
ORDER BY last_seen DESC
LIMIT 20
```

Repeated failure log lines:

```sql
SELECT
  anyLast(ResourceAttributes['cicd.pipeline.name']) AS workflow,
  anyLast(ScopeAttributes['cicd.pipeline.task.name']) AS job,
  anyLast(LogAttributes['everr.github.workflow_job_step.number']) AS step,
  uniqExact(TraceId) AS runs,
  count() AS lines,
  max(Timestamp) AS last_seen,
  anyLast(Body) AS sample
FROM logs
WHERE Timestamp > now() - INTERVAL 14 DAY
  AND ResourceAttributes['vcs.repository.name'] = '<owner/repo>'
  AND startsWith(Body, '##[error]')
GROUP BY cityHash64(Body)
ORDER BY runs DESC, lines DESC, last_seen DESC
LIMIT 50
```

## Common Mistakes

- Starting with `gh pr checks` because it feels faster: run Everr first.
- Running `everr ci status <sha>`: use `everr ci status --commit <sha>`.
- Treating one failed log as proof: compare runs, attempts, tests, jobs, and failure signatures.
- Ignoring an Everr CLI error: diagnose repo context, auth, import state, or CLI behavior.
- Asking for pasted logs: fetch them with `everr ci logs` unless access is unavailable.

## Example: CI Is Failing On This Branch

Run `everr ci runs --current-branch`, copy the failed `trace_id`, then run `everr ci show <trace_id> --failed` and `everr ci logs <trace_id> --job-name <job> --log-failed`. If flakiness is possible, query history before deciding whether it is a real regression.
