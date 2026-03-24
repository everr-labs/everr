# Missing CLI command to list workflow names

## What
There's no CLI command to discover available workflow names, so users can't find valid values for `--workflow-name` filters without the web UI.

## Where
CLI / `packages/desktop-app/src-cli`

## Steps to reproduce
1. Run `everr runs list --workflow-name <???>` — no way to discover valid names from the CLI

## Expected
A command (e.g. `everr runs filters` or `everr workflows list`) that returns available workflow names, repos, and branches.

## Actual
No such command exists. Users must check the web UI or guess.

## Priority
medium

## Notes
The server already has `getRunFilterOptions` returning repos, branches, and workflow names — just needs a CLI wrapper.
