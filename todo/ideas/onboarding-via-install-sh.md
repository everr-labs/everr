# Full onboarding via install.sh

## What
A single `install.sh` script that handles the complete Everr onboarding end-to-end: user registration, org creation, CLI install, and runs import — all without leaving the terminal.

## Why
The current onboarding requires jumping between the terminal and a browser or web UI. Making the full flow terminal-native removes that friction and lets new users get to their first imported runs entirely from the command line.

## Who
New users setting up Everr for the first time.

## Rough appetite
unknown

## Notes
- Covers: user registration, org creation, CLI installation, runs import.
- Goal: limited browser interactions required for the initial onboarding.
- Per-repo init command (`everr init`) to configure a repo after the CLI is installed.
- Support both `npx everr init` and a bash install path so users can onboard without a prior global install.
