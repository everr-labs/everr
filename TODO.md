# TODO

## Issues

- [**app-download-only-in-onboarding**](todo/issues/app-download-only-in-onboarding.md) — The desktop app download link is only accessible during onboarding, with no way to reach it afterwards.
- [**cli-list-workflow-names**](todo/issues/cli-list-workflow-names.md) — There's no CLI command to discover available workflow names, so users can't find valid values for `--workflow-name` filters without the web UI.
- [**collector-tmp-uses-writable-layer-instead-of-tmpfs**](todo/issues/collector-tmp-uses-writable-layer-instead-of-tmpfs.md) — The collector writes temp files to the container's copy-on-write writable layer instead of a tmpfs mount.
- [**filter-runs-by-branch-on-click**](todo/issues/filter-runs-by-branch-on-click.md) — Clicking a branch name in the runs list should filter the runs list to that branch.
- [**missing-indexes-for-realtime-queries**](todo/issues/missing-indexes-for-realtime-queries.md) — Several queries introduced or modified in the realtime feature lack supporting indexes, which will cause sequential scans and performance degradation as data grows.
- [**missing-links-to-github**](todo/issues/missing-links-to-github.md) — There are no links from Everr's run detail/list views to the corresponding GitHub Action run page or associated PR, forcing users to manually search on GitHub.
- [**notifications-fire-for-non-pr-jobs**](todo/issues/notifications-fire-for-non-pr-jobs.md) — Notifications are sent for jobs that are not associated with a pull request or merge — only PR/merge jobs should trigger notifications.
- [**pg-connection-per-sse-client**](todo/issues/pg-connection-per-sse-client.md) — `createSubscription` in `packages/app/src/db/subscribe.ts` opens a dedicated `pg.Client` (not from the pool) for every active SSE connection. This includes one connection per browser tab (via `/api/events/subscribe`) and one per CLI `watch` session (via `/api/cli/runs/watch`).
- [**replace-filter-select-with-autocomplete-combobox**](todo/issues/replace-filter-select-with-autocomplete-combobox.md) — The FilterSelect component should be replaced with an autocomplete combobox.
- [**tables-alignment-and-sorting**](todo/issues/tables-alignment-and-sorting.md) — Table columns are misaligned and tables don't support sorting.

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

