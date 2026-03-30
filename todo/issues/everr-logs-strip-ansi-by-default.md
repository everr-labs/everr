# Strip ANSI escape codes from `everr logs` output

## What

`everr logs` should strip ANSI escape codes from log output by default. Currently raw ANSI sequences are returned, which breaks grep and makes output harder to read in non-terminal contexts.

## Where

CLI `everr logs` command

## Steps to reproduce

1. Run `everr logs --trace-id <id> --job-name <job> --step-number <n>`
2. Pipe output to `grep <pattern>` — matches fail due to embedded ANSI codes

## Expected

Clean text output with ANSI codes stripped by default. Optionally a `--color` flag to preserve them.

## Actual

Raw ANSI escape sequences are included in the output, breaking grep and other text processing.

## Priority

small

## Notes

Every grep attempt fails until users manually strip ANSI (e.g. with `sed`). Stripping by default is the right call — add a `--color` flag for users who want the original formatting.
