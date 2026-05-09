---
name: everr-ci-debugging
description: Use when working on failures, investigations and optimizations related to CI or Github Actions or Everr is mentioned in CI context.
---

# CI Debugging With Everr

Use Everr from the repository root when investigating CI state, GitHub Actions failures, workflow logs, or CI test performance.

## Command Choice

| Need | Command |
| --- | --- |
| Read-only custom cloud SQL | `everr cloud query "<SQL>"` |
| Current commit pipeline state. Reads the current branch/repo from git context | `everr ci status` |
| Wait for the current commit on the current branch/repo | `everr ci watch --fail-fast` |
| Recent or filtered runs | `everr ci runs` |
| Jobs and steps for one run | `everr ci show <trace_id>` |
| Only failed jobs and steps | `everr ci show <trace_id> --failed` |
| Logs for a known step | `everr ci logs <trace_id> --job-name <job> --step-number <n>` |
| Logs for the first failed step in a job | `everr ci logs <trace_id> --job-name <job> --log-failed` |

Useful flags:
- `everr ci status --commit <sha>` targets another commit.
- `everr ci runs --current-branch`, `--branch <name>`, `--conclusion <success|failure|cancellation>`, `--workflow-name <name>`, or `--run-id <id>` narrows run lists.
- `everr ci logs --job-id <id>` is safer than `--job-name` when a job id is available.
- `everr ci logs --egrep <pattern>` filters logs with a re2 regex; exit code 1 means no matching lines.
- `everr ci logs --tail <n>`, `--limit <n>`, and `--offset <n>` page large logs.

## Cloud SQL

Use `everr cloud query "<SQL>"` for investigations

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

Always include a time filter and a limit under 1k. Add repo, branch, run id, job, or test filters when known.

## Integrated Example

For "CI is failing on this branch":
1. Run `everr ci runs --current-branch`.
2. If a run failed, copy its `trace_id` and run `everr ci show <trace_id> --failed`.
3. For the failing job, run `everr ci logs <trace_id> --job-name <job> --log-failed`.
4. Explain the failure signal, make or recommend the smallest fix, then use `everr ci watch --fail-fast` to verify.
