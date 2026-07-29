# A silenced resolve strands group membership, so the group re-notifies forever

From the PR #225 review; see [pr-225-review-findings.md](./pr-225-review-findings.md),
finding 10.

## What
`process_event` drops a silenced or inhibited event and acks it *before* the group
bookkeeping runs. `add_to_group` is the only thing that clears the `fi:` (firing
instance) field for that instance, so a suppressed Resolved event leaves the
instance permanently marked as firing in its group hash.

Once the silence expires, the group's reminder loop sees a still-firing member
that will never produce another event, and re-notifies about a resolved alert on
every repeat interval, forever.

## Where
- `crates/clickety-clack/src/dispatcher/mod.rs:243-260`: `process_event` returns
  `true` (drop and ack) on `silence::matching_silence(...)` and again on
  `inhibition::is_inhibited(...)`, both before reaching `add_to_group`.
- `crates/clickety-clack/src/queue/groups.rs:199-205`: the `ADD_LUA` script is
  where `fi:{instance}` is set on a firing event and `HDEL`ed on a resolving one.
  Nothing else deletes it; `commit_drain` clears only `ev:*`.
- `crates/clickety-clack/src/dispatcher/mod.rs:617-693`: `flush_claimed_group`.
  At `:636` `firing_count = batch.firing.len()`, and at `:650` a due reminder with
  `firing_count > 0` notifies even when `batch.events` is empty. The comment at
  `:642-645` explicitly describes this as the intended path for "a group with a
  repeat interval and still-firing members whose reminder is due", including
  after a silence lifts.

## Failure scenario
1. A warning fires. It routes to a receiver whose route sets
   `repeat_interval_secs`, is delivered, and `fi:k` is set for instance `k`.
2. An operator creates a silence that matches it.
3. The underlying condition clears. CC emits a Resolved event for `k`.
4. `process_event` matches the silence, records the delivery as silenced, drops
   the event, and returns before `add_to_group`. `fi:k` is never deleted.
5. The silence expires.
6. `flush_claimed_group` now finds `batch.events` empty, `firing_count > 0`, and a
   reminder due. It notifies the receiver about an alert that resolved in step 3.
7. No further event for `k` is coming, so nothing will ever clear `fi:k`. Step 6
   repeats every `repeat_interval`, indefinitely.

The on-call symptom is a recurring page for an incident that closed, with no
corresponding alert visible anywhere in the UI.

## The precedent that solves half of it already
`crates/clickety-clack/src/dispatcher/slo_inhibit.rs:66-78` adds an explicit
`status = firing` target matcher to every auto-provisioned tier inhibition, with
a comment naming this exact hazard:

> Only Firing events are suppressed. A Resolved must always pass so a delivered
> page can close. Without this, a lower tier's Resolved event matches the
> target_matchers against a still-firing higher tier in the source-set and gets
> dropped at ingest, and the open incident never resolves (resolves don't page,
> so suppressing one buys no no-triple-page benefit).

That reasoning is fully general: suppressing a resolve buys nothing, because a
resolve does not page. The guard is simply missing for user-authored inhibitions
and for silences.

## Sketch
Two directions, and they are not exclusive:

- **Narrow, matching the existing precedent.** Make suppression status-aware at
  the ingest check: never suppress a Resolved event, for silences and
  user-authored inhibitions alike. This is closest to what the codebase already
  decided for tier inhibitions, and it means the silence still hides the noisy
  firing events while letting the close-out through.
  Note this changes visible behavior: `dispatcher/silence.rs` and
  `flush_filter.rs::silence_drops_firing_and_resolved` currently pin
  "silences drop resolves too", and `inhibition.rs::inhibition_is_status_agnostic`
  pins the status-agnostic behavior. Both tests encode the current design, so both
  would need to change deliberately rather than be worked around.
- **Structural.** Do the group bookkeeping before the suppression decision, so
  membership is always consistent regardless of whether the event is delivered.
  Suppression then only decides notification, not state. This is the more robust
  shape but a larger change to `process_event`'s ordering and its ack semantics.

## Test gap
`crates/clickety-clack/tests/it/queue/groups_it.rs:178` covers `fi:` being cleared
by a resolve that reaches `add_to_group`. Nothing covers the path where
suppression short-circuits before it, which is why this survives the suite. A
regression test wants to: fire, silence, resolve under the silence, expire the
silence, and assert no reminder is emitted.

## Related
Same file, adjacent concern: `dispatcher/mod.rs:846-859`, where a flush whose
channels have all vanished calls `commit_drain` and discards the buffer with no
delivery and no dead-letter. Both are "the drop path skips bookkeeping the
delivery path does".
