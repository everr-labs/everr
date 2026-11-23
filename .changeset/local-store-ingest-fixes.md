---
"@everr/cli": patch
---

The local store behind `everr local start` no longer loses telemetry in these cases:

- A metric value, histogram sum, bound or exemplar that is NaN or infinite is stored as that value. An attribute that is NaN or infinite is stored as the text `NaN`, `+Inf` or `-Inf`. Before, the whole request was dropped, including its other logs, spans or metrics.
- A log or span whose attributes spell one key twice, such as `http.method` next to `http: {method: ...}`, is stored with the first value. Before, it was dropped along with every other log or span sent in the same batch.
- When one kind of metric (gauge, sum, histogram, exponential histogram or summary) cannot be stored, a retry sends only that kind again. Before, every retry stored the other kinds again, so one data point could show up several times.
