# clickety-clack TODO

## Group flush: close the take -> deliver crash window (at-least-once delivery)

### Status
The **claim -> take** crash window is already closed. `claim_due` now leases a group into
`cc:groupflush:inflight` instead of deleting its timer; `run_group_flusher` runs a
`reclaim_expired` pre-pass, and `flush_group` calls `release_claim` on every non-crash
return. A flusher that dies after claiming but before draining is recovered when its lease
expires. See `src/queue/groups.rs` (`CLAIM_LUA`, `RECLAIM_LUA`, `RELEASE_LUA`,
`CLAIM_LEASE_MS`) and `src/dispatcher/mod.rs` (`run_group_flusher`, `flush_group` /
`flush_claimed_group`).

### The remaining gap
`take_group` is **destructive**: its Lua (`TAKE_LUA` in `src/queue/groups.rs`) `HDEL`s the
`ev:*` fields and stamps `__last_flush__` before returning the batch. Delivery happens
afterward, in Rust, in `flush_claimed_group` (`src/dispatcher/mod.rs`). So if a flusher
crashes (or is SIGKILLed / OOM-killed) **after `take_group` drains the batch but before
delivery**:

- The `ev:*` events are already gone from Redis.
- The lease still recovers the *group*: it expires, `reclaim_expired` requeues it, another
  flusher reflushes -- but `take_group` now returns an **empty** batch, so nothing is
  delivered.
- Net: that one batch is silently lost. This is **at-most-once** delivery for a drained
  batch. (Still-firing `fi:*` members survive the take, so a repeat reminder eventually
  re-notifies them; a pure resolve, or a firing group with no repeat interval, is lost.)

This window is much narrower than the claim->take one (it requires a crash in the few ms
between the take round-trip and the delivery attempt), but it is real.

### Proposed fix: two-phase take
Split the drain from delivery so events are only removed once delivery is durably begun.

1. **Peek instead of drain.** Add a non-destructive read (or change `take_group` so it
   returns the batch and stamps `__last_flush__` but does NOT `HDEL` the `ev:*` fields
   yet). The group stays leased in `cc:groupflush:inflight`.
2. **Deliver.** Existing path. Delivery is already idempotent: `deliver_group_channels` ->
   `try_begin_notification` dedups per (channel, target, event) via the notifications
   ledger, so a reflush of the same batch after a crash will not double-send.
3. **Commit the drain.** Only after delivery is committed (ledger rows written), clear the
   `ev:*` fields for exactly the events that were delivered, then `release_claim`. If the
   flusher crashes before this step, the lease expires, the batch is still buffered, and
   the reflush re-delivers (deduped by the ledger).

### Watch out for
- **`__last_flush__` / re-arm interaction.** Today `take_group` stamps `__last_flush__`
  and `add_to_group` computes the next due from it. If the drain is deferred, decide when
  `__last_flush__` is stamped so a concurrent `add_to_group` still batches correctly and
  the group_interval math (`ADD_LUA`) holds.
- **New events arriving during delivery.** If `add_to_group` writes a new `ev:{fp}` while a
  flush is mid-delivery, the commit-drain must clear only the fields it delivered, not the
  newcomer. Clear by exact (field, value) or by the snapshot's known fingerprints; do not
  blanket-`HDEL` `ev:*`. The `et:*` eval_ts guard (`ADD_LUA`) already prevents a stale
  overwrite, but the drain scoping is separate.
- **Idempotency key coverage.** Confirm the ledger dedup key covers repeat reminders the
  way we want: `repeat_it.rs::still_firing_group_renotifies_after_repeat_interval` asserts
  reminders are intentionally NOT collapsed, so a reflush must not accidentally suppress a
  legitimately-due reminder nor double-send one.
- **`CLAIM_LEASE_MS` (60s).** A delivery slower than the lease lets another replica reclaim
  and reflush concurrently. Safe for normal alerts (deduped), but revisit if delivery
  backoff can approach 60s.

### Tests to add (container-tests, CI/Docker)
- Crash after take, before deliver -> batch is re-delivered exactly once (extend
  `tests/it/dispatcher/group_reliability_it.rs`).
- No double-send when a reflush races a still-in-flight delivery (ledger dedup).
- A new event buffered during delivery is not dropped by the commit-drain.

### Pointers
- `src/queue/groups.rs`: `TAKE_LUA`, `take_group`, `ADD_LUA`, lease scripts.
- `src/dispatcher/mod.rs`: `flush_group`, `flush_claimed_group`, `run_group_flusher`,
  `deliver_group_channels`.
- Ledger dedup: `dispatcher::dedup`, `store::try_begin_notification`.
- Existing reliability tests: `tests/it/dispatcher/group_reliability_it.rs`,
  `tests/it/queue/groups_it.rs`, `tests/it/dispatcher/repeat_it.rs`.
