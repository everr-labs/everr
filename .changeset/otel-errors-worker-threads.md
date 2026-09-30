---
"@everr/otel-errors": patch
---

Install no crash handlers in a worker thread. The handler's `process.exit(1)` ended the worker without the parent's `error` event, so a pool that restarts or retries on that event did not see the crash.
