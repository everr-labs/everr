# Problem Statement: Multi-Org and Multi-Account Login

## What's broken or missing?

A single user cannot be simultaneously authenticated to two separate Everr accounts (e.g. personal and work). There is one global session. Switching context means logging out and back in, which is enough friction that users stop doing it — and work blind without CI data.

The repo-to-account mapping does not exist yet. There is no way to tell Everr "when I'm in this repo, use account X."

This affects both the CLI and the desktop app, which share the same auth layer.

## Who is affected?

Engineers who maintain personal and work accounts in Everr — the primary case is one person, two accounts, working across repos that belong to different orgs.

## Concrete examples

1. A developer starts the day on a client project (`~/work/client-a`). They're logged in as `work@example.com`. Later they open a personal project (`~/personal/side-project`). The CLI still uses the work session — they must log out and re-authenticate as `personal@example.com` to see their own CI data.
2. The same friction occurs in the desktop app: the active account is global, not scoped to what's open.

## Frequency vs. severity

Happens every time the developer switches repo context across accounts. Severity is high enough that users give up and don't switch — meaning Everr is effectively unusable for one of their accounts.

## What does success look like?

Opening the CLI or desktop app in any repo automatically uses the right account — inferred from a repo-to-account mapping stored in the Everr config. The developer never thinks about authentication.

## Open questions

- **First-time experience in an unlinked repo**: what should happen when no mapping exists for the current repo? Prompt to link? Fall back to the default account? This is TBD and needs to be resolved during shaping.
