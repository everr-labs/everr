---
"@everr/cli": patch
---

The local store behind `everr local start` no longer loses telemetry in these cases:

- A metric value, histogram sum, bound or exemplar that is NaN or infinite is stored as that value. An attribute that is NaN or infinite is stored as the text `NaN`, `+Inf` or `-Inf`. Before, the whole request was dropped, including its other logs, spans or metrics.
