## What

`everr logs` should support a `--grep <pattern>` option to filter log output by a text pattern, similar to how `everr grep` works but scoped to a single trace/job/step.

## Where

CLI — `everr logs` command

## Steps to reproduce

N/A

## Expected

`everr logs --trace-id <id> --job-name <job> --step-number <n> --grep <pattern>` returns only matching lines.

## Actual

No `--grep` option exists; users must pipe through `grep` manually.

## Priority

low

## Notes

Would save a round-trip of piping through grep and make it easier to search large step logs directly.
