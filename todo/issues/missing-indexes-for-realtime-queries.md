# Missing indexes for realtime queries

## What
Several queries introduced or modified in the realtime feature lack supporting indexes, which will cause sequential scans and performance degradation as data grows.

## Where

### 1. Runs list query — `packages/app/src/data/runs-list/server.ts`
The `getRunsList` query filters and sorts by `last_event_at` with `tenant_id`. No composite index exists on `(tenant_id, last_event_at DESC)`. This is the primary list view query and runs on every page load.

### 2. Filter options query — `packages/app/src/data/runs-list/server.ts`
`getRunFilterOptions` runs three correlated subqueries doing `DISTINCT` + time-range filtering on `(tenant_id, status, COALESCE(run_completed_at, last_event_at))`. No covering index exists for this pattern (e.g. `(tenant_id, status, run_completed_at)` with included columns for `repository`, `ref`, `workflow_name`).

### 3. Watch matching runs query — `packages/app/src/data/watch.ts`
The matching runs query filters on `(tenant_id, repository, ref, sha, last_event_at)`. The existing `workflow_runs_tenant_repo_ref_sha_idx` covers `(tenant_id, repository, ref, sha)` but not `last_event_at`, so the time-range filter requires a post-index scan.

### 4. Watch baseline runs query — `packages/app/src/data/watch.ts`
The baseline runs query filters on `(tenant_id, repository, ref, status='completed', conclusion='success', run_completed_at IS NOT NULL, last_event_at)`. No composite index covers this combination. This runs on every notification-triggered fetch during active CI pipelines.

### 5. Watch workflow_jobs query — `packages/app/src/data/watch.ts`
The jobs query fetches all jobs for active trace IDs (`WHERE tenant_id = $1 AND trace_id = ANY($2::text[])`) including completed ones, then filters `status != 'completed'` in application code. Pushing the status filter into SQL would reduce data transfer. Additionally, there may be no index on `(tenant_id, trace_id)` for the `workflow_jobs` table.

## Priority
high

## Notes
Collect all index needs here before designing indexes — several queries may be served by fewer, broader indexes. Prefer extending existing indexes over adding new specialized ones.
