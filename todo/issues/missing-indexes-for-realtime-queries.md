# Missing indexes for realtime queries

## What
Several queries introduced or modified in the realtime feature lack supporting indexes, which will cause sequential scans and performance degradation as data grows.

## Where

### 1. Runs list query — `packages/app/src/data/runs-list/server.ts`
The `getRunsList` query filters and sorts by `last_event_at` with `tenant_id`. No composite index exists on `(tenant_id, last_event_at DESC)`. This is the primary list view query and runs on every page load.

### 2. Filter options query — `packages/app/src/data/runs-list/server.ts`
`getRunFilterOptions` runs three correlated subqueries doing `DISTINCT` + time-range filtering on `(tenant_id, status, COALESCE(run_completed_at, last_event_at))`. No covering index exists for this pattern (e.g. `(tenant_id, status, run_completed_at)` with included columns for `repository`, `ref`, `workflow_name`).

### 3. Watch status query — `packages/app/src/data/watch.ts`
The matching runs query filters on `(tenant_id, repository, ref, sha, last_event_at)`. The existing `workflow_runs_tenant_repo_ref_sha_idx` covers `(tenant_id, repository, ref, sha)` but not `last_event_at`, so the time-range filter requires a post-index scan.

## Priority
high

## Notes
Collect all index needs here before designing indexes — some may be covered by a single composite index. Consider:
- `(tenant_id, last_event_at DESC)` for the runs list
- `(tenant_id, status, run_completed_at DESC)` with INCLUDE columns for filter options
- Whether the existing `workflow_runs_tenant_repo_ref_sha_idx` should be extended to include `last_event_at`
