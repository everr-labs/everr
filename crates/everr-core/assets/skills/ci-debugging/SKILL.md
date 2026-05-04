---
name: ci-debugging
description: Use when investigating CI, GitHub Actions, pipelines, workflow logs, failing jobs, or CI test performance with Everr.
---

# CI Debugging With Everr

Use Everr when the task involves CI, GitHub Actions workflows, pipelines, CI failures, workflow logs, or CI test performance from the current project directory.

Start with `everr status` to see the current commit pipeline state. Use `--commit <sha>` to target another commit.

Core commands:
- `everr status`: current commit pipeline state.
- `everr watch`: wait for the current commit's pipeline to finish. Use `--fail-fast` to stop on the first failure.
- `everr runs`: recent runs. Use `--current-branch`, `--branch <name>`, `--conclusion <success|failure|cancellation>`, `--workflow-name <name>`, or `--run-id <id>`.
- `everr show <trace_id>`: jobs and steps for one run. Use `--failed` to show failed jobs only.
- `everr logs <trace_id> --job-name <job> --step-number <n>`: step logs.
- `everr logs <trace_id> --job-name <job> --log-failed`: logs for the first failing step in that job.
- `everr grep --pattern <text>`: search failing step logs across branches.
- `everr workflows`: workflows and jobs. Use `--branch <name>` if needed.
- `everr test-history --module <module> --test-name <name>`: history for one test.
- `everr slowest-tests`: slowest tests.
- `everr slowest-jobs`: slowest jobs.

Log tips:
- Use `--job-id <id>` instead of `--job-name` when the job id is known.
- Use `--egrep <pattern>` to filter logs with a re2 regex; exit code 1 means no matching lines.
- Use `--tail <n>`, `--limit <n>`, and `--offset <n>` for paging.

After helping fix a failing CI run, suggest `everr watch` to confirm the fix holds.
