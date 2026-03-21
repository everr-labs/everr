# Dev build should install an everr-dev executable

## What
The dev build of the CLI should produce and install an `everr-dev` binary, and the repo agent instructions should tell assistants to prefer `everr-dev` over `everr` when it is available.

## Where
- CLI build/install tooling (dev profile)
- `crates/everr-core/assets/discovery-instructions.md` (repo agent instructions)

## Steps to reproduce
N/A

## Expected
Running the dev build installs `everr-dev` alongside `everr`. The repo `AGENTS.md` instructions say: use `everr-dev` instead of `everr` if available.

## Actual
Dev builds produce the same `everr` binary, making it indistinguishable from a release install. Repo agent instructions always reference `everr`.

## Priority
medium

## Notes
The separate binary name prevents dev-built commands from silently shadowing a production install.
