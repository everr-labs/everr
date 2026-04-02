# TODO

## Issues

- [**clickhouse-ttl-tuning**](todo/issues/clickhouse-ttl-tuning.md) — ClickHouse table TTLs need to be reviewed and tuned. Currently unclear if TTLs are set at all, or if data is retained indefinitely.
- [**collector-tmp-uses-writable-layer-instead-of-tmpfs**](todo/issues/collector-tmp-uses-writable-layer-instead-of-tmpfs.md) — The collector writes temp files to the container's copy-on-write writable layer instead of a tmpfs mount.
- [**everr-logs-grep-option**](todo/issues/everr-logs-grep-option.md) — `everr logs` should support a `--grep <pattern>` option to filter log output by a text pattern, similar to how `everr grep` works but scoped to a single trace/job/step.
- [**everr-logs-strip-ansi-by-default**](todo/issues/everr-logs-strip-ansi-by-default.md) — `everr logs` should strip ANSI escape codes from log output by default. Currently raw ANSI sequences are returned, which breaks grep and makes output harder to read in non-terminal contexts.
- [**everr-status-show-branch-and-failures**](todo/issues/everr-status-show-branch-and-failures.md) — `everr status` output doesn't include the branch name or, for failed runs, the names of the failing jobs and steps.
- [**failure-notifications-polling-to-sse**](todo/issues/failure-notifications-polling-to-sse.md) — The CLI failure notifications endpoint is polled on an interval. It should use the existing SSE infrastructure so notifications arrive in real time without repeated requests.
- [**getauth-returns-undefined-on-runs-list**](todo/issues/getauth-returns-undefined-on-runs-list.md) — Production error: "can't access property 'user', e is undefined" on `/runs/list` for an authenticated user.
- [**notification-data-from-postgres-with-steps**](todo/issues/notification-data-from-postgres-with-steps.md) — —
- [**notifications-fire-for-non-pr-jobs**](todo/issues/notifications-fire-for-non-pr-jobs.md) — Notifications are sent for jobs that are not associated with a pull request or merge — only PR/merge jobs should trigger notifications.
- [**notifier-no-git-email-fallback**](todo/issues/notifier-no-git-email-fallback.md) — —
- [**show-logged-in-user-info-desktop**](todo/issues/show-logged-in-user-info-desktop.md) — Display the logged-in user's name and email somewhere in the desktop app UI.

## Ideas

- [**align-collector-with-upstream-receiver**](todo/ideas/align-collector-with-upstream-receiver.md) — Track the remaining differences between our `githubactionsreceiver` and the upstream `opentelemetry-collector-contrib/receiver/githubreceiver` and decide which to adopt.
- [**chdb-local-test-traces**](todo/ideas/chdb-local-test-traces.md) — Use [chdb-io](https://github.com/chdb-io/chdb) to store test traces locally for investigation and debugging.
- [**e2e-tests-with-import-from-test-repo**](todo/ideas/e2e-tests-with-import-from-test-repo.md) — End-to-end tests that spin up a fresh Everr instance, run the onboarding import against a dedicated test repo, and verify the full pipeline (GitHub API fetch, collector ingestion, PG/CH writes, dashboard queries).
- [**everr-doctor-command**](todo/ideas/everr-doctor-command.md) — A CLI command that inspects the current repo's Everr integration and suggests improvements — missing configuration, outdated agent instructions, suboptimal workflow setup, etc. Designed to be run by a local AI assistant to self-diagnose and fix integration issues.
- [**main-branches-metrics**](todo/ideas/main-branches-metrics.md) — Let users designate "main branches" so metrics (success rate, flakiness, slowest jobs/tests) focus on those instead of mixing in feature branch noise.
- [**multi-org-multi-account-login**](todo/ideas/multi-org-multi-account-login.md) — Let a single user be authenticated to multiple Everr accounts simultaneously, with automatic repo-to-account mapping so the right account is used based on context.
- [**onboarding-via-install-sh**](todo/ideas/onboarding-via-install-sh.md) — A single `install.sh` script that handles the full Everr onboarding — installing the CLI, authenticating, and wiring up the repo — so users go from zero to running in one command.
- [**per-job-log-ingestion**](todo/ideas/per-job-log-ingestion.md) — Reduce the feedback loop by announcing failed jobs as soon as the `workflow_job` completed webhook arrives, along with the failure logs for that job.
- [**personalized-onboarding-prompt**](todo/ideas/personalized-onboarding-prompt.md) — At the end of the onboarding flow, show a personalized prompt tailored to what Everr has learned about the user's repo — e.g. a suggested next action based on their slowest job, a flaky test, or their notification setup.
- [**queue-span-for-workflow-jobs**](todo/ideas/queue-span-for-workflow-jobs.md) — Emit a dedicated span representing the time a job spends queued (created → started) instead of computing queue time client-side from resource attributes.
- [**show-failed-tests-in-everr-show**](todo/ideas/show-failed-tests-in-everr-show.md) — Add a `--tests` or `--failed-tests` flag to `everr show` that displays the list of failed tests for a run, including test name, module, and duration.
- [**store-repository-id**](todo/ideas/store-repository-id.md) — Store the repositoryId to identify and associate data with specific repositories.
- [**vercel-log-drain-integration**](todo/ideas/vercel-log-drain-integration.md) — Integrate with Vercel via log drains to bring deployment pipeline observability into Everr — extending the same visibility already available for build pipelines (CI) to CD workflows.

