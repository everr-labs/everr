---
"@everr/cli": minor
---

Rewrite the CLI in Go. `everr local start` now runs the collector and chDB inside the CLI process instead of extracting and spawning a separate collector binary, and commands other than `everr local start` no longer load the chDB library.

Remove `everr ci`. GitHub Actions runs, jobs, steps, and their logs are telemetry in Everr, so query them with `everr cloud query`. Run `everr skills update` after upgrading, because the installed `everr-working-with-ci` skill still tells agents to run `everr ci`.
