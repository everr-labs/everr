# Multi-org multi-account login

## What
Let a single user be authenticated to multiple Everr accounts simultaneously, with automatic repo-to-account mapping so the right account is used based on context.

## Why
Switching between personal and work accounts requires logging out and back in. The friction means users stop switching and Everr becomes unusable for one of their accounts.

## Who
Engineers who maintain personal and work accounts across repos belonging to different orgs.

## Rough appetite
big

## Notes
- Affects both CLI and desktop app (shared auth layer).
- Needs a repo-to-account mapping in the Everr config.
- Open question: what happens in an unlinked repo? Prompt to link, fall back to default, or something else.
