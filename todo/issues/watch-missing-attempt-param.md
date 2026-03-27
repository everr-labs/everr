# Watch Command Missing Attempt Parameter

## What
The `everr watch` CLI command has no `--attempt` parameter, so there's no way to wait for a specific retry attempt of a workflow run.

## Where
CLI watch command (`packages/desktop-app/src-cli/src/cli.rs`, `packages/app/src/routes/api/cli/runs/watch.ts`, `packages/app/src/data/watch.ts`)

## Steps to reproduce
1. A workflow run fails and is retried (attempt 2+)
2. Run `everr watch` — it watches the run but cannot target a specific attempt
3. No `--attempt` flag available

## Expected
`everr watch --attempt 2` should wait for the specified attempt to complete.

## Actual
No attempt parameter exists. The watch command operates on the latest attempt only.

## Priority
medium

## Notes
- The `workflow_runs` table already stores `attempts` — the data is available
- Needs changes in CLI arg parsing, API query params, and the watch query filter
