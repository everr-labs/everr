# Show Branch and Failing Steps in `everr status`

## What
`everr status` output doesn't include the branch name or, for failed runs, the names of the failing jobs and steps.

## Where
`everr status` CLI command output.

## Steps to reproduce
Run `everr status` on a failed run — output shows run-level info (workflow name, conclusion, duration) but not which branch triggered the run or which specific jobs/steps failed.

## Expected
Branch name shown inline; for failed runs, failing jobs and steps surfaced without needing a separate `everr show --trace-id <id> --failed` call.

## Actual
Users have to run `everr show --trace-id <id> --failed` separately to find out what broke.

## Priority
unknown

## Notes
- Branch is already available in the run data.
- Failing jobs/steps would require an extra API call per failed run, or a new endpoint that returns status + failure summary together.
- Keep the default output compact — maybe show failures inline only when there are 1-2 failed jobs, and suggest `everr show --failed` for larger failures.
