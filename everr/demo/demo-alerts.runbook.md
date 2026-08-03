# Demo alerts

The two demo rules exist to exercise the alerting UI, not to signal a real problem.

- **Always firing (demo)** counts clickety-clack metric points over the last 10 minutes. The aggregate query always returns one row, so the instance fires on the first evaluation and never resolves.
- **Flapping (demo)** fires for three minutes, then resolves for three minutes, forever. Use it to watch state transitions, notification churn, and event history.

If either alert woke you up: nothing is wrong. Silence it from Triage, or delete the two `everr/demo/*.alert.yaml` files and re-apply to remove the rules entirely.

## Recent evaluations

Every stored event the two rules produced in the selected time range:

```panel
kind: Panel
height: 320
spec:
  display: { name: Demo alert events }
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
              SELECT
                TimestampTime AS event_time,
                LogAttributes['alert.slug'] AS rule,
                LogAttributes['alert.event_type'] AS event_type,
                LogAttributes['alert.row_count'] AS row_count,
                LogAttributes['alert.instance_labels'] AS instance_labels
              FROM logs
              WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
                AND ServiceName = 'alert'
                AND LogAttributes['alert.slug'] IN ('demo/demo-always-firing', 'demo/demo-flapping')
              ORDER BY event_time DESC
              LIMIT 100
```
