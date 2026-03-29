# Per-repo install doesn't support Claude reading AGENTS.md

## What
The per-repo install writes instructions to `AGENTS.md`, but Claude Code only reads `CLAUDE.md`. Claude ignores `AGENTS.md` entirely, so repos installed with the current flow get no agent instructions picked up by Claude.

## Where
Per-repo install flow / documentation

## Priority
high

## Notes
Need to either generate a `CLAUDE.md` alongside `AGENTS.md`, or consolidate on a single file that both tools read.
