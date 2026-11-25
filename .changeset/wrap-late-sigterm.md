---
"@everr/cli": patch
---

`everr wrap` now exits when it gets SIGTERM, SIGHUP or an interrupt just after the wrapped command finishes. Before, such a signal could be lost, and if a background process the command started still held its output open, `everr wrap` kept running until that process ended.
