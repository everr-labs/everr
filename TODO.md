# TODO

## Issues

- [**collector-tmp-uses-writable-layer-instead-of-tmpfs**](todo/issues/collector-tmp-uses-writable-layer-instead-of-tmpfs.md) — The collector writes temp files to the container's copy-on-write writable layer instead of a tmpfs mount.
- [**failure-notifications-polling-to-sse**](todo/issues/failure-notifications-polling-to-sse.md) — The CLI failure notifications endpoint is polled on an interval. It should use the existing SSE infrastructure so notifications arrive in real time without repeated requests.
- [**notifications-fire-for-non-pr-jobs**](todo/issues/notifications-fire-for-non-pr-jobs.md) — Notifications are sent for jobs that are not associated with a pull request or merge — only PR/merge jobs should trigger notifications.
- [**per-repo-install-claude-agents-md**](todo/issues/per-repo-install-claude-agents-md.md) — The per-repo install writes instructions to `AGENTS.md`, but Claude Code only reads `CLAUDE.md`. Claude ignores `AGENTS.md` entirely, so repos installed with the current flow get no agent instructions picked up by Claude.
- [**replace-filter-select-with-autocomplete-combobox**](todo/issues/replace-filter-select-with-autocomplete-combobox.md) — The FilterSelect component should be replaced with an autocomplete combobox.
- [**tables-alignment-and-sorting**](todo/issues/tables-alignment-and-sorting.md) — Table columns are misaligned and tables don't support sorting.

## Ideas

- [**align-collector-with-upstream-receiver**](todo/ideas/align-collector-with-upstream-receiver.md) — Track the remaining differences between our `githubactionsreceiver` and the upstream `opentelemetry-collector-contrib/receiver/githubreceiver` and decide which to adopt.
- [**everr-doctor-command**](todo/ideas/everr-doctor-command.md) — A CLI command that inspects the current repo's Everr integration and suggests improvements — missing configuration, outdated agent instructions, suboptimal workflow setup, etc. Designed to be run by a local AI assistant to self-diagnose and fix integration issues.
- [**guided-onboarding**](todo/ideas/guided-onboarding.md) — An interactive onboarding flow that walks new users through integrating Everr into their workflow and helps them get their first concrete improvements — e.g. identifying a flaky test, finding the slowest job, or setting up failure notifications.
- [**import-workflows-during-onboarding**](todo/ideas/import-workflows-during-onboarding.md) — Allow users to import existing CI/CD workflows into Everr as part of the onboarding flow.
- [**main-branches-metrics**](todo/ideas/main-branches-metrics.md) — Let users designate "main branches" so metrics (success rate, flakiness, slowest jobs/tests) focus on those instead of mixing in feature branch noise.
- [**merge-notifications-by-commit**](todo/ideas/merge-notifications-by-commit.md) — Merge multiple notifications triggered by the same commit into a single commit-level notification instead of showing one notification per failing run or job.
- [**multi-org-multi-account-login**](todo/ideas/multi-org-multi-account-login.md) — Let a single user be authenticated to multiple Everr accounts simultaneously, with automatic repo-to-account mapping so the right account is used based on context.
- [**per-run-log-zip-endpoint**](todo/ideas/per-run-log-zip-endpoint.md) — Use GitHub's per-run log zip endpoint (`GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs`) instead of per-job log fetches during workflow backfill. This downloads all job logs for a run in a single API call.
- [**post-optimization-annotations**](todo/ideas/post-optimization-annotations.md) — Allow users to annotate jobs and tests after optimization with the date, model type, and a note.
- [**queue-span-for-workflow-jobs**](todo/ideas/queue-span-for-workflow-jobs.md) — Emit a dedicated span representing the time a job spends queued (created → started) instead of computing queue time client-side from resource attributes.
- [**store-repository-id**](todo/ideas/store-repository-id.md) — Store the repositoryId to identify and associate data with specific repositories.

