# TODO

## Issues

- [**cli-expired-token-no-re-auth-prompt**](todo/issues/cli-expired-token-no-re-auth-prompt.md) — When the CLI auth token expires, commands fail with a generic HTTP 401 error instead of prompting the user to re-authenticate.
- [**clickhouse-ttl-tuning**](todo/issues/clickhouse-ttl-tuning.md) — ClickHouse table TTLs need to be reviewed and tuned. Currently unclear if TTLs are set at all, or if data is retained indefinitely.
- [**collapsed-sidebar-submenu-focus-open**](todo/issues/collapsed-sidebar-submenu-focus-open.md) — When the sidebar is in icon-only (collapsed) mode, tabbing to a group item does not open its flyout submenu. The user must press Enter / Space / ArrowDown to open it. Hover-open works (`openOnHover` with 80ms delay).
- [**collector-tmp-uses-writable-layer-instead-of-tmpfs**](todo/issues/collector-tmp-uses-writable-layer-instead-of-tmpfs.md) — The collector writes temp files to the container's copy-on-write writable layer instead of a tmpfs mount.
- [**handle-missing-gh-installation-on-command**](todo/issues/handle-missing-gh-installation-on-command.md) — Handle the case where a repo does not have a GitHub App installation when a command is run.
- [**handle-runid-in-everr-show**](todo/issues/handle-runid-in-everr-show.md) — —
- [**hide-import-for-repos-with-runs**](todo/issues/hide-import-for-repos-with-runs.md) — The everr setup should not show the import option for repositories where we already have runs.
- [**logs-unavailable-for-in-progress-runs**](todo/issues/logs-unavailable-for-in-progress-runs.md) — —
- [**migrate-fs2-to-fd-lock**](todo/issues/migrate-fs2-to-fd-lock.md) — —
- [**notifications-fire-for-non-pr-jobs**](todo/issues/notifications-fire-for-non-pr-jobs.md) — Notifications are sent for jobs that are not associated with a pull request or merge — only PR/merge jobs should trigger notifications.
- [**polar-webhook-out-of-order-upserts**](todo/issues/polar-webhook-out-of-order-upserts.md) — `upsertOrgSubscription` in `packages/app/src/lib/billing-data.server.ts` unconditionally overwrites the row keyed by `orgId` on every Polar subscription webhook. If webhook deliveries arrive out of order (Polar does not guarantee ordering, and retries can interleave), a late stale event can clobber a fresher state — e.g., `subscription.canceled` arriving after `subscription.active` and rolling the row back, or vice versa.
- [**show-logged-in-user-info-desktop**](todo/issues/show-logged-in-user-info-desktop.md) — Display the logged-in user's name and email somewhere in the desktop app UI.
- [**store-installation-repo-list-in-db**](todo/issues/store-installation-repo-list-in-db.md) — Store the list of installation repositories in the database.

## Ideas

- [**align-collector-with-upstream-receiver**](todo/ideas/align-collector-with-upstream-receiver.md) — Track the remaining differences between our `githubactionsreceiver` and the upstream `opentelemetry-collector-contrib/receiver/githubreceiver` and decide which to adopt.
- [**ci-debug-optimize-skills**](todo/ideas/ci-debug-optimize-skills.md) — A set of Claude Code skills for debugging CI failures and optimizing CI performance, powered by the Everr CLI.
- [**e2e-tests-with-import-from-test-repo**](todo/ideas/e2e-tests-with-import-from-test-repo.md) — End-to-end tests that spin up a fresh Everr instance, run the onboarding import against a dedicated test repo, and verify the full pipeline (GitHub API fetch, collector ingestion, PG/CH writes, dashboard queries).
- [**everr-doctor-command**](todo/ideas/everr-doctor-command.md) — A CLI command that inspects the current repo's Everr integration and suggests improvements — missing configuration, outdated agent instructions, suboptimal workflow setup, etc. Designed to be run by a local AI assistant to self-diagnose and fix integration issues.
- [**local-diagnostic-collector**](todo/ideas/local-diagnostic-collector.md) — A local collector exposed on HTTP that captures events from browser and server (logs, analytics, errors) for offline investigation and debugging — no cloud backend required.
- [**main-branches-metrics**](todo/ideas/main-branches-metrics.md) — Let users designate "main branches" so metrics (success rate, flakiness, slowest jobs/tests) focus on those instead of mixing in feature branch noise.
- [**multi-org-multi-account-login**](todo/ideas/multi-org-multi-account-login.md) — Let a single user be authenticated to multiple Everr accounts simultaneously, with automatic repo-to-account mapping so the right account is used based on context.
- [**onboarding-configure-email**](todo/ideas/onboarding-configure-email.md) — —
- [**onboarding-via-install-sh**](todo/ideas/onboarding-via-install-sh.md) — A single `install.sh` script that handles the complete Everr onboarding end-to-end: user registration, org creation, CLI install, and runs import — all without leaving the terminal.
- [**per-job-log-ingestion**](todo/ideas/per-job-log-ingestion.md) — Reduce the feedback loop by announcing failed jobs as soon as the `workflow_job` completed webhook arrives, along with the failure logs for that job.
- [**personalized-onboarding-prompt**](todo/ideas/personalized-onboarding-prompt.md) — At the end of the onboarding flow, show a personalized prompt tailored to what Everr has learned about the user's repo — e.g. a suggested next action based on their slowest job, a flaky test, or their notification setup.
- [**queue-span-for-workflow-jobs**](todo/ideas/queue-span-for-workflow-jobs.md) — Emit a dedicated span representing the time a job spends queued (created → started) instead of computing queue time client-side from resource attributes.
- [**show-failed-tests-in-everr-show**](todo/ideas/show-failed-tests-in-everr-show.md) — Add a `--tests` or `--failed-tests` flag to `everr show` that displays the list of failed tests for a run, including test name, module, and duration.
- [**store-repository-id**](todo/ideas/store-repository-id.md) — Store the repositoryId to identify and associate data with specific repositories.
- [**vercel-log-drain-integration**](todo/ideas/vercel-log-drain-integration.md) — Integrate with Vercel via log drains to bring deployment pipeline observability into Everr — extending the same visibility already available for build pipelines (CI) to CD workflows.

