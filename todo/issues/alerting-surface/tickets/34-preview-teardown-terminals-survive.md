# 34: Preview teardown terminals survive a crash

**What to build:** The `instance_closed` rows that close a torn-down
preview's open instances cannot be lost without trace. Demo: kill the
process between the retention delete's commit and the ClickHouse write,
then let the job run again; the terminals still land, once.

**Details:** found 2026-08-11 while verifying the deterministic-id review
finding. `deleteStalePreviews`
(`packages/app/src/data/previews/apply.server.ts:78-92`) reads the open
instances and deletes the preview rows in one transaction. The cascade
(`previews` to `alert_definitions` to `alert_instances`) then removes
every row the closure set was derived from, so the write at line 92 is
the only chance to record those terminals:

- The process dies after the commit and before the write: the rows never
  exist, and the next run derives an empty closure set.
- `recordAlertHistory` swallows insert failures by design, so a failed
  write logs and the task reports success.

Neither is recoverable. `history/preview-teardown.ts:41-46` states why:
the cascade removed the journal rows in the same transaction, so these
are projections with nothing to rebuild from.

There is no duplicate risk here. The closure set cannot be re-derived
after the commit, so a retry writes nothing at all.

**Impact today is a reading artifact:** the instance's last row stays
`instance_fired` or `instance_pending`, so the timeline shows an episode
that opened and never ended. Status renders per row today
(`data/alerting/history/event-types.ts:45-53`), so nothing reports a
wrong state yet. Preview rules are muted, so nothing pages either.

**Why it must land before 14:** the state view folds an instance's
current state with `argMax(event_type, (event_time, event_id))` over its
episode. A missing terminal stops being an odd-looking timeline and
becomes an alert the view reports as firing forever, with no row that can
ever correct it. That is the failure mode the surface exists to prevent.

**Shape:** enqueue a Graphile job inside the delete transaction carrying
what the rows need (definition identity, fingerprint, labels, episode
id). The payload becomes the repair source the cascade destroyed, so a
retry rebuilds the same rows. Derive each row's `event_id` and its
`event_time` from `(definitionId, fingerprint, episodeId)`, never from a
clock read at write time, so the retry converges on one row. This is the
shape `projectAlertLifecycle` already uses for the pause and delete
terminals.

Writing inside the transaction instead is the wrong fix: the insert
cannot roll back, so a transaction that fails after it leaves ClickHouse
claiming a teardown that never happened.

**Blocked by:** None; can start immediately. Must land before 14, which
turns a missing terminal into a wrong answer.

**Status:** ready-for-agent

- [ ] The teardown closures leave the delete transaction as a job payload, not as an in-process value
- [ ] The projection job's rows carry derived ids and derived times, so its retry converges on one row per instance
- [ ] Killing the process between the commit and the write still lands the terminals on the retry
- [ ] Rows lost before this ticket stay lost; that is stated, not repaired
