---
"@everr/cli": patch
---

Fixes for the local store behind `everr local start`:

- A metric value, histogram sum, bound or exemplar that is NaN or infinite is stored as that value. An attribute that is NaN or infinite is stored as the text `NaN`, `+Inf` or `-Inf`. Before, the whole request was dropped, including its other logs, spans or metrics.
- A log or span whose attributes spell one key twice, such as `http.method` next to `http: {method: ...}`, is stored and keeps one of the two values. Before, it was dropped along with every other log or span sent in the same batch.
- When one kind of metric (gauge, sum, histogram, exponential histogram or summary) cannot be stored, a retry sends only that kind again. Before, every retry stored the other kinds again, so one data point could show up several times.
- Running `USE <database>` through `everr local query` no longer breaks later queries. Every query now reads `logs`, `traces` and the `metrics_*` tables by their bare names, whatever an earlier query selected. Before, a `USE` stayed in effect for every reader, the local UI included, until `everr local stop`.
