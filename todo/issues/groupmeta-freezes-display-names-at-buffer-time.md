# GroupMeta freezes receiver display strings at buffer time

## The problem
Delivery identity is id-based end to end (receiver_id in routes and group
identity, channel ids in dedup keys and Redis metas), so renames never
re-bucket live groups, reset repeat timers, or break flush resolution. Display
is the one layer still frozen: `GroupMeta` (queue/groups.rs) stores two
human-readable strings once per group, first event wins via HSETNX:

- `group_key`: `receiver-name|k1=v1,k2=v2` (built in dispatcher/mod.rs from
  `grouping::group_key_string`). Flows into webhook notification payloads
  (`notify.rs`, the `group_key` field) and into the audit path.
- `receiver`: the clean receiver name, used as `delivery_targets` in the alert
  event log sink (dispatcher/mod.rs, the flush path).

Rename a receiver while one of its groups is open and every later flush of
that group (including `repeat_interval` reminders, which can run for hours or
days) keeps emitting the old name in webhook payloads and delivery facts until
the group closes. Correctness is unaffected; this is display staleness only.

## Why it was left
Fixing it means buffering the raw ingredients instead of the rendered strings:
`receiver_id` plus the group-by (key, value) pairs in `GroupMeta`, then
resolving the current receiver name and rendering `group_key` at flush time
(one extra name lookup per flush, or piggyback on the receiver read the
snapshot already does). That is real machinery for a rare and harmless lag, so
it was deliberately skipped when the id re-keying landed (2026-08-03).

## Sketch of the fix
1. `GroupMeta` gains `receiver_id: Uuid` and `group_values: Vec<(String,
   String)>`; drop the stored `group_key` and `receiver` strings (never
   deployed, so meta shape changes are free; otherwise keep serde defaults for
   rolling upgrades).
2. At flush (`dispatcher/mod.rs`), resolve the receiver name by id (a small
   store read, or extend `channels_by_ids`-style loading) and render
   `group_key_string(current_name, &group_values)` fresh.
3. `delivery_targets` gets the current name the same way. Decide explicitly
   whether the alert event log should keep name-at-delivery-time semantics
   (it records history, so the CURRENT name at each delivery is still the
   honest value; the point is it should be current as of the flush, not as of
   group creation).
4. A receiver deleted mid-group (routes gone, group still buffered) has no
   name to resolve; fall back to the id string, mirroring
   `PgStore::routes_for`.

## Where to look
- `crates/clickety-clack/src/queue/groups.rs` (`GroupMeta`)
- `crates/clickety-clack/src/dispatcher/mod.rs` (meta construction in
  `process_event`, flush path, `delivery_targets`)
- `crates/clickety-clack/src/dispatcher/grouping.rs` (`group_key_string`)
- Tests: `tests/it/queue/groups_it.rs`, `tests/it/dispatcher/
  group_reliability_it.rs`, the fan-out tests in `src/dispatcher/mod.rs`
