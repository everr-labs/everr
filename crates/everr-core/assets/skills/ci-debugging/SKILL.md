---
name: ci-debugging
description: Use when a task mentions CI failures, GitHub Actions, pipeline status, workflow logs, failing jobs or steps, branch comparisons, or validating a CI fix with Everr.
---

# CI Debugging With Everr

Use Everr from the repository root when investigating CI state, GitHub Actions failures, workflow logs, or CI test performance.

## Default Workflow

1. Start with `everr ci status` unless the user already provided a `trace_id`, `run_id`, job id, or exact step.
2. Copy exact identifiers from Everr output. Do not guess `trace_id`, job names, job ids, or step numbers.
3. Prefer the narrowest command that answers the question; fetch targeted logs instead of broad dumps.
4. After a fix, suggest `everr ci watch --fail-fast` to confirm the current commit.

## Command Choice

| Need | Command |
| --- | --- |
| Current commit pipeline state | `everr ci status` |
| Wait for the current commit | `everr ci watch --fail-fast` |
| Recent or filtered runs | `everr ci runs` |
| Jobs and steps for one run | `everr ci show <trace_id>` |
| Only failed jobs and steps | `everr ci show <trace_id> --failed` |
| Logs for a known step | `everr ci logs <trace_id> --job-name <job> --step-number <n>` |
| Logs for the first failed step in a job | `everr ci logs <trace_id> --job-name <job> --log-failed` |
| Search similar failures on other branches | `everr ci grep --pattern <text>` |
| Advanced read-only custom cloud SQL investigation | `everr cloud query "<SQL>"` |

Useful flags:
- `everr ci status --commit <sha>` targets another commit.
- `everr ci runs --current-branch`, `--branch <name>`, `--conclusion <success|failure|cancellation>`, `--workflow-name <name>`, or `--run-id <id>` narrows run lists.
- `everr ci logs --job-id <id>` is safer than `--job-name` when a job id is available.
- `everr ci logs --egrep <pattern>` filters logs with a re2 regex; exit code 1 means no matching lines.
- `everr ci logs --tail <n>`, `--limit <n>`, and `--offset <n>` page large logs.

## Cloud SQL

Use `everr cloud query "<SQL>"` only when focused commands do not answer the question.

Starting tables:
- `traces`: workflow runs, jobs, steps, and test spans
- `logs`: step logs
- `metrics_gauge` and `metrics_sum`: resource metrics when needed

Standards:
- https://opentelemetry.io/docs/specs/semconv/cicd/
- https://opentelemetry.io/docs/specs/semconv/cicd/cicd-spans/
- https://opentelemetry.io/docs/specs/semconv/resource/cicd/
- https://opentelemetry.io/docs/specs/semconv/registry/attributes/test/

Common Everr-specific fields:
- `SpanAttributes['everr.github.workflow_job_step.number']`
- `ResourceAttributes['everr.github.workflow_job.run_attempt']`
- `SpanAttributes['everr.test.name']`
- `SpanAttributes['everr.test.result']`
- `SpanAttributes['everr.test.duration_seconds']`
- `SpanAttributes['everr.test.package']`
- `SpanAttributes['everr.test.parent_test']`

Simple test filtering example:
```sql
SELECT
  Timestamp,
  ResourceAttributes['vcs.repository.name'] AS repo,
  ResourceAttributes['vcs.ref.head.name'] AS branch,
  ResourceAttributes['cicd.pipeline.run.id'] AS run_id,
  SpanAttributes['everr.test.name'] AS test_name,
  SpanAttributes['everr.test.result'] AS result
FROM traces
WHERE Timestamp > now() - INTERVAL 7 DAY
  AND SpanAttributes['everr.test.name'] != ''
  AND SpanAttributes['everr.test.result'] IN ('pass', 'fail')
ORDER BY Timestamp DESC
LIMIT 50
```

Always include a time filter. Add repo, branch, run id, job, or test filters when known. Tenant filtering is automatic; do not filter on `tenant_id`.

## Integrated Example

For "CI is failing on this branch":
1. Run `everr ci status`.
2. If a run failed, copy its `trace_id` and run `everr ci show <trace_id> --failed`.
3. For the failing job, run `everr ci logs <trace_id> --job-name <job> --log-failed`.
4. If the error looks familiar but unclear, search history with `everr ci grep --pattern <distinct error text>`.
5. Explain the failure signal, make or recommend the smallest fix, then use `everr ci watch --fail-fast` to verify.
