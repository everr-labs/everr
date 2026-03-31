# TODO

## Issues

- [**clickhouse-ttl-tuning**](todo/issues/clickhouse-ttl-tuning.md) — ClickHouse table TTLs need to be reviewed and tuned. Currently unclear if TTLs are set at all, or if data is retained indefinitely.
- [**collector-tmp-uses-writable-layer-instead-of-tmpfs**](todo/issues/collector-tmp-uses-writable-layer-instead-of-tmpfs.md) — The collector writes temp files to the container's copy-on-write writable layer instead of a tmpfs mount.
- [**everr-logs-grep-option**](todo/issues/everr-logs-grep-option.md) — `everr logs` should support a `--grep <pattern>` option to filter log output by a text pattern, similar to how `everr grep` works but scoped to a single trace/job/step.
- [**everr-logs-strip-ansi-by-default**](todo/issues/everr-logs-strip-ansi-by-default.md) — `everr logs` should strip ANSI escape codes from log output by default. Currently raw ANSI sequences are returned, which breaks grep and makes output harder to read in non-terminal contexts.
- [**failure-notifications-polling-to-sse**](todo/issues/failure-notifications-polling-to-sse.md) — The CLI failure notifications endpoint is polled on an interval. It should use the existing SSE infrastructure so notifications arrive in real time without repeated requests.
- [**notifications-fire-for-non-pr-jobs**](todo/issues/notifications-fire-for-non-pr-jobs.md) — Notifications are sent for jobs that are not associated with a pull request or merge — only PR/merge jobs should trigger notifications.
- [**per-repo-install-claude-agents-md**](todo/issues/per-repo-install-claude-agents-md.md) — The per-repo install writes instructions to `AGENTS.md`, but Claude Code only reads `CLAUDE.md`. Claude ignores `AGENTS.md` entirely, so repos installed with the current flow get no agent instructions picked up by Claude.

## Ideas

- [**align-collector-with-upstream-receiver**](todo/ideas/align-collector-with-upstream-receiver.md) — Track the remaining differences between our `githubactionsreceiver` and the upstream `opentelemetry-collector-contrib/receiver/githubreceiver` and decide which to adopt.
- [**chdb-local-test-traces**](todo/ideas/chdb-local-test-traces.md) — Use [chdb-io](https://github.com/chdb-io/chdb) to store test traces locally for investigation and debugging.
- [**e2e-tests-with-import-from-test-repo**](todo/ideas/e2e-tests-with-import-from-test-repo.md) — End-to-end tests that spin up a fresh Everr instance, run the onboarding import against a dedicated test repo, and verify the full pipeline (GitHub API fetch, collector ingestion, PG/CH writes, dashboard queries).
- [**everr-doctor-command**](todo/ideas/everr-doctor-command.md) — A CLI command that inspects the current repo's Everr integration and suggests improvements — missing configuration, outdated agent instructions, suboptimal workflow setup, etc. Designed to be run by a local AI assistant to self-diagnose and fix integration issues.
- [**guided-onboarding**](todo/ideas/guided-onboarding.md) — An interactive onboarding flow that walks new users through integrating Everr into their workflow and helps them get their first concrete improvements — e.g. identifying a flaky test, finding the slowest job, or setting up failure notifications.
- [**main-branches-metrics**](todo/ideas/main-branches-metrics.md) — Let users designate "main branches" so metrics (success rate, flakiness, slowest jobs/tests) focus on those instead of mixing in feature branch noise.
- [**merge-notifications-by-commit**](todo/ideas/merge-notifications-by-commit.md) — Merge multiple notifications triggered by the same commit into a single commit-level notification instead of showing one notification per failing run or job.
- [**multi-org-multi-account-login**](todo/ideas/multi-org-multi-account-login.md) — Let a single user be authenticated to multiple Everr accounts simultaneously, with automatic repo-to-account mapping so the right account is used based on context.
- [**post-optimization-annotations**](todo/ideas/post-optimization-annotations.md) — Allow users to annotate jobs and tests after optimization with the date, model type, and a note.
- [**queue-span-for-workflow-jobs**](todo/ideas/queue-span-for-workflow-jobs.md) — Emit a dedicated span representing the time a job spends queued (created → started) instead of computing queue time client-side from resource attributes.
- [**store-repository-id**](todo/ideas/store-repository-id.md) — Store the repositoryId to identify and associate data with specific repositories.

