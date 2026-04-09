## What
Handle the case where a repo does not have a GitHub App installation when a command is run.

## Where
unknown

## Steps to reproduce
Run a command against a repo with no GitHub installation.

## Expected
Command reports the missing installation clearly and handles it gracefully.

## Actual
Behavior for a missing GitHub installation on the target repo is not handled well enough.

## Priority
unknown

## Notes
Applies when command execution depends on a GitHub installation existing for the repo.
