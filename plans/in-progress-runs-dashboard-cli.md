# Show In-Progress Runs in Dashboard and CLI

## Summary
- Make `dashboard/runs` and `everr runs list` show `queued`, `in_progress`, and `completed` runs.
- Use `app.cdevents` for active runs and `traces` for completed runs and failure-step enrichment.
- Keep `everr status` limited to completed runs.

## Implementation
- Extend the shared runs-list contract with `status`, optional `traceId`, and optional `htmlUrl`.
- Merge completed trace-backed rows with active cdevents-backed rows in `getRunsList`.
- Keep completed runs exclusive to `traces` by excluding cdevents rows whose latest phase is `finished`.
- Preserve ordering and pagination on the merged result by latest event timestamp.
- Union `traces` and `app.cdevents` when building repo, branch, and workflow filter options.
- Enrich failing steps only for completed failed rows that still have a `traceId`.

## UI and CLI
- Add a lifecycle-state filter to `dashboard/runs`.
- Clear the conclusion filter when the dashboard state filter switches to `queued` or `in_progress`.
- Render active rows as external GitHub Actions links when `htmlUrl` exists.
- Keep completed rows linked to dashboard run details.
- Add `--status` to `everr runs list`.
- Make `/api/cli/status` request `status=completed`.

## Verification
- Query tests cover merged rows, status filtering, pagination inputs, and failure-step enrichment boundaries.
- Route tests cover `status` forwarding and invalid `status` rejection.
- CLI tests cover `runs list --status` parsing and request forwarding.
- Dashboard table tests cover readable active status text and active-vs-completed link behavior.
