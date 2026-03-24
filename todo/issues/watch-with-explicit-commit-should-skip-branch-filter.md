# `everr watch --commit <sha>` should not require or apply the branch filter

## What
When running `everr watch --commit f5ebfdb4`, the CLI still resolves and sends the current git branch as a query parameter. Since the user is targeting a specific commit, the branch filter is unnecessary and can cause the watch to miss runs if the commit exists on a different branch than the current one.

## Expected
When `--commit` is passed explicitly, only the repo should be auto-resolved from git context. The branch should be omitted from the query unless the user explicitly passes `--branch`.

## Where
- `packages/desktop-app/src-cli/src/core.rs` — `watch()` function unconditionally requires branch resolution via `args.branch.or(git.branch).ok_or_else(...)`.
- `packages/app/src/routes/api/cli/runs/watch.ts` — the watch endpoint currently requires `branch` in its query schema.
- `packages/app/src/data/watch.ts` — `getWatchStatus` uses branch in the SQL WHERE clause.

## Fix
1. Make `branch` optional in the watch CLI args — only auto-resolve from git when `--commit` is NOT provided.
2. Make `branch` optional in the watch API endpoint query schema.
3. Update `getWatchStatus` to conditionally filter by branch only when provided.
