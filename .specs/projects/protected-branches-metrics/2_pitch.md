# Pitch: Main Branches Metrics

## Problem

Everr's success rate aggregates across all branches. Feature branches pollute the signal, masking regressions and improvements on the branches that actually represent CI health. There is no way to scope metrics to the branches that matter.

## Solution

Introduce the concept of "main branches" — a configurable list of branch names scoped at the org or repo level. The test-overview page gains a toggle to filter all its data to main branches only.

Resolution order:
1. Repo-specific config (if any rows exist for this `(tenantId, repository)`)
2. Org-wide defaults (if any rows exist with `repository = null` for this tenant)
3. Hardcoded fallback: `['main', 'master', 'develop']`

Users can configure org-wide defaults in org settings and override them per-repo in repo settings. At least one branch must always be configured at each level.

### Data model

A new `mainBranches` table in Postgres (via Drizzle):

```ts
export const mainBranches = pgTable('main_branches', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: bigint('tenant_id', { mode: 'number' })
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  repository: text('repository'), // null = org-wide default; e.g. "everr-labs/everr"
  branch: text('branch').notNull(),
}, (t) => [
  // Two partial unique indexes — Postgres NULLs are never equal, so a single index won't enforce uniqueness for org-wide rows
  uniqueIndex().on(t.tenantId, t.repository, t.branch).where(sql`repository IS NOT NULL`),
  uniqueIndex().on(t.tenantId, t.branch).where(sql`repository IS NULL`),
]);
```

No seeding required. The query layer resolves branches in order: repo-specific rows → org-wide rows (`repository = null`) → hardcoded defaults `['main', 'master', 'develop']`. An empty result at any level moves to the next. "All branches" mode is only triggered by the UI toggle, never by the absence of config rows.

### Query layer (fat marker sketch)

All test-overview queries filter by branch. The branch list is resolved using the 3-level order above. The filter is only omitted when the "All branches" toggle is active:

```sql
SELECT
  toStartOfDay(timestamp) AS day,
  countIf(conclusion = 'success') / count() AS success_rate
FROM workflow_runs
WHERE tenant_id = {tenantId}
  AND repository = {repository}
  AND branch IN ({mainBranches})  -- omitted when "all branches" toggle is active
  AND timestamp >= {from}
GROUP BY day
ORDER BY day
```

No `PREWHERE` — standard `WHERE` only.

### UI (breadboard)

**Test overview — toggle**
```
[ Test Overview ]                          [Main branches] [All branches]

  [ Success Rate chart ]  ← filtered by toggle
  [ Other charts...     ]  ← filtered by toggle
```

A single toggle in the test-overview header: "Main branches" (default) and "All branches." All charts and data on the test-overview page respond to the toggle. The toggle state is reflected in the URL (e.g. `?branches=all`) so it's shareable and survives page refresh.

**Org settings page — main branches defaults**
```
Main branches (org-wide defaults)
Applied to all repos unless overridden per-repo.

  ● main        [×]
  ● master      [×]
  ● develop     [×]
  + Add branch
```

**Repo settings page — main branches config**
```
Main branches
These branches are used for metrics filtering.
Overrides the org-wide defaults for this repo.

  ● main        [×]
  ● develop     [×]
  + Add branch
```

Free-text input for adding a branch name. No validation against existing branches — users may add branches that don't exist yet. The remove button `[×]` is disabled on the last remaining branch in the UI. The API also enforces this — a DELETE that would leave zero branches returns a 422 error.


## Rabbit Holes

- **Branch name matching**: branch names are case-sensitive in git but users may type them differently. Keep matching exact and case-sensitive — don't try to normalise.
- **NULL uniqueness in Postgres**: `NULL != NULL` in unique indexes, so a single `UNIQUE(tenantId, repository, branch)` won't prevent duplicate org-wide rows. Use two partial unique indexes: one for `repository IS NOT NULL`, one for `repository IS NULL`.
- **Empty configured list vs. all-branches**: an empty `mainBranches` table means "use defaults", not "show all branches." Make this distinction explicit in the query layer — the "all branches" mode is only triggered by the UI toggle, not by the absence of config rows.
- **Empty state when no main branches match recent runs**: a user could configure `main` but all recent runs are on feature branches. The chart will be empty. Show a clear empty state ("No runs on main branches in this period") rather than a blank chart.

## No-gos

- **Flakiness and slowest jobs as standalone metrics**: the toggle filters existing test-overview data to main branches, but dedicated flakiness and slowest jobs views are out of scope this cycle.
- **Regex or glob patterns for branch names**: exact match only. No wildcards like `release/*`.
- **Per-workflow or per-job main branch config**: the setting is per-repo, applied uniformly.
- **Automatic sync with GitHub branch protection rules**: no integration with GitHub's protected branches concept.

## Testing Strategy

Integration-first using Vitest with real ClickHouse and Postgres instances.

- `mainBranches` read/write: add, remove, list per `(tenantId, repository)` and org-wide (`repository = null`); partial unique constraints enforce no duplicates at either level; DELETE of last branch at either level returns 422.
- Resolution order: repo-specific rows take precedence over org-wide rows; org-wide rows take precedence over hardcoded defaults; all three levels verified with table-driven tests.
- Query filter: with repo-specific config, with org-wide config only, with no config (falls back to hardcoded defaults), and with all-branches toggle active (filter omitted).
- UI: component tests for the toggle state, repo settings CRUD, and org settings CRUD.
