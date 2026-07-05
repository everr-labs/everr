# App server latency

Request latency as measured at the server entry span, for the services that
emit the event loop delay metric. Use this page to find _which_ endpoints are
slow; use the [event loop page](./eventloop-delay.runbook.md) to decide
whether the loop is the reason.

A quick way to tell them apart: an event loop stall slows **everything at
once** (all endpoints, all percentiles drift together), while an endpoint
doing heavy work of its own slows **only itself**, and usually only its tail.

## 1. Request latency percentiles

```panel
ref: request-latency
```

- **p50 flat, p99 spiky** → a slow subset: one endpoint, one tenant, one
  pathological payload. Find it in the tables below.
- **All percentiles rise together** → shared cause: event loop stall, DB
  saturation, or overload. Check the event loop page first.

## 2. Slowest endpoints

```panel
ref: slow-endpoints
```

Ranked by p95. High p95 with high call volume hurts users the most; high max
with low volume points at a pathological input rather than a systemic
problem. The `errors` column is there to spot endpoints that are slow
_because_ they fail (timeouts, retries).

## 3. Slowest server functions

TanStack server functions all share the `POST /_serverFn/:id` endpoint, so
the table above lumps them together. This one breaks them out by function
name:

```panel
ref: server-functions
```

## 4. Heaviest operations

Endpoints and server functions ranked by **total time** in the window. The
tables above find what is slow per call; this one finds what dominates the
server overall — a fast operation called thousands of times can cost more
than a slow one called twice, and the repeat offender is usually at the top:

```panel
ref: top-operations
```

## 5. Slowest individual requests

The worst single requests in the window, with their trace IDs:

```panel
ref: slowest-requests
```

Reading a suspect trace: time covered by child spans (DB calls, HTTP calls)
is _awaited_, not blocking. Time with **no child span activity** is where
the handler held the event loop: JSON parse/stringify of big payloads,
serialization of large result sets, sync crypto, tight loops. A request can
also be the victim rather than the culprit (slow _because_ the loop was
stalled by something else), so trust the repeat pattern over any single
trace.

## 6. What to do

| Signal                       | Likely cause                          | Action                                                                                |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| One endpoint slow, rest fine | That endpoint's own work              | Open its slowest traces; look at the longest child span                               |
| Everything slow at once      | Event loop stall or shared dependency | Go to the [event loop page](./eventloop-delay.runbook.md); check DB/ClickHouse health |
| Slow and erroring            | Timeouts against a dependency         | Check the dependency; add timeouts/circuit breaking                                   |
| Slow only at traffic peaks   | Overload                              | Scale out or shed load                                                                |
