---
"@everr/otel-web": minor
---

Record span status, links, array attributes, and standard timestamps on browser spans.

`setStatus` follows OK over ERROR over UNSET, and the status message is kept only for ERROR. `beforeSend` spans carry `status` and `links` in place of `error`. Attribute values may be arrays on logs and spans.

`startTime` and `end()` accept an HrTime, a Date, or epoch milliseconds. A fractional millisecond rounds to the nearest millisecond. `root: true` starts a new trace. `startSpan` without a kind is INTERNAL. `network()` still emits CLIENT spans.

`addEvent` and `recordException` record nothing.

A browser log emitted during `startActiveSpan`, until `end()`, carries that span's trace id, span id, and trace flags.
