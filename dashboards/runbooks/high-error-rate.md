# High error rate

When the 5xx rate spikes, start here.

```panel
ref: error-rate
```

Compare against overall request volume:

```panel
dashboard: demo/service-health-stats
panel: request-rate
```

One-off breakdown by service:

```panel
kind: Panel
height: 300
spec:
  display: { name: "Errors by service" }
  plugin:
    kind: Table
    spec: {}
  queries:
    - kind: ClickHouseSQL
      spec:
        plugin:
          kind: ClickHouseSQL
          spec:
            query: |
              SELECT toString(ServiceName) AS service,
                     count() AS error_spans
              FROM traces
              WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
                AND StatusCode = 'Error'
              GROUP BY service
              ORDER BY error_spans DESC
              LIMIT 15
```

See the Triage page for next steps.
