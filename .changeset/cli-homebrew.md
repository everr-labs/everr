---
"@everr/cli": minor
---

The CLI can now be installed with Homebrew on macOS (Apple silicon) and Linux: `brew install everr-labs/tap/everr`. When the CLI was installed this way, `everr upgrade` tells you to run `brew upgrade everr` instead of replacing the binary Homebrew manages, the update notice suggests the same command, and `everr uninstall` prints `brew uninstall everr` as the way to remove the binary.
