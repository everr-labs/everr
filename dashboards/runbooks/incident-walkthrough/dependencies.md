# Dependencies

The checkout path fans out to five downstream services. When p99 detaches
from p50, one of these edges is usually the bottleneck.

## Service call graph

Edge weight is call volume — the hot path is `web → api → db`:

```panel
kind: Panel
height: 420
spec:
  display: { name: "Call graph (req/min)" }
  plugin:
    kind: NodeGraph
    spec: { unit: req, showValues: true }
  queries:
    - kind: TestData
      spec:
        plugin:
          kind: TestData
          spec:
            scenario: csv
            columns: [source, target, value]
            rows:
              - [web, api, 420]
              - [web, auth, 90]
              - [api, db, 310]
              - [api, cache, 260]
              - [api, auth, 70]
              - [auth, db, 60]
              - [worker, db, 120]
              - [worker, queue, 200]
              - [api, queue, 80]
```

## Slowest spans right now

Sort by duration; in the real incident the top rows were all
`SELECT … FROM orders` on the primary:

```panel
kind: Panel
height: 360
spec:
  display: { name: "Recent spans" }
  plugin:
    kind: Table
    spec: { stickyHeader: true }
  queries:
    - kind: TestData
      spec:
        plugin:
          kind: TestData
          spec:
            scenario: table
            seed: 33
            rows: 60
            columns:
              - { name: Timestamp, time: true }
              - { name: SpanName, values: [GET /checkout, SELECT orders, GET /cart, INSERT payment, GET /search] }
              - { name: Service, values: [web, db, web, api, web] }
              - { name: StatusCode, values: [Ok, Ok, Ok, Error, Ok] }
              - { name: duration_ms, walk: { start: 120, noise: 80, min: 2, round: 1 } }
```

**Verdict:** the database edge carried the latency. Next question — *why
now?* See the [Timeline](./timeline.md) page.
