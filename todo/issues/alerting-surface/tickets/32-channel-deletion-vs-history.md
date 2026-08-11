# 32: Notification history does not make a channel undeletable

**What to build:** A channel that no receiver and no rule references can be
deleted, even after it has delivered notifications. Only deliveries that
still have a send to make hold the channel open.

**Details:** `deleteChannel` refused when any `alert_deliveries` row pointed
at the channel, so the first successful notification pinned the channel for
the 90 day delivery retention window, and a channel in regular use could
never be deleted at all. The delivery journal does not need the channel row:
`channel_name` is on every delivery, and the durable history in ClickHouse
carries `delivery_targets` and the channel type without joining PostgreSQL.
The foreign key only protects the send path, which reads
`alert_channels.encrypted_config` to dispatch an in-flight delivery.

Found while verifying the alerting surface end to end on 2026-08-10. The UI
reported the refusal honestly ("Deletion did not finish"), but the confirm
panel promised a delete it could not make.

The same read exposed a second defect on the send path: `sendAlertDelivery`
joined `alert_channels` with an inner join and returned silently when the
row was missing, so a delivery whose channel disappeared mid-flight left no
failure and no journal entry. That reads as a false "nothing was sent",
which the durability rule forbids.

**Blocked by:** None.

**Status:** done

- [x] `alert_deliveries.channel_id` is nullable and clears on channel delete
- [x] Deletion blocks only on in-flight deliveries, and says how many
- [x] A deleted channel fails its in-flight deliveries terminally, with a journal entry
- [x] The confirm panel states what it checked
