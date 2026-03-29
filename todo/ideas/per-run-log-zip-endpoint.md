# Per-Run Log Zip Endpoint for Backfill

## What
Use GitHub's per-run log zip endpoint (`GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs`) instead of per-job log fetches during workflow backfill. This downloads all job logs for a run in a single API call.

## Why
Currently the collector fetches logs per-job. For backfill, the per-run zip endpoint reduces log-fetching cost from O(jobs) to O(runs). For 25 jobs across 5 runs, that's 5 calls instead of 25.

## Who
Internal optimization — no user-facing change.

## Rough appetite
small

## Notes
- The zip contains one log file per job, named by job ID.
- Would require either processing the zip in the backfill layer and passing logs to the collector, or adding zip support to the collector itself.
- Not needed for v1 given the small volume, but valuable if we increase the quota or add multi-repo import later.
- Consider also reading `x-ratelimit-remaining` on every GitHub API response and proactively throttling when it drops below a threshold, instead of only reacting to 429/403. This avoids hitting the limit in the first place.
