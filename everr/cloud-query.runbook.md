# Cloud query system errors

`everr cloud query` (POST /api/cli/sql) is failing for our-fault reasons. The alert fires on 2 or more `system_error` outcomes in 5 minutes. User errors (bad SQL, blocked functions, unreadable tables) are classified separately and never fire this alert, so every firing is an infrastructure problem.

## Confirm the blast radius

These are the failing requests behind the alert, newest first:

```panel
ref: recent-system-errors
```

The dominant `kind` names the cause:

```panel
ref: error-kind-breakdown
```

- `timeout` / `resource`: queries are too heavy (memory, or the 30s ClickHouse cap). Watch the latency panel below for a climb, and read the `tables` column above for the query involved. Often one tenant running an expensive query.
- `network`: ClickHouse reachability. Check the ClickHouse ECONNRESET runbook and the ClickHouse service health.
- `quota`: a tenant is exhausting its per-org quota bucket (`X-ClickHouse-Quota`). Confirm which `org` in the table above; the throttle is per-tenant, so this is contained.
- `internal`: an unexpected exception in the request path, not a ClickHouse error. Open the trace and read the captured exception (`error.source`).

## Watch latency

```panel
ref: latency
```

A climb toward 30s precedes timeout-kind failures. If p95 rises while volume stays flat, one class of query got heavier.

## Pivot into the trace

Every row in the system-errors table has a `trace_id`. Open it to see the full waterfall: the CLI command span (`everr-cli`), the server request span, and the leaf `ClickHouse QUERY` span. The panel below shows whether the time is inside ClickHouse or in the request path around it (guard, per-org user provisioning, serialization):

```panel
ref: clickhouse-spans
```

If the CLI span is missing from the trace, that is expected when the caller has no `EVERR_INGEST_KEY` or the 750ms flush cap dropped it. It does not affect the failure; the server span is authoritative.

## What is not an incident

- A spike in user errors. Those are caller SQL mistakes and are excluded from this alert by design.
- A single `system_error`. The 2-in-5-min threshold debounces transient ClickHouse ECONNRESET blips, which resolve on retry.

## Related

- ClickHouse ECONNRESET runbook (for `network`-kind failures).
- Cloud Query dashboard (traffic, outcome split, per-tenant usage, trace-join health).
