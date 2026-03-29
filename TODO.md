# TODO

## Issues

- [**collector-tmp-uses-writable-layer-instead-of-tmpfs**](todo/issues/collector-tmp-uses-writable-layer-instead-of-tmpfs.md) — The collector writes temp files to the container's copy-on-write writable layer instead of a tmpfs mount.
- [**notifications-fire-for-non-pr-jobs**](todo/issues/notifications-fire-for-non-pr-jobs.md) — Notifications are sent for jobs that are not associated with a pull request or merge — only PR/merge jobs should trigger notifications.
- [**replace-filter-select-with-autocomplete-combobox**](todo/issues/replace-filter-select-with-autocomplete-combobox.md) — The FilterSelect component should be replaced with an autocomplete combobox.
- [**tables-alignment-and-sorting**](todo/issues/tables-alignment-and-sorting.md) — Table columns are misaligned and tables don't support sorting.

## Projects

- [**multi-org-multi-account-login**](todo/projects/multi-org-multi-account-login/shaping/problem.md) — In shaping
- [**protected-branches-metrics**](todo/projects/protected-branches-metrics/shaping/problem.md) — In shaping

## Ideas

- [**align-collector-with-upstream-receiver**](todo/ideas/align-collector-with-upstream-receiver.md) — Track the remaining differences between our `githubactionsreceiver` and the upstream `opentelemetry-collector-contrib/receiver/githubreceiver` and decide which to adopt.
- [**import-workflows-during-onboarding**](todo/ideas/import-workflows-during-onboarding.md) — Allow users to import existing CI/CD workflows into Everr as part of the onboarding flow.
- [**merge-notifications-by-commit**](todo/ideas/merge-notifications-by-commit.md) — Merge multiple notifications triggered by the same commit into a single commit-level notification instead of showing one notification per failing run or job.
- [**post-optimization-annotations**](todo/ideas/post-optimization-annotations.md) — Allow users to annotate jobs and tests after optimization with the date, model type, and a note.
- [**protected-branches-metrics**](todo/ideas/protected-branches-metrics.md) — Let users mark certain branches (e.g. main, develop) so metrics focus on those instead of mixing in temporary ones.
- [**queue-span-for-workflow-jobs**](todo/ideas/queue-span-for-workflow-jobs.md) — Emit a dedicated span representing the time a job spends queued (created → started) instead of computing queue time client-side from resource attributes.
- [**store-repository-id**](todo/ideas/store-repository-id.md) — Store the repositoryId to identify and associate data with specific repositories.

