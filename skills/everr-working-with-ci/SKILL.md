---
name: everr-working-with-ci
description: Use when a task mentions CI, GitHub Actions, workflow runs, checks, jobs, steps, logs, build or test failures, flaky or slow CI, PR status, branch status, release pipelines, or whether a commit is green.
---

# Working With CI Using Everr

The CLI no longer has `everr ci` commands. GitHub Actions runs, jobs, steps, and their logs are telemetry in Everr, so investigate CI the same way as any other runtime question: use the `everr-use-telemetry` skill and query with `everr cloud query "<SQL>"`.
