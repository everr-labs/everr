---
"@everr/otel-errors": patch
---

Detect the app's own `unhandledRejection` listener under Next.js. Next.js keeps these listeners in a private queue behind one filter listener and shows them only through `process.listeners`, so the check with `process.listenerCount` saw no other listener and exited the process.
