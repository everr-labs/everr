# Incident walkthrough

> **Demo notebook.** Every panel below runs on the deterministic `TestData`
> datasource, so this renders identically on any workspace — no telemetry
> required. Use it as a template for real runbooks.

On 2026-06-10 around 14:00 UTC, checkout latency tripled while the error rate
stayed flat. This walkthrough reconstructs the investigation step by step.

## 1. Confirm the symptom

The current error rate and saturation, side by side:

```panel
kind: Panel
height: 180
spec:
  display: { name: "Error rate (last)" }
  plugin:
    kind: StatChart
    spec:
      calculation: last
      unit: "%"
      decimals: 2
      sparkline: true
      thresholds:
        mode: absolute
        defaultColor: "#22c55e"
        steps:
          - { value: 1, color: "#f59e0b" }
          - { value: 5, color: "#ef4444" }
  queries:
    - kind: TestData
      spec:
        plugin:
          kind: TestData
          spec:
            scenario: random_walk
            seed: 12
            series:
              - { name: error_pct, start: 0.4, noise: 0.15, min: 0, max: 3 }
```

```panel
kind: Panel
height: 240
spec:
  display: { name: "Connection pool saturation" }
  plugin:
    kind: GaugeChart
    spec:
      calculation: last
      unit: "%"
      decimals: 0
      thresholds:
        mode: absolute
        defaultColor: "#22c55e"
        steps:
          - { value: 70, color: "#f59e0b" }
          - { value: 90, color: "#ef4444" }
  queries:
    - kind: TestData
      spec:
        plugin:
          kind: TestData
          spec:
            scenario: random_walk
            seed: 13
            series:
              - { name: pool_pct, start: 86, noise: 5, min: 0, max: 100 }
```

The latency percentiles tell the real story — p99 detaches from p50, the
classic saturation signature:

```panel
ref: latency
```

## 2. Rule out the obvious

- [x] Error rate flat → not a crash loop
- [x] p50 stable, p99 climbing → queuing, not a code regression
- [ ] Traffic mix changed? → see the [Traffic](./traffic.md) page
- [ ] A dependency slowed down? → see the [Dependencies](./dependencies.md) page
- [ ] Did something ship? → see the [Timeline](./timeline.md) page

| Signal | Healthy | During incident |
| --- | --- | --- |
| p99 checkout | < 700 ms | 1.8 s |
| Pool saturation | < 60 % | 86–94 % |
| Error rate | < 0.5 % | 0.6 % |
