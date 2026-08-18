# 45: A terminal says why it ended

**What to build:** Every `notification_suppressed` row explains itself. A
reader who finds a withheld notification learns why from the row, without
inferring it from which code path could have written it.

**The gap:** measured on the dev tenant, 30 days of terminal rows:

| `reason` | `silenced` | rows |
| --- | --- | --- |
| `""` | false | 34 |
| `no_longer_firing` | false | 23 |
| `""` | true | 10 |

The 10 silenced rows are self-explaining: `silenced` and `silence_id` carry
the story, and the vocabulary has no silence reason.

The 34 are the gap, and they are the largest group in the table. They come
from `flushAlertGroup`'s `droppedUnannounced` branch: a resolve whose fire
never went out, so nobody is told about the recovery either. The code comment
says exactly that; the row says only "withheld for good". The parallel case in
`processAlertEvent` writes `no_longer_firing` for what a reader would call the
same story, so the two paths disagree on a chain that looks identical from
ClickHouse.

**The decision this needs:** whether "the fire was never announced" reuses
`no_longer_firing` or earns its own value in `ALERTING_LIFECYCLE_REASONS`.
They are not the same event. `no_longer_firing` means the instance stopped
firing before delivery ran; this one means the fire itself was never
announced. Reusing it makes one query find both and loses the distinction;
splitting it adds a value that only this branch writes.

**Where:**

- `packages/app/src/server/alerting/delivery/flush-group.ts` (the
  `droppedUnannounced` map, which calls `journalTerminalRow(event)` with no
  options)
- `packages/app/src/data/alerting/vocabulary.ts` if the decision adds a value
- `crates/everr-core/assets/skills/everr-use-telemetry/rules/alert-history.md`
  and the Reference table in `../02-alerting-clickhouse-surface.md`

**Blocked by:** nothing.

**Status:** needs-decision

- [ ] The `droppedUnannounced` terminal carries a reason
- [ ] The reason vocabulary and both docs agree on what that reason means
- [ ] A query over `notification_suppressed` finds no row with an empty
      `reason` and `silenced = false`
