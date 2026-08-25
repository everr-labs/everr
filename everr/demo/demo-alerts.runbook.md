# Demo alerts

The four demo rules exist to exercise the alerting UI, not to signal a real problem.

- **Always firing (demo)** watches request latency for four services against a 500ms threshold. `checkout-api` and `payments` are always over it, `search` is always under, and `reports` only reports for ten minutes out of every thirty so one lane always has a gap in it. The values follow a daily traffic curve with per-minute jitter and a spike roughly every half hour.
- **Always pending (demo)** watches a worker queue that backs up for four minutes and drains on the fifth, against a `for` of ten continuous minutes. The drain minute resets the `for` clock every cycle, so the instance can neither fire nor leave pending.
- **Broken query (demo)** throws for three minutes out of every fifteen, the way a rule breaks when the table under it is dropped or renamed. Use it to watch the degraded state, the last-error line, and `evaluation_failed` events. It reports a connection-pool utilization the rest of the time and never fires.
- **Flapping (demo)** watches a 5xx rate that swells over 3% and subsides again every twelve minutes, so it spends about six minutes firing and six resolved. Use it to watch state transitions, notification churn, and event history.

None of the four read real telemetry: each query synthesises its numbers from `now()`, so the rules work on an empty instance and still draw a series worth looking at.

If any of them woke you up: nothing is wrong. Silence it from Triage, or delete the four `everr/demo/*.alert.yaml` files and re-apply to remove the rules entirely.

## Recent events

Every stored lifecycle, notification and delivery row the four rules produced in the selected time range.

Successful evaluations are excluded on purpose. All four rules evaluate every minute, so at this runbook's six-hour window they would be roughly a thousand rows and would bury the transitions this panel exists to show. Failed evaluations stay, because a demo rule that stops working should be visible here.

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
                event_time,
                slug AS rule,
                event_type,
                reason,
                instance_labels
              FROM alert_events
              WHERE event_time >= {from:String} AND event_time <= {to:String}
                AND is_live
                AND event_type != 'evaluation_succeeded'
                AND slug IN ('demo/demo-always-firing',
                             'demo/demo-always-pending',
                             'demo/demo-flapping',
                             'demo/demo-broken-query')
              ORDER BY event_time DESC
              LIMIT 100
```
