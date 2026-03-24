# TODO

## Issues

- [**app-download-only-in-onboarding**](todo/issues/app-download-only-in-onboarding.md) — The desktop app download link is only accessible during onboarding, with no way to reach it afterwards.
- [**collector-tmp-uses-writable-layer-instead-of-tmpfs**](todo/issues/collector-tmp-uses-writable-layer-instead-of-tmpfs.md) — The collector writes temp files to the container's copy-on-write writable layer instead of a tmpfs mount.
- [**filter-runs-by-branch-on-click**](todo/issues/filter-runs-by-branch-on-click.md) — Clicking a branch name in the runs list should filter the runs list to that branch.
- [**missing-indexes-for-realtime-queries**](todo/issues/missing-indexes-for-realtime-queries.md) — Several queries introduced or modified in the realtime feature lack supporting indexes, which will cause sequential scans and performance degradation as data grows.
- [**notification-window-steals-focus**](todo/issues/notification-window-steals-focus.md) — The Notification window takes focus when it opens, interrupting whatever the user is currently doing.
- [**notifications-fire-for-non-pr-jobs**](todo/issues/notifications-fire-for-non-pr-jobs.md) — Notifications are sent for jobs that are not associated with a pull request or merge — only PR/merge jobs should trigger notifications.
- [**pg-connection-per-sse-client**](todo/issues/pg-connection-per-sse-client.md) — `createSubscription` in `packages/app/src/db/subscribe.ts` opens a dedicated `pg.Client` (not from the pool) for every active SSE connection. This includes one connection per browser tab (via `/api/events/subscribe`) and one per CLI `watch` session (via `/api/cli/runs/watch`).
- [**remove-light-theme**](todo/issues/remove-light-theme.md) — Remove the light theme entirely so we only ship a dark theme.
- [**replace-filter-select-with-autocomplete-combobox**](todo/issues/replace-filter-select-with-autocomplete-combobox.md) — The FilterSelect component should be replaced with an autocomplete combobox.
- [**tables-alignment-and-sorting**](todo/issues/tables-alignment-and-sorting.md) — Table columns are misaligned and tables don't support sorting.
- [**watch-with-explicit-commit-should-skip-branch-filter**](todo/issues/watch-with-explicit-commit-should-skip-branch-filter.md) — When running `everr watch --commit f5ebfdb4`, the CLI still resolves and sends the current git branch as a query parameter. Since the user is targeting a specific commit, the branch filter is unnecessary and can cause the watch to miss runs if the commit exists on a different branch than the current one.

## Projects

- [**multi-org-multi-account-login**](todo/projects/multi-org-multi-account-login/shaping/problem.md) — In shaping
- [**protected-branches-metrics**](todo/projects/protected-branches-metrics/shaping/problem.md) — In shaping

## Ideas

- [**align-collector-with-upstream-receiver**](todo/ideas/align-collector-with-upstream-receiver.md) — Track the remaining differences between our `githubactionsreceiver` and the upstream `opentelemetry-collector-contrib/receiver/githubreceiver` and decide which to adopt.
- [**import-workflows-during-onboarding**](todo/ideas/import-workflows-during-onboarding.md) — Allow users to import existing CI/CD workflows into Everr as part of the onboarding flow.
- [**post-optimization-annotations**](todo/ideas/post-optimization-annotations.md) — Allow users to annotate jobs and tests after optimization with the date, model type, and a note.
- [**protected-branches-metrics**](todo/ideas/protected-branches-metrics.md) — Let users mark certain branches (e.g. main, develop) so metrics focus on those instead of mixing in temporary ones.
- [**queue-span-for-workflow-jobs**](todo/ideas/queue-span-for-workflow-jobs.md) — Emit a dedicated span representing the time a job spends queued (created → started) instead of computing queue time client-side from resource attributes.
- [**store-repository-id**](todo/ideas/store-repository-id.md) — Store the repositoryId to identify and associate data with specific repositories.

