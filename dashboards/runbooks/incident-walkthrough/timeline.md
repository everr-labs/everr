# Timeline

Correlate the latency curve with component health over the same window.

```panel
ref: latency
```

## Component health

The db lane flips to `degraded` right where p99 takes off:

```panel
kind: Panel
height: 260
spec:
  display: { name: "Component states" }
  plugin:
    kind: StateTimeline
    spec:
      colors:
        up: "#22c55e"
        degraded: "#f59e0b"
        down: "#ef4444"
  queries:
    - kind: TestData
      spec:
        plugin:
          kind: TestData
          spec:
            scenario: table
            seed: 34
            rows: 40
            columns:
              - { name: ts, time: true }
              - { name: api,    values: [up, up, up, up, up, up, up, up, up, up] }
              - { name: db,     values: [up, up, up, degraded, degraded, degraded, up, up, up, up] }
              - { name: worker, values: [up, up, down, up, up, up, up, up, up, up] }
```

The degraded window lines up with a schema migration — see
[Deploy history](./timeline-deploys.md) for the full release record.
