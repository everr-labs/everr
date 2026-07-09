pub mod cache;
pub mod dedup;
pub mod email;
pub mod flush_filter;
pub mod grouping;
pub mod inhibition;
pub mod matching;
pub mod notify;
pub mod pagerduty;
pub mod registry;
pub mod render;
pub mod retry;
pub mod routing;
pub mod silence;
pub mod slack;
pub mod telegram;

pub use dedup::dedup_key;
pub use email::EmailNotifier;
pub use notify::{Notification, Notifier, NotifyError, WebhookNotifier};
pub use pagerduty::PagerDutyNotifier;
pub use registry::Notifiers;
pub use retry::{backoff_delay, deliver_with_retry};
pub use slack::SlackNotifier;
pub use telegram::TelegramNotifier;

use crate::crypto::SecretCipher;
use crate::dispatcher::cache::{FilterCache, SnapshotProvider};
use crate::domain::channel::Channel;
use crate::domain::ids::TenantId;
use crate::domain::sink::{AlertLogSink, DeliveryFacts};
use crate::domain::Event;
use crate::queue::groups::{GroupMeta, GroupStore};
use crate::queue::{EventBus, EventEntry};
use crate::stores::{PgStore, StoreError};
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

const MAX_ATTEMPTS: u32 = 4;
/// How often the flusher polls for due groups when none are immediately ready.
const FLUSH_TICK: Duration = Duration::from_millis(200);

/// The notification-ledger slice of the store that delivery bookkeeping needs.
/// Split out as a trait so channel fan-out can be unit-tested against an in-memory
/// ledger; `PgStore` is the production implementation.
#[async_trait]
pub trait NotificationLedger: Send + Sync {
    async fn try_begin_notification(
        &self,
        dedup_key: &str,
        tenant: TenantId,
        channel: &str,
        target: &str,
    ) -> Result<bool, StoreError>;
    async fn mark_notification_sent(
        &self,
        tenant: &TenantId,
        dedup_key: &str,
        attempts: u32,
    ) -> Result<(), StoreError>;
    async fn mark_notification_failed(
        &self,
        tenant: &TenantId,
        dedup_key: &str,
        attempts: u32,
        error: &str,
    ) -> Result<(), StoreError>;
}

#[async_trait]
impl NotificationLedger for PgStore {
    async fn try_begin_notification(
        &self,
        dedup_key: &str,
        tenant: TenantId,
        channel: &str,
        target: &str,
    ) -> Result<bool, StoreError> {
        PgStore::try_begin_notification(self, dedup_key, tenant, channel, target).await
    }
    async fn mark_notification_sent(
        &self,
        tenant: &TenantId,
        dedup_key: &str,
        attempts: u32,
    ) -> Result<(), StoreError> {
        PgStore::mark_notification_sent(self, tenant, dedup_key, attempts).await
    }
    async fn mark_notification_failed(
        &self,
        tenant: &TenantId,
        dedup_key: &str,
        attempts: u32,
        error: &str,
    ) -> Result<(), StoreError> {
        PgStore::mark_notification_failed(self, tenant, dedup_key, attempts, error).await
    }
}

fn now_ms() -> i64 {
    (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

/// Run the dispatcher consume loop until `shutdown` flips true. Routed events are
/// buffered into Redis groups (flushed by `run_group_flusher`); no-routes tenants keep
/// the immediate per-event webhook firehose.
#[allow(clippy::too_many_arguments)]
pub async fn run_dispatcher(
    consumer: String,
    store: PgStore,
    bus: Arc<dyn EventBus>,
    notifiers: Arc<Notifiers>,
    groups: Arc<dyn GroupStore>,
    cache: Arc<FilterCache>,
    cipher: Arc<dyn SecretCipher>,
    sink: Arc<dyn AlertLogSink>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            break;
        }
        let entries = match bus.consume(&consumer, 16, 2000).await {
            Ok(e) => e,
            Err(e) => {
                tracing::error!(error = %e, "event consume failed");
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {}
                    _ = shutdown.changed() => {}
                }
                continue;
            }
        };
        let acks = process_event_batch(
            &store,
            bus.as_ref(),
            notifiers.as_ref(),
            groups.as_ref(),
            cache.as_ref(),
            cipher.as_ref(),
            sink.as_ref(),
            &entries,
        )
        .await;
        for (id, ack_ok) in acks {
            if ack_ok {
                if let Err(e) = bus.ack(&id).await {
                    tracing::error!(error = %e, "event ack failed");
                }
            }
            // if !ack_ok: entry stays in the PEL (unacked) — preserved for Phase 3 reclaim.
        }
    }
    tracing::info!("dispatcher stopped");
}

/// Resolve an event to its delivery plan. Routed events are buffered into their group(s)
/// in Redis and a flush timer is armed; no-routes tenants fall back to the immediate
/// Phase 2a subscription firehose. Returns true if the stream entry is safe to ack
/// (false only when a required input could not be loaded — leaves it in the PEL).
///
/// Public so the load-test harness can drive a single event; not a stable API.
#[allow(clippy::too_many_arguments)]
pub async fn process_event(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    groups: &dyn GroupStore,
    cache: &FilterCache,
    cipher: &dyn SecretCipher,
    sink: &dyn AlertLogSink,
    entry: &EventEntry,
) -> bool {
    let ev: &Event = &entry.event;

    // Suppressed (preview-rule) events never notify: drop at ingest, before
    // silence/inhibition processing, before group buffering, and before the no-routes
    // subscription firehose. They still reach SSE (the pump tails the stream directly)
    // and the OTLP alert-log export (the events role has its own consumer group).
    if ev.suppressed {
        tracing::debug!(entry_id = %entry.id, "suppressed event; dropping before dispatch");
        return true;
    }

    let labels = routing::match_labels(ev);
    let snap = match cache.snapshot(ev.tenant.clone()).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, entry_id = %entry.id, tenant = ?ev.tenant,
                "loading filter snapshot failed; leaving event unacked for reclaim");
            return false;
        }
    };
    let now = time::OffsetDateTime::now_utc();
    if let Some(sid) = silence::matching_silence(&labels, &snap.silences, now) {
        sink.record_delivery(
            ev,
            &DeliveryFacts {
                delivery_targets: vec![],
                silence_id: Some(sid.to_string()),
                silenced: true,
            },
        )
        .await;
        tracing::debug!(entry_id = %entry.id, "event silenced; dropping");
        return true;
    }
    if inhibition::is_inhibited(&labels, &ev.instance_key, &snap.inhibitions, &snap.firing) {
        tracing::debug!(entry_id = %entry.id, "event inhibited; dropping");
        return true;
    }

    if snap.routes.is_empty() {
        return firehose_deliver(store, bus, notifiers, cipher, sink, ev, &entry.id).await;
    }

    let by_name: HashMap<&str, &[String]> = snap
        .receivers
        .iter()
        .map(|r| (r.name.as_str(), r.channels.as_slice()))
        .collect();
    let now = now_ms();
    let mut all_handled = true;

    for target in routing::select_grouping_targets(&snap.routes, &labels) {
        let channel_names = match by_name.get(target.receiver.as_str()) {
            Some(c) => *c,
            None => {
                tracing::warn!(receiver = %target.receiver,
                    "route references unknown receiver; skipping");
                continue;
            }
        };
        let values = grouping::group_by_values(&labels, &target.grouping.group_by);
        let gid = grouping::group_id(
            &ev.tenant,
            &target.receiver,
            &target.grouping.group_by,
            &values,
        );
        let group_key = grouping::group_key_string(&target.receiver, &values);
        // The meta buffers channel NAMES only; the flusher resolves them to their
        // stored configs at delivery time (so config edits between buffering and
        // flush are picked up, and no secret ever reaches Redis).
        let meta = GroupMeta {
            tenant: ev.tenant.as_str().to_string(),
            channels: channel_names.to_vec(),
            group_key,
            receiver: target.receiver.clone(),
        };
        let fp = grouping::fingerprint(ev);
        let wait_ms = target.grouping.group_wait_secs as i64 * 1000;
        let interval_ms = target.grouping.group_interval_secs as i64 * 1000;
        let firing = ev.status == crate::domain::EventStatus::Firing;
        let repeat_ms = target
            .grouping
            .repeat_interval_secs
            .map(|v| v as i64 * 1000);
        if let Err(e) = groups
            .add_to_group(
                &gid,
                &meta,
                &fp,
                ev,
                now,
                wait_ms,
                interval_ms,
                firing,
                repeat_ms,
            )
            .await
        {
            tracing::error!(error = %e, group = %gid,
                "buffering event into group failed; leaving event unacked for reclaim");
            all_handled = false;
        }
    }
    all_handled
}

/// Process a consumed batch concurrently, returning the ack decision per entry. Each
/// `process_event` future is independent; `join_all` overlaps their Redis round-trips over
/// the multiplexed connection without spawning (borrowed refs, no `'static` needed). Public
/// so the load harness drives the same path production does; not a stable API.
///
/// Intra-batch ordering is NOT preserved: futures interleave, so two events for the same
/// instance within one batch may buffer into their group in either order. This is safe today
/// — group buffering keys by fingerprint and `group_dedup_key` folds in `eval_ts`, so the
/// next evaluation self-corrects within a flush interval — but grouping logic must not come
/// to depend on within-batch event order.
#[allow(clippy::too_many_arguments)]
pub async fn process_event_batch(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    groups: &dyn GroupStore,
    cache: &FilterCache,
    cipher: &dyn SecretCipher,
    sink: &dyn AlertLogSink,
    entries: &[EventEntry],
) -> Vec<(crate::queue::EventId, bool)> {
    futures::future::join_all(entries.iter().map(|entry| async move {
        let ack = process_event(store, bus, notifiers, groups, cache, cipher, sink, entry).await;
        (entry.id.clone(), ack)
    }))
    .await
}

/// Immediate per-event webhook delivery for tenants with no routes (Phase 2a behavior).
#[allow(clippy::too_many_arguments)]
async fn firehose_deliver(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    cipher: &dyn SecretCipher,
    sink: &dyn AlertLogSink,
    ev: &Event,
    entry_id: &crate::queue::EventId,
) -> bool {
    let subs = match store.subscriptions_for(cipher, ev.tenant.clone()).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, entry_id = %entry_id, tenant = ?ev.tenant,
                "loading subscriptions failed; leaving event unacked in PEL for later reclaim");
            return false;
        }
    };
    let notif = Notification::single(ev);
    let mut all_handled = true;
    for s in subs {
        let channel = "webhook";
        let target = s.webhook_url;
        let key = dedup::dedup_key(channel, &target, ev);
        match store
            .try_begin_notification(
                &key,
                ev.tenant.clone(),
                channel,
                &dedup::redact_target(&target),
            )
            .await
        {
            Ok(true) => {}
            Ok(false) => continue,
            Err(e) => {
                tracing::error!(error = %e, "begin notification failed");
                all_handled = false;
                continue;
            }
        }
        if deliver_one(store, bus, notifiers, channel, &target, &key, &notif, ev).await {
            // Record the delivery as an OTLP `delivery` log (target = channel name,
            // matching the pre-multi-channel firehose shape).
            let facts = DeliveryFacts {
                delivery_targets: vec![channel.to_string()],
                silence_id: None,
                silenced: false,
            };
            sink.record_delivery(ev, &facts).await;
        }
    }
    all_handled
}

/// The group flusher: every replica claims due groups and delivers each as one batch.
#[allow(clippy::too_many_arguments)]
pub async fn run_group_flusher(
    store: PgStore,
    bus: Arc<dyn EventBus>,
    notifiers: Arc<Notifiers>,
    groups: Arc<dyn GroupStore>,
    cache: Arc<FilterCache>,
    cipher: Arc<dyn SecretCipher>,
    sink: Arc<dyn AlertLogSink>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            break;
        }
        let ids = match groups.claim_due(now_ms(), 32).await {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(error = %e, "claim_due failed");
                Vec::new()
            }
        };
        if ids.is_empty() {
            tokio::select! {
                _ = tokio::time::sleep(FLUSH_TICK) => {}
                _ = shutdown.changed() => {}
            }
            continue;
        }
        for gid in ids {
            flush_group(
                &store,
                bus.as_ref(),
                notifiers.as_ref(),
                groups.as_ref(),
                cache.as_ref(),
                cipher.as_ref(),
                sink.as_ref(),
                &gid,
            )
            .await;
        }
    }
    tracing::info!("group flusher stopped");
}

/// Load the tenant snapshot and drop suppressed events from a claimed flush batch.
///
/// `take_group` has already removed this batch from the group store, so a snapshot-load
/// failure cannot simply return — the alerts would vanish silently. Instead the
/// representative event is dead-lettered (observable, recoverable) and `None` is returned
/// to tell the caller to stop. On success `Some(remaining)` is returned, where `remaining`
/// is the surviving events after silence/inhibition filtering (possibly empty).
///
/// Split out from [`flush_group`] so this branch can be unit-tested against a failing
/// [`SnapshotProvider`] without a live Postgres — it depends only on trait objects.
async fn filter_or_dead_letter(
    bus: &dyn EventBus,
    cache: &dyn SnapshotProvider,
    sink: &dyn AlertLogSink,
    tenant: TenantId,
    events: Vec<Event>,
    gid: &str,
    now: time::OffsetDateTime,
) -> Option<Vec<Event>> {
    let snap = match cache.snapshot(tenant).await {
        Ok(s) => s,
        Err(e) => {
            let reason = format!("loading tenant snapshot failed: {e}");
            tracing::error!(error = %e, group = %gid,
                "loading tenant snapshot failed; dead-lettering claimed batch");
            let rep = events[0].clone();
            if let Err(de) = bus.dead_letter(&rep, &reason).await {
                tracing::error!(dead_letter_error = %de, group = %gid,
                    "snapshot failure AND dead-letter write failed; batch lost");
            }
            return None;
        }
    };
    Some(crate::dispatcher::flush_filter::filter_suppressed(&snap, events, now, sink).await)
}

/// Public so the load-test harness can drive a single group flush; not a stable API.
#[allow(clippy::too_many_arguments)]
pub async fn flush_group(
    store: &PgStore,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    groups: &dyn GroupStore,
    cache: &FilterCache,
    cipher: &dyn SecretCipher,
    sink: &dyn AlertLogSink,
    gid: &str,
) {
    let taken_at = now_ms();
    let batch = match groups.take_group(gid, taken_at).await {
        Ok(Some(g)) => g,
        Ok(None) => return,
        Err(e) => {
            tracing::error!(error = %e, group = %gid, "take_group failed");
            return;
        }
    };
    let meta = batch.meta;
    let repeat_ms = batch.repeat_interval_ms.filter(|r| *r > 0);
    let firing_count = batch.firing.len();

    // Pick what this flush delivers: the buffered batch when there is one; otherwise,
    // for a group with a repeat interval and still-firing members whose reminder is due,
    // the firing set itself (a repeat notification). `last_notified` of None counts as
    // due so a group whose only send was eaten by a flush-time silence still gets a
    // reminder once the silence lifts.
    let (events, is_repeat) = if !batch.events.is_empty() {
        (batch.events, false)
    } else if let Some(r) = repeat_ms {
        let due = batch.last_notified_ms.is_none_or(|ln| taken_at - ln >= r);
        if firing_count > 0 && due {
            (batch.firing, true)
        } else {
            // Not due yet (a normal flush notified in the meantime) or nothing firing.
            // Keep the reminder loop alive for still-firing members.
            if firing_count > 0 {
                if let Some(ln) = batch.last_notified_ms {
                    if let Err(e) = groups.arm_repeat(gid, ln + r).await {
                        tracing::error!(error = %e, group = %gid, "arm_repeat failed");
                    }
                }
            }
            return;
        }
    } else {
        return; // nothing active to deliver (timer fired on an emptied group)
    };

    // A still-firing group with a repeat interval always gets its next reminder check
    // armed BEFORE the delivery attempt, so a flush-time silence or a delivery failure
    // cannot kill the reminder loop. Resolved-only groups (empty firing set) never
    // re-arm and therefore never repeat.
    if let Some(r) = repeat_ms {
        if firing_count > 0 {
            if let Err(e) = groups.arm_repeat(gid, taken_at + r).await {
                tracing::error!(error = %e, group = %gid, "arm_repeat failed");
            }
        }
    }

    let tenant = TenantId::from_trusted(meta.tenant.clone());
    let now = time::OffsetDateTime::now_utc();
    let events = match filter_or_dead_letter(bus, cache, sink, tenant, events, gid, now).await {
        Some(evs) => evs,
        None => return, // snapshot load failed; batch dead-lettered inside the helper
    };
    if events.is_empty() {
        return; // every event suppressed at flush time (silence/inhibition)
    }
    let notif = Notification {
        group_key: meta.group_key.clone(),
        events,
    };
    let tenant = TenantId::from_trusted(meta.tenant);
    // Representative event for the dead-letter record (the batch shares a group key).
    let rep = notif.events[0].clone();
    // Resolve the buffered channel NAMES to their stored configs now, at delivery
    // time. take_group has already claimed and cleared this batch from Redis, so a
    // load failure cannot simply return - the alerts would vanish silently; the
    // representative event is dead-lettered instead (observable, recoverable).
    let loaded = match store
        .channels_by_names(cipher, &tenant, &meta.channels)
        .await
    {
        Ok(chs) => chs,
        Err(e) => {
            let reason = format!("loading channels for group flush failed: {e}");
            tracing::error!(error = %e, group = %gid,
                "loading channels failed; dead-lettering claimed batch");
            if let Err(de) = bus.dead_letter(&rep, &reason).await {
                tracing::error!(dead_letter_error = %de, group = %gid,
                    "channel load failure AND dead-letter write failed; batch lost");
            }
            return;
        }
    };
    let channels = resolve_channels(gid, &meta.channels, loaded);
    let outcome = deliver_group_channels(
        store, bus, notifiers, gid, &channels, is_repeat, taken_at, &tenant, &notif, &rep,
    )
    .await;
    // A notification was committed for this group on at least one channel; stamp it so
    // the repeat clock measures from the latest send.
    if outcome.begun {
        if let Err(e) = groups.mark_notified(gid, taken_at).await {
            tracing::error!(error = %e, group = %gid, "mark_notified failed");
        }
    }
    // One OTLP `delivery` log per flush, keyed by the clean receiver name exactly as
    // before multi-channel receivers (the group key additionally carries grouping
    // values, which don't belong in the target field). Per-channel detail stays in
    // tracing logs and the per-channel notifications ledger rows.
    if outcome.sent {
        let facts = DeliveryFacts {
            delivery_targets: vec![meta.receiver.clone()],
            silence_id: None,
            silenced: false,
        };
        sink.record_delivery(&rep, &facts).await;
    }
}

/// What one group flush's channel fan-out accomplished.
struct FanOutOutcome {
    /// At least one channel committed a new notification row (not a dedup skip).
    begun: bool,
    /// At least one channel delivered successfully.
    sent: bool,
}

/// Order the loaded channels by the buffered name list, skipping (with an error log,
/// never a panic) any name whose channel no longer exists. Missing names are the
/// delete-vs-flush race: the channel API refuses to delete a referenced channel, so a
/// gap here means the referencing receiver went away between buffering and flush.
///
/// A repeated name resolves to repeated entries (it is NOT reported as missing).
/// The API rejects duplicate references at the boundary, so this only arises from
/// rows stored before that guard; the redundant entry is harmless downstream
/// because the name-keyed dedup collapses its send.
fn resolve_channels(gid: &str, names: &[String], loaded: Vec<Channel>) -> Vec<Channel> {
    let by_name: HashMap<&str, &Channel> = loaded.iter().map(|ch| (ch.name.as_str(), ch)).collect();
    names
        .iter()
        .filter_map(|name| match by_name.get(name.as_str()) {
            Some(ch) => Some((*ch).clone()),
            None => {
                tracing::error!(group = %gid, channel = %name,
                    "channel missing at delivery time; skipping this channel");
                None
            }
        })
        .collect()
}

/// Fan one flush out to every resolved channel of the group's receiver. Each channel
/// gets its own dedup key (keyed by the channel NAME, stable across config edits) and
/// its own ledger row. A failing channel never short-circuits the rest: failures are
/// recorded (ledger + dead letter) per channel and the loop keeps going.
#[allow(clippy::too_many_arguments)]
async fn deliver_group_channels(
    ledger: &dyn NotificationLedger,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    gid: &str,
    channels: &[Channel],
    is_repeat: bool,
    taken_at: i64,
    tenant: &TenantId,
    notif: &Notification,
    rep: &Event,
) -> FanOutOutcome {
    let mut outcome = FanOutOutcome {
        begun: false,
        sent: false,
    };
    for ch in channels {
        let kind = ch.config.channel_name();
        let target = ch.config.target();
        // A repeat folds the take timestamp into the key so the identical still-firing
        // set yields a NEW notification instead of deduping against the original send.
        let key = if is_repeat {
            grouping::repeat_dedup_key(gid, &ch.name, &notif.events, taken_at)
        } else {
            grouping::group_dedup_key(gid, &ch.name, &notif.events)
        };
        match ledger
            .try_begin_notification(&key, tenant.clone(), kind, &dedup::redact_target(&target))
            .await
        {
            Ok(true) => {}
            Ok(false) => continue, // identical active set already delivered on this channel
            Err(e) => {
                tracing::error!(error = %e, group = %gid, channel = %ch.name,
                    "begin notification failed");
                continue;
            }
        }
        outcome.begun = true;
        if deliver_one(ledger, bus, notifiers, kind, &target, &key, notif, rep).await {
            outcome.sent = true;
        }
    }
    outcome
}

/// Shared delivery + bookkeeping: look up the notifier, retry, then record sent/failed
/// and dead-letter on permanent/exhausted failure. `rep` is the event used for the
/// dead-letter record. Returns true when delivery succeeded.
#[allow(clippy::too_many_arguments)]
async fn deliver_one(
    ledger: &dyn NotificationLedger,
    bus: &dyn EventBus,
    notifiers: &Notifiers,
    channel: &str,
    target: &str,
    key: &str,
    notif: &Notification,
    rep: &Event,
) -> bool {
    let metrics = notifiers.engine_metrics();
    let notifier = match notifiers.get(channel) {
        Some(n) => n,
        None => {
            let reason = format!("no notifier registered for channel '{channel}'");
            if let Err(e) = ledger
                .mark_notification_failed(&rep.tenant, key, 0, &reason)
                .await
            {
                tracing::error!(error = %e, key = %key, "mark_notification_failed write failed");
            }
            let _ = bus.dead_letter(rep, &reason).await;
            metrics.record_delivery(
                channel,
                rep.tenant.as_str(),
                crate::otel::metrics::DeliveryOutcome::NoNotifier,
            );
            tracing::error!(channel = %channel, "no notifier registered; dead-lettered");
            return false;
        }
    };
    match retry::deliver_with_retry(notifier.as_ref(), target, notif, MAX_ATTEMPTS).await {
        Ok(attempts) => {
            metrics.record_delivery(
                channel,
                rep.tenant.as_str(),
                crate::otel::metrics::DeliveryOutcome::Sent,
            );
            if let Err(e) = ledger
                .mark_notification_sent(&rep.tenant, key, attempts)
                .await
            {
                tracing::error!(error = %e, key = %key,
                    "mark_notification_sent failed; row stuck 'pending' despite successful delivery");
            }
            true
        }
        Err((attempts, err)) => {
            metrics.record_delivery(
                channel,
                rep.tenant.as_str(),
                crate::otel::metrics::DeliveryOutcome::Failed,
            );
            let reason = err.to_string();
            if let Err(e) = ledger
                .mark_notification_failed(&rep.tenant, key, attempts, &reason)
                .await
            {
                tracing::error!(error = %e, key = %key, "mark_notification_failed write failed");
            }
            match bus.dead_letter(rep, &reason).await {
                Ok(()) => {
                    tracing::warn!(channel = %channel, target = %dedup::redact_target(target), error = %err,
                    "notification dead-lettered")
                }
                Err(e) => tracing::error!(dead_letter_error = %e, original = %err,
                    channel = %channel, target = %dedup::redact_target(target),
                    "delivery failed AND dead-letter write failed"),
            }
            false
        }
    }
}

#[cfg(test)]
mod fan_out_tests {
    use super::*;
    use crate::domain::channel::ChannelConfig;
    use crate::domain::event::EventStatus;
    use crate::domain::ids::{InstanceKey, RuleId};
    use crate::domain::rule::Severity;
    use crate::queue::{EventEntry, EventId, QueueError, TailCursor};
    use async_trait::async_trait;
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use uuid::Uuid;

    fn event() -> Event {
        let mut labels = BTreeMap::new();
        labels.insert("service".to_string(), "api".to_string());
        let rule = RuleId(Uuid::nil());
        let tenant = TenantId::from_trusted("t1".to_string());
        let key = InstanceKey::new(rule, &labels);
        Event::new(
            tenant,
            rule,
            key,
            EventStatus::Firing,
            labels,
            None,
            Severity::Critical,
            BTreeMap::new(),
            time::OffsetDateTime::UNIX_EPOCH,
        )
    }

    /// In-memory `NotificationLedger`: dedup-by-key insert plus final status per row.
    #[derive(Default)]
    struct MemLedger {
        rows: Mutex<BTreeMap<String, (String, String)>>, // key -> (channel, status)
    }
    #[async_trait]
    impl NotificationLedger for MemLedger {
        async fn try_begin_notification(
            &self,
            dedup_key: &str,
            _tenant: TenantId,
            channel: &str,
            _target: &str,
        ) -> Result<bool, StoreError> {
            let mut rows = self.rows.lock().unwrap();
            if rows.contains_key(dedup_key) {
                return Ok(false);
            }
            rows.insert(
                dedup_key.to_string(),
                (channel.to_string(), "pending".to_string()),
            );
            Ok(true)
        }
        async fn mark_notification_sent(
            &self,
            _tenant: &TenantId,
            dedup_key: &str,
            _attempts: u32,
        ) -> Result<(), StoreError> {
            self.rows.lock().unwrap().get_mut(dedup_key).unwrap().1 = "sent".to_string();
            Ok(())
        }
        async fn mark_notification_failed(
            &self,
            _tenant: &TenantId,
            dedup_key: &str,
            _attempts: u32,
            _error: &str,
        ) -> Result<(), StoreError> {
            self.rows.lock().unwrap().get_mut(dedup_key).unwrap().1 = "failed".to_string();
            Ok(())
        }
    }

    impl MemLedger {
        fn statuses_by_channel(&self) -> BTreeMap<String, String> {
            self.rows
                .lock()
                .unwrap()
                .values()
                .map(|(ch, st)| (ch.clone(), st.clone()))
                .collect()
        }
    }

    /// EventBus recording dead-letter calls; every other method is unreachable here.
    #[derive(Default)]
    struct DeadLetterBus {
        calls: AtomicUsize,
    }
    #[async_trait]
    impl EventBus for DeadLetterBus {
        async fn publish(&self, _ev: &Event) -> Result<(), QueueError> {
            unreachable!()
        }
        async fn consume(
            &self,
            _c: &str,
            _n: usize,
            _b: usize,
        ) -> Result<Vec<EventEntry>, QueueError> {
            unreachable!()
        }
        async fn ack(&self, _id: &EventId) -> Result<(), QueueError> {
            unreachable!()
        }
        async fn tail(
            &self,
            _cursor: &TailCursor,
            _n: usize,
            _b: usize,
        ) -> Result<Vec<EventEntry>, QueueError> {
            unreachable!()
        }
        async fn dead_letter(&self, _ev: &Event, _reason: &str) -> Result<(), QueueError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    /// Notifier that counts sends and either always succeeds or always fails permanently
    /// (permanent so the retry loop never sleeps in tests).
    struct FakeNotifier {
        name: &'static str,
        fail: bool,
        sends: AtomicUsize,
    }
    #[async_trait]
    impl Notifier for FakeNotifier {
        fn channel(&self) -> &'static str {
            self.name
        }
        async fn send(&self, _t: &str, _n: &Notification) -> Result<(), NotifyError> {
            self.sends.fetch_add(1, Ordering::SeqCst);
            if self.fail {
                Err(NotifyError::Permanent("boom".into()))
            } else {
                Ok(())
            }
        }
    }

    fn named(name: &str, config: ChannelConfig) -> Channel {
        Channel {
            id: Uuid::new_v4(),
            tenant: TenantId::from_trusted("t1".to_string()),
            name: name.to_string(),
            config,
        }
    }

    fn webhook_channel(name: &str, url: &str) -> Channel {
        named(name, ChannelConfig::Webhook { url: url.into() })
    }

    fn email_channel(name: &str, to: &str) -> Channel {
        named(
            name,
            ChannelConfig::Email {
                to: vec![to.into()],
            },
        )
    }

    #[tokio::test]
    async fn fan_out_delivers_to_every_channel() {
        let ledger = MemLedger::default();
        let bus = DeadLetterBus::default();
        let webhook = Arc::new(FakeNotifier {
            name: "webhook",
            fail: false,
            sends: AtomicUsize::new(0),
        });
        let email = Arc::new(FakeNotifier {
            name: "email",
            fail: false,
            sends: AtomicUsize::new(0),
        });
        let mut notifiers = Notifiers::new();
        notifiers.register(webhook.clone());
        notifiers.register(email.clone());
        let ev = event();
        let notif = Notification::single(&ev);
        let channels = vec![
            webhook_channel("ops-hook", "http://x/h"),
            email_channel("ops-mail", "a@x.test"),
        ];

        let out = deliver_group_channels(
            &ledger, &bus, &notifiers, "gid-1", &channels, false, 0, &ev.tenant, &notif, &ev,
        )
        .await;

        assert!(out.begun && out.sent);
        assert_eq!(webhook.sends.load(Ordering::SeqCst), 1);
        assert_eq!(email.sends.load(Ordering::SeqCst), 1);
        let statuses = ledger.statuses_by_channel();
        assert_eq!(statuses.len(), 2, "one ledger row per channel");
        assert_eq!(statuses.get("webhook").map(String::as_str), Some("sent"));
        assert_eq!(statuses.get("email").map(String::as_str), Some("sent"));
        assert_eq!(bus.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn fan_out_attempts_every_channel_when_one_fails() {
        let ledger = MemLedger::default();
        let bus = DeadLetterBus::default();
        let slack = Arc::new(FakeNotifier {
            name: "slack",
            fail: true,
            sends: AtomicUsize::new(0),
        });
        let email = Arc::new(FakeNotifier {
            name: "email",
            fail: false,
            sends: AtomicUsize::new(0),
        });
        let mut notifiers = Notifiers::new();
        notifiers.register(slack.clone());
        notifiers.register(email.clone());
        let ev = event();
        let notif = Notification::single(&ev);
        // Failing channel FIRST: the healthy one after it must still be attempted.
        let channels = vec![
            named(
                "team-slack",
                ChannelConfig::Slack {
                    url: "https://hooks/x".into(),
                },
            ),
            email_channel("ops-mail", "a@x.test"),
        ];

        let out = deliver_group_channels(
            &ledger, &bus, &notifiers, "gid-1", &channels, false, 0, &ev.tenant, &notif, &ev,
        )
        .await;

        assert!(out.begun, "the failing channel still began a notification");
        assert!(
            out.sent,
            "the healthy channel delivered despite the failure"
        );
        assert_eq!(slack.sends.load(Ordering::SeqCst), 1);
        assert_eq!(email.sends.load(Ordering::SeqCst), 1);
        let statuses = ledger.statuses_by_channel();
        assert_eq!(statuses.get("slack").map(String::as_str), Some("failed"));
        assert_eq!(statuses.get("email").map(String::as_str), Some("sent"));
        assert_eq!(
            bus.calls.load(Ordering::SeqCst),
            1,
            "only the failed channel dead-letters"
        );
    }

    #[tokio::test]
    async fn fan_out_dedups_per_channel_on_redelivery() {
        let ledger = MemLedger::default();
        let bus = DeadLetterBus::default();
        let webhook = Arc::new(FakeNotifier {
            name: "webhook",
            fail: false,
            sends: AtomicUsize::new(0),
        });
        let email = Arc::new(FakeNotifier {
            name: "email",
            fail: false,
            sends: AtomicUsize::new(0),
        });
        let mut notifiers = Notifiers::new();
        notifiers.register(webhook.clone());
        notifiers.register(email.clone());
        let ev = event();
        let notif = Notification::single(&ev);
        let channels = vec![
            webhook_channel("ops-hook", "http://x/h"),
            email_channel("ops-mail", "a@x.test"),
        ];

        let first = deliver_group_channels(
            &ledger, &bus, &notifiers, "gid-1", &channels, false, 0, &ev.tenant, &notif, &ev,
        )
        .await;
        // Same channel NAMES but an edited config: the dedup key is name-stable, so
        // a config rotation between redeliveries must not re-send the identical set.
        let rotated = vec![
            webhook_channel("ops-hook", "http://x/h-rotated"),
            email_channel("ops-mail", "b@x.test"),
        ];
        let second = deliver_group_channels(
            &ledger, &bus, &notifiers, "gid-1", &rotated, false, 0, &ev.tenant, &notif, &ev,
        )
        .await;

        assert!(first.begun && first.sent);
        assert!(
            !second.begun && !second.sent,
            "identical set dedups even across a config edit"
        );
        assert_eq!(webhook.sends.load(Ordering::SeqCst), 1);
        assert_eq!(email.sends.load(Ordering::SeqCst), 1);
        assert_eq!(ledger.rows.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn fan_out_treats_same_typed_channels_as_distinct_by_name() {
        let ledger = MemLedger::default();
        let bus = DeadLetterBus::default();
        let webhook = Arc::new(FakeNotifier {
            name: "webhook",
            fail: false,
            sends: AtomicUsize::new(0),
        });
        let mut notifiers = Notifiers::new();
        notifiers.register(webhook.clone());
        let ev = event();
        let notif = Notification::single(&ev);
        // Two named channels of the same type and even the same target: distinct
        // names mean distinct dedup keys and distinct ledger rows.
        let channels = vec![
            webhook_channel("hook-a", "http://x/h"),
            webhook_channel("hook-b", "http://x/h"),
        ];

        let out = deliver_group_channels(
            &ledger, &bus, &notifiers, "gid-1", &channels, false, 0, &ev.tenant, &notif, &ev,
        )
        .await;

        assert!(out.begun && out.sent);
        assert_eq!(webhook.sends.load(Ordering::SeqCst), 2);
        assert_eq!(
            ledger.rows.lock().unwrap().len(),
            2,
            "one ledger row per channel name"
        );
    }

    #[test]
    fn resolve_channels_keeps_order_and_skips_missing() {
        let names = vec![
            "ops-hook".to_string(),
            "gone".to_string(),
            "ops-mail".to_string(),
        ];
        // Loaded set unordered and missing "gone" (deleted between buffer and flush).
        let loaded = vec![
            email_channel("ops-mail", "a@x.test"),
            webhook_channel("ops-hook", "http://x/h"),
        ];
        let resolved = resolve_channels("gid-1", &names, loaded);
        let resolved_names: Vec<&str> = resolved.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            resolved_names,
            vec!["ops-hook", "ops-mail"],
            "buffered order preserved; missing channel skipped"
        );
    }

    // A name repeated in the buffered list (only possible for rows stored before
    // the API's duplicate guard) is NOT the missing-channel case: it resolves to
    // repeated entries, and the name-keyed dedup collapses the redundant send to
    // exactly one delivery and one ledger row.
    #[tokio::test]
    async fn repeated_name_resolves_and_delivers_once_via_dedup() {
        let names = vec![
            "ops-hook".to_string(),
            "ops-hook".to_string(),
            "ops-mail".to_string(),
        ];
        let loaded = vec![
            webhook_channel("ops-hook", "http://x/h"),
            email_channel("ops-mail", "a@x.test"),
        ];
        let resolved = resolve_channels("gid-1", &names, loaded);
        assert_eq!(
            resolved.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["ops-hook", "ops-hook", "ops-mail"],
            "a repeated name is resolved, never treated as missing"
        );

        let ledger = MemLedger::default();
        let bus = DeadLetterBus::default();
        let webhook = Arc::new(FakeNotifier {
            name: "webhook",
            fail: false,
            sends: AtomicUsize::new(0),
        });
        let email = Arc::new(FakeNotifier {
            name: "email",
            fail: false,
            sends: AtomicUsize::new(0),
        });
        let mut notifiers = Notifiers::new();
        notifiers.register(webhook.clone());
        notifiers.register(email.clone());
        let ev = event();
        let notif = Notification::single(&ev);

        let out = deliver_group_channels(
            &ledger, &bus, &notifiers, "gid-1", &resolved, false, 0, &ev.tenant, &notif, &ev,
        )
        .await;

        assert!(out.begun && out.sent);
        assert_eq!(
            webhook.sends.load(Ordering::SeqCst),
            1,
            "the repeated channel sends once (dedup collapses the residue)"
        );
        assert_eq!(email.sends.load(Ordering::SeqCst), 1);
        assert_eq!(
            ledger.rows.lock().unwrap().len(),
            2,
            "one row per channel name"
        );
        assert_eq!(bus.calls.load(Ordering::SeqCst), 0, "nothing dead-letters");
    }

    #[tokio::test]
    async fn fan_out_of_resolved_subset_still_delivers() {
        // End-to-end shape of the missing-channel race: resolution drops the deleted
        // channel, fan-out delivers to the survivors, nothing panics or dead-letters.
        let ledger = MemLedger::default();
        let bus = DeadLetterBus::default();
        let email = Arc::new(FakeNotifier {
            name: "email",
            fail: false,
            sends: AtomicUsize::new(0),
        });
        let mut notifiers = Notifiers::new();
        notifiers.register(email.clone());
        let ev = event();
        let notif = Notification::single(&ev);
        let names = vec!["gone".to_string(), "ops-mail".to_string()];
        let loaded = vec![email_channel("ops-mail", "a@x.test")];

        let channels = resolve_channels("gid-1", &names, loaded);
        let out = deliver_group_channels(
            &ledger, &bus, &notifiers, "gid-1", &channels, false, 0, &ev.tenant, &notif, &ev,
        )
        .await;

        assert!(out.begun && out.sent, "the surviving channel delivers");
        assert_eq!(email.sends.load(Ordering::SeqCst), 1);
        assert_eq!(
            bus.calls.load(Ordering::SeqCst),
            0,
            "a skip never dead-letters"
        );
        assert_eq!(ledger.rows.lock().unwrap().len(), 1);
    }
}

#[cfg(test)]
mod flush_dead_letter_tests {
    use super::*;
    use crate::dispatcher::cache::Snapshot;
    use crate::domain::event::EventStatus;
    use crate::domain::ids::{InstanceKey, RuleId};
    use crate::domain::rule::Severity;
    use crate::queue::{EventEntry, EventId, QueueError, TailCursor};
    use crate::stores::StoreError;
    use async_trait::async_trait;
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use uuid::Uuid;

    /// SnapshotProvider that always fails to load, exercising the dead-letter branch.
    struct FailingSnapshots;
    #[async_trait]
    impl SnapshotProvider for FailingSnapshots {
        async fn snapshot(&self, _tenant: TenantId) -> Result<Arc<Snapshot>, StoreError> {
            // Any StoreError exercises the branch; Json is the cheapest to construct
            // without pulling sqlx into the dispatcher's dev-deps.
            Err(StoreError::Json(
                serde_json::from_str::<i32>("not a number").unwrap_err(),
            ))
        }
    }

    /// SnapshotProvider returning an empty (no silences/inhibitions) snapshot, so nothing
    /// is suppressed.
    struct EmptySnapshots;
    #[async_trait]
    impl SnapshotProvider for EmptySnapshots {
        async fn snapshot(&self, _tenant: TenantId) -> Result<Arc<Snapshot>, StoreError> {
            Ok(Arc::new(Snapshot {
                silences: vec![],
                inhibitions: vec![],
                firing: vec![],
                routes: vec![],
                receivers: vec![],
            }))
        }
    }

    /// EventBus that records dead-letter calls and panics on any other use.
    #[derive(Default)]
    struct RecordingBus {
        dead_lettered: std::sync::Mutex<Vec<(Event, String)>>,
        dead_letter_calls: AtomicUsize,
    }
    #[async_trait]
    impl EventBus for RecordingBus {
        async fn publish(&self, _ev: &Event) -> Result<(), QueueError> {
            unreachable!("publish not used on the snapshot-failure path")
        }
        async fn consume(
            &self,
            _c: &str,
            _n: usize,
            _b: usize,
        ) -> Result<Vec<EventEntry>, QueueError> {
            unreachable!()
        }
        async fn ack(&self, _id: &EventId) -> Result<(), QueueError> {
            unreachable!()
        }
        async fn tail(
            &self,
            _cursor: &TailCursor,
            _n: usize,
            _b: usize,
        ) -> Result<Vec<EventEntry>, QueueError> {
            unreachable!()
        }
        async fn dead_letter(&self, ev: &Event, reason: &str) -> Result<(), QueueError> {
            self.dead_letter_calls.fetch_add(1, Ordering::SeqCst);
            self.dead_lettered
                .lock()
                .unwrap()
                .push((ev.clone(), reason.to_string()));
            Ok(())
        }
    }

    fn event(svc: &str) -> Event {
        let mut labels = BTreeMap::new();
        labels.insert("service".to_string(), svc.to_string());
        let rule = RuleId(Uuid::nil());
        let tenant = TenantId::from_trusted("t1".to_string());
        let key = InstanceKey::new(rule, &labels);
        Event::new(
            tenant,
            rule,
            key,
            EventStatus::Firing,
            labels,
            None,
            Severity::Critical,
            BTreeMap::new(),
            time::OffsetDateTime::UNIX_EPOCH,
        )
    }

    /// On snapshot-load failure the claimed batch is dead-lettered (representative event,
    /// descriptive reason) and `None` is returned so the caller stops — the alerts are
    /// neither silently dropped nor delivered unfiltered.
    #[tokio::test]
    async fn snapshot_failure_dead_letters_the_batch() {
        let bus = RecordingBus::default();
        let cache = FailingSnapshots;
        let tenant = TenantId::from_trusted("t1".to_string());
        let events = vec![event("api"), event("web")];

        let out = filter_or_dead_letter(
            &bus,
            &cache,
            &crate::domain::sink::NullSink,
            tenant,
            events,
            "grp-1",
            time::OffsetDateTime::UNIX_EPOCH,
        )
        .await;

        assert!(out.is_none(), "snapshot failure must stop the flush");
        assert_eq!(bus.dead_letter_calls.load(Ordering::SeqCst), 1);
        let recorded = bus.dead_lettered.lock().unwrap();
        assert_eq!(
            recorded.len(),
            1,
            "exactly one representative event dead-lettered"
        );
        // The representative is the first event of the claimed batch.
        assert_eq!(recorded[0].0.labels.get("service").unwrap(), "api");
        assert!(
            recorded[0].1.contains("loading tenant snapshot failed"),
            "reason is descriptive: {}",
            recorded[0].1
        );
    }

    /// On a successful (empty) snapshot the batch passes through unsuppressed and nothing
    /// is dead-lettered.
    #[tokio::test]
    async fn snapshot_success_passes_events_through() {
        let bus = RecordingBus::default();
        let cache = EmptySnapshots;
        let tenant = TenantId::from_trusted("t1".to_string());
        let events = vec![event("api"), event("web")];

        let out = filter_or_dead_letter(
            &bus,
            &cache,
            &crate::domain::sink::NullSink,
            tenant,
            events,
            "grp-1",
            time::OffsetDateTime::UNIX_EPOCH,
        )
        .await;

        let out = out.expect("successful snapshot returns the surviving events");
        assert_eq!(
            out.len(),
            2,
            "no silences/inhibitions => nothing suppressed"
        );
        assert_eq!(bus.dead_letter_calls.load(Ordering::SeqCst), 0);
    }
}
