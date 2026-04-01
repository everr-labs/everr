# Show Failed Tests in `everr show`

## What
Add a `--tests` or `--failed-tests` flag to `everr show` that displays the list of failed tests for a run, including test name, module, and duration.

## Why
When a CI run fails due to test failures, the current `everr show --failed` output shows failed jobs and steps but doesn't surface which specific tests failed. Users have to dig into logs to find the failing test names. Surfacing them directly would speed up debugging.

## Who
CLI users investigating CI failures.

## Rough appetite
small

## Notes
- Test results are already stored as spans in ClickHouse with test name, module, and result.
- Could reuse or extend the existing test-related queries.
- Consider grouping by job/step for clarity when multiple jobs have test failures.
- Will need to change the test collector to handle failure logs — currently it doesn't capture them.
