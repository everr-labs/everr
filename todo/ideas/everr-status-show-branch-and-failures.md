# Show Branch and Failing Steps in `everr status`

## What
Enhance `everr status` output to include the branch name and, for failed runs, the names of the failing jobs and steps.

## Why
Currently `everr status` shows run-level info (workflow name, conclusion, duration) but not which branch triggered the run or which specific jobs/steps failed. Users have to run `everr show --trace-id <id> --failed` separately to find out what broke. Surfacing this inline saves a round-trip.

## Who
CLI users monitoring CI from the terminal.

## Rough appetite
small

## Notes
- Branch is already available in the run data.
- Failing jobs/steps would require an extra API call per failed run, or a new endpoint that returns status + failure summary together.
- Keep the default output compact — maybe show failures inline only when there are 1-2 failed jobs, and suggest `everr show --failed` for larger failures.
