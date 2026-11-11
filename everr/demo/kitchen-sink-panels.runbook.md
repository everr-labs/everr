# Panels

Panels on a page share one hover cursor and the runbook's time range. Back to the [index](./kitchen-sink.runbook.md), or down to the [nested page](panels/nested).

## A shared panel, by reference

Declared once under `spec.panels` and embedded with `ref:`, at the default height.

```panel
ref: requests
```

The same panel again, shorter:

```panel
ref: requests
height: 180
```

## Inline panels

A stat:

```panel
kind: Panel
height: 160
spec:
  display: { name: p95 latency }
  plugin:
    kind: StatChart
    spec:
      calculation: last
      sparkline: true
      valueFormat: { unit: ms, decimals: 1 }
  queries:
    - kind: TestData
      spec:
        plugin:
          kind: TestData
          spec:
            scenario: random_walk
            seed: 21
            series:
              - { name: p95_ms, start: 120, noise: 12, min: 0 }
```

A stacked bar chart over time:

```panel
kind: Panel
height: 260
spec:
  display: { name: Spans by status, description: Stacked bars over the runbook's range }
  plugin:
    kind: BarChart
    spec: { stacking: stacked, showLegend: true }
  queries:
    - kind: TestData
      spec:
        plugin:
          kind: TestData
          spec:
            scenario: random_walk
            seed: 5
            points: 24
            labelColumn: status
            series:
              - { name: Ok, start: 800, noise: 60, min: 0 }
              - { name: Error, start: 40, noise: 12, min: 0 }
```

A table:

```panel
kind: Panel
height: 280
spec:
  display: { name: Slowest spans }
  plugin:
    kind: Table
    spec: {}
  queries:
    - kind: TestData
      spec:
        plugin:
          kind: TestData
          spec:
            scenario: table
            seed: 41
            rows: 20
            columns:
              - { name: Timestamp, time: true }
              - { name: SpanName, values: [GET /users, POST /orders, GET /health, POST /login] }
              - { name: StatusCode, values: [Ok, Error, Unset] }
              - { name: duration_ms, walk: { start: 50, noise: 30, min: 0, round: 1 } }
```

## A panel between paragraphs

Text right before a panel, to check the spacing above it.

```panel
ref: requests
height: 200
```

Text right after a panel, to check the spacing below it.
