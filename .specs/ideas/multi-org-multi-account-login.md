# Multi-Org and Multi-Account Login

## What
Support multiple orgs and accounts in both the CLI and desktop app, with per-repo account linking or org switching.

## Why
Users working across multiple GitHub orgs or Everr accounts currently have to re-authenticate to switch context, making cross-org workflows impractical.

## Who
Engineers and teams that belong to multiple orgs or manage multiple accounts.

## Rough appetite
big

## Notes
Two design options considered:
1. **Preferred**: link accounts to specific repos automatically — no manual switching needed, context is inferred from the working directory.
2. **Less desired**: global org switcher — explicit user action to change active org.
