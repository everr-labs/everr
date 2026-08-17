# Demo alerts

The three demo rules exist to exercise the alerting UI, not to signal a real problem.

- **Always firing (demo)** returns three stable instances, two breaching and one healthy. The breaching pair fires on the first evaluation and never resolves.
- **Always pending (demo)** holds its condition for four minutes out of every five, against a `for` of ten continuous minutes. The one-minute gap resets the `for` clock every cycle, so the instance can neither fire nor leave pending.
- **Flapping (demo)** fires for three minutes, then resolves for three minutes, forever. Use it to watch state transitions, notification churn, and event history.

If any of them woke you up: nothing is wrong. Silence it from Triage, or delete the three `everr/demo/*.alert.yaml` files and re-apply to remove the rules entirely.

## Recent events

Every stored lifecycle, notification and delivery row the three rules produced in the selected time range.

Successful evaluations are excluded on purpose. All three rules evaluate every minute, so at this runbook's six-hour window they would be roughly a thousand rows and would bury the transitions this panel exists to show. Failed evaluations stay, because a demo rule that stops working should be visible here.

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
                             'demo/demo-flapping')
              ORDER BY event_time DESC
              LIMIT 100
```
