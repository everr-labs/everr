pub mod cache;
pub mod dedup;
pub mod email;
pub mod flush_filter;
pub mod grouping;
pub mod inhibition;
pub mod matching;
pub mod notify;
pub mod registry;
pub mod render;
pub mod retry;
pub mod routing;
pub mod silence;
pub mod slack;
pub mod slo_inhibit;
pub mod telegram;

pub use dedup::dedup_key;
pub use email::EmailNotifier;
pub use notify::{Notification, Notifier, NotifyError, WebhookNotifier};
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
use crate::stores::{BeginOutcome, PgStore, StoreError};
use async_trait::async_trait;
use futures::StreamExt;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tracing::Instrument;

const MAX_ATTEMPTS: u32 = 4;
/// How many times a notification may be reclaimed from an expired lease before it is
/// retired (marked failed and dead-lettered) instead of retried. A send that strands
/// its ledger row this many times is killing its sender rather than being unlucky, and
/// reclaiming it forever would replay that crash on every retry.
const MAX_NOTIFICATION_CLAIMS: u32 = 3;
/// Backoff before reflushing a group whose fan-out found a notification unaccounted for
/// (another sender holds the lease). Nothing can change until the holder writes a terminal
/// row or `NOTIFICATION_LEASE_MS` elapses, so retrying on `TAKE_RETRY_MS` would burn a
/// full flush cycle (Redis take + channel load and decrypt + a ledger round-trip per
/// channel) every second to re-read one timestamp. This backs off far enough to make that
/// cheap while still draining the batch promptly once the holder finishes.
const IN_FLIGHT_RETRY_MS: i64 = 15_000;
/// How often the flusher polls for due groups when none are immediately ready.
const FLUSH_TICK: Duration = Duration::from_millis(200);
/// Backoff before a claimed group is retried after `take_group` fails. `claim_due` has
/// already removed the group's flush timer, so on a take failure we re-arm at this offset
/// rather than leaving the buffered group orphaned; the delay keeps a persistently failing
/// group from spinning the flusher.
const TAKE_RETRY_MS: i64 = 1_000;

/// The notification-ledger slice of the store that delivery bookkeeping needs.
/// Split out as a trait so channel fan-out can be unit-tested against an in-memory
/// ledger; `PgStore` is the production implementation.
#[async_trait]
pub trait NotificationLedger: Send + Sync {
    async fn try_begin_notification(
        &self,
        dedup_key: &str,
        tenant: &TenantId,
        channel: &str,
        target: &str,
    ) -> Result<BeginOutcome, StoreError>;
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
        tenant: &TenantId,
        channel: &str,
        target: &str,
    ) -> Result<BeginOutcome, StoreError> {
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

/// The dispatcher's shared handles, built once per role (see `main`) and threaded
/// through the consume and flush paths as one context instead of seven positional
/// arguments.
#[derive(Clone)]
pub struct DispatchCtx {
    pub store: PgStore,
    pub bus: Arc<dyn EventBus>,
    pub notifiers: Arc<Notifiers>,
    pub groups: Arc<dyn GroupStore>,
    pub cache: Arc<FilterCache>,
    pub cipher: Arc<dyn SecretCipher>,
    pub sink: Arc<dyn AlertLogSink>,
}

/// The delivery slice of the context: ledger, dead-letter bus, and notifier
/// registry, as trait objects so the fan-out can be unit-tested against fakes.
struct DeliveryDeps<'a> {
    ledger: &'a dyn NotificationLedger,
    bus: &'a dyn EventBus,
    notifiers: &'a Notifiers,
}

impl DispatchCtx {
    fn delivery_deps(&self) -> DeliveryDeps<'_> {
        DeliveryDeps {
            ledger: &self.store,
            bus: self.bus.as_ref(),
            notifiers: &self.notifiers,
        }
    }
}

/// Run the dispatcher consume loop until `shutdown` flips true. Routed events are
/// buffered into Redis groups (flushed by `run_group_flusher`); no-routes tenants keep
/// the immediate per-event webhook firehose.
pub async fn run_dispatcher(
    consumer: String,
    ctx: DispatchCtx,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        if *shutdown.borrow() {
            break;
        }
        let iter_span = tracing::info_span!(
            "queue.consume",
            stream = "cc:events",
            batch = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
            otel.status_message = tracing::field::Empty
        );
        async {
            let entries = match ctx.bus.consume(&consumer, 16, 2000).await {
                Ok(e) => e,
                Err(e) => {
                    crate::otel::span_error(&e);
                    tracing::error!(error = %e, "event consume failed");
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(500)) => {}
                        _ = shutdown.changed() => {}
                    }
                    return;
                }
            };
            tracing::Span::current().record("batch", entries.len());
            let acks = process_event_batch(&ctx, &entries).await;
            // One variadic ack for the handled subset. Unhandled entries (and, on an
            // ack error, the whole batch) stay in the PEL — redelivered by the
            // event-bus XAUTOCLAIM reclaim pre-pass once they go idle.
            let ack_ids: Vec<crate::queue::EventId> = acks
                .into_iter()
                .filter_map(|(id, ack_ok)| ack_ok.then_some(id))
                .collect();
            if let Err(e) = ctx.bus.ack_batch(&ack_ids).await {
                tracing::error!(error = %e, "event ack failed");
            }
        }
        .instrument(iter_span)
        .await;
    }
    tracing::info!("dispatcher stopped");
}

/// Resolve an event to its delivery plan. Routed events are buffered into their group(s)
/// in Redis and a flush timer is armed; no-routes tenants fall back to the immediate
/// Phase 2a subscription firehose. Returns true if the stream entry is safe to ack
/// (false only when a required input could not be loaded — leaves it in the PEL).
///
/// Public so the load-test harness can drive a single event; not a stable API.
#[tracing::instrument(
    name = "dispatcher.process_event",
    skip_all,
    fields(
        event_id = %entry.id,
        tenant = %entry.event.tenant,
        otel.status_code = tracing::field::Empty,
        otel.status_message = tracing::field::Empty,
    )
)]
pub async fn process_event(ctx: &DispatchCtx, entry: &EventEntry) -> bool {
    let ev: &Event = &entry.event;

    // Link this span to the evaluation span that emitted the event, so a trace query
    // can walk from "why did this rule fire" to "what did the dispatcher do with it".
    // A missing/malformed traceparent (telemetry disabled, older event) is silently
    // skipped: it must never break processing.
    if let Some(sc) = ev
        .traceparent
        .as_deref()
        .and_then(crate::otel::propagation::span_context_from_traceparent)
    {
        use tracing_opentelemetry::OpenTelemetrySpanExt;
        tracing::Span::current().add_link(sc);
    }

    // Suppressed (preview-rule) events never notify: drop at ingest, before
    // silence/inhibition processing, before group buffering, and before the no-routes
    // subscription firehose. They still reach the OTLP alert-log export (the events
    // role has its own consumer group).
    if ev.suppressed {
        tracing::debug!(entry_id = %entry.id, "suppressed event; dropping before dispatch");
        return true;
    }

    let labels = routing::match_labels(ev);
    let snap = match ctx.cache.snapshot(ev.tenant.clone()).await {
        Ok(s) => s,
        Err(e) => {
            crate::otel::span_error(&e);
            tracing::error!(error = %e, entry_id = %entry.id, tenant = ?ev.tenant,
                "loading filter snapshot failed; leaving event unacked for reclaim");
            return false;
        }
    };
    let now = time::OffsetDateTime::now_utc();
    if let Some(sid) = silence::matching_silence(&labels, &snap.silences, now) {
        ctx.sink
            .record_delivery(
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
        return firehose_deliver(ctx, ev, &entry.id).await;
    }

    let now = now_ms();
    let mut all_handled = true;
    // Receivers this event's routes name but the snapshot does not have. Collected
    // across targets and dead-lettered once below: the ack decision is per event, so
    // its durable record must be too.
    let mut unknown_receivers: Vec<String> = Vec::new();

    for target in routing::select_grouping_targets(&snap.routes, ev, &labels) {
        let channel_names = match snap.receivers.get(target.receiver.as_str()) {
            Some(r) => r.channels.as_slice(),
            // The route targets a receiver the snapshot does not have. The foreign key
            // keeps the stored rows consistent, but `FilterCache::load` assembles a
            // snapshot from seven independent concurrent reads: a route delete and a
            // receiver delete interleaving between the routes read and the receivers
            // read leave a live route here whose receiver is already gone.
            None => {
                unknown_receivers.push(target.receiver);
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
        if let Err(e) = ctx
            .groups
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
            crate::otel::span_error(&e);
            tracing::error!(error = %e, group = %gid,
                "buffering event into group failed; leaving event unacked for reclaim");
            all_handled = false;
        }
    }
    // Acking an event that nothing delivered and nothing recorded would lose it
    // silently, so every unresolved receiver gets one durable record and the ack waits
    // on that write.
    if !unknown_receivers.is_empty() {
        let names = unknown_receivers.join(", ");
        let reason = format!("routes reference unknown receivers: {names}");
        tracing::error!(entry_id = %entry.id, receivers = %names,
            "routes reference unknown receivers; dead-lettering event");
        if let Err(e) = ctx.bus.dead_letter(ev, &reason).await {
            crate::otel::span_error(&e);
            tracing::error!(error = %e, entry_id = %entry.id,
                "dead-lettering unknown-receiver event failed; leaving event unacked for reclaim");
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
/// instance within one batch may buffer into their group in either order. `add_to_group`
/// orders writes by the event's `eval_ts` (a stale write cannot overwrite a newer one or
/// re-add firing membership), so this is safe; but grouping logic must not otherwise come
/// to depend on within-batch event order.
pub async fn process_event_batch(
    ctx: &DispatchCtx,
    entries: &[EventEntry],
) -> Vec<(crate::queue::EventId, bool)> {
    futures::future::join_all(entries.iter().map(|entry| async move {
        let ack = process_event(ctx, entry).await;
        (entry.id.clone(), ack)
    }))
    .await
}

/// Immediate per-event webhook delivery for tenants with no routes (Phase 2a behavior).
async fn firehose_deliver(ctx: &DispatchCtx, ev: &Event, entry_id: &crate::queue::EventId) -> bool {
    let subs = match ctx
        .store
        .subscriptions_for(ctx.cipher.as_ref(), ev.tenant.clone())
        .await
    {
        Ok(s) => s,
        Err(e) => {
            crate::otel::span_error(&e);
            tracing::error!(error = %e, entry_id = %entry_id, tenant = ?ev.tenant,
                "loading subscriptions failed; leaving event unacked in PEL for later reclaim");
            return false;
        }
    };
    let notif = &Notification::single(ev);
    // Subscriptions are independent (per-subscription ledger row keyed by its own
    // dedup key), so their Pg round-trip + HTTP delivery overlap; each keeps its
    // own bookkeeping and the aggregate is "every subscription handled".
    let handled = futures::future::join_all(subs.into_iter().map(|s| async move {
        let config = crate::domain::channel::ChannelConfig::Webhook { url: s.webhook_url };
        let channel = config.channel_name();
        let target = dedup::canonical_target(&config);
        let key = dedup::dedup_key(channel, &target, ev);
        match claim_to_send(
            &ctx.delivery_deps(),
            &key,
            ev,
            channel,
            &dedup::redact_target(&target),
        )
        .await
        {
            Claim::Send => {}
            Claim::Handled => return true,
            // Not accounted for by anyone yet, so leave the event unacked and let the
            // redelivery resolve it (see `Claim::NotAccountedFor`).
            Claim::NotAccountedFor => return false,
        }
        // Subscription firehose delivery reuses `deliver_one`'s webhook path, but is
        // labeled distinctly ("subscription_webhook" vs "webhook") on the `notify.deliver`
        // span so a trace query can tell the immediate no-routes firehose apart from a
        // routed group's webhook channel.
        if deliver_one(
            &ctx.delivery_deps(),
            &config,
            &key,
            notif,
            ev,
            "subscription_webhook",
        )
        .await
        {
            // Record the delivery as an OTLP `delivery` log (target = channel name,
            // matching the pre-multi-channel firehose shape).
            let facts = DeliveryFacts {
                delivery_targets: vec![channel.to_string()],
                silence_id: None,
                silenced: false,
            };
            ctx.sink.record_delivery(ev, &facts).await;
        }
        true
    }))
    .await;
    handled.into_iter().all(|ok| ok)
}

/// The group flusher: every replica claims due groups and delivers each as one batch.
pub async fn run_group_flusher(ctx: DispatchCtx, mut shutdown: tokio::sync::watch::Receiver<bool>) {
    loop {
        if *shutdown.borrow() {
            break;
        }
        // Before claiming fresh work, requeue any group whose previous flusher claimed it
        // and then died (lease expired): it goes back on the timer so this claim picks it
        // up, instead of being stranded with buffered events and no schedule.
        match ctx.groups.reclaim_expired(now_ms(), 32).await {
            Ok(ids) if !ids.is_empty() => {
                tracing::warn!(count = ids.len(), "reclaimed stranded group flush leases")
            }
            Ok(_) => {}
            Err(e) => tracing::error!(error = %e, "reclaim_expired failed"),
        }
        let ids = match ctx.groups.claim_due(now_ms(), 32).await {
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
        // Claimed groups are independent; flush them with bounded concurrency so one
        // slow channel (retries back off up to seconds) cannot head-of-line block the
        // rest of the claim. Each flush keeps its own per-group logging and ledger
        // bookkeeping.
        let ctx = &ctx;
        futures::stream::iter(ids)
            .for_each_concurrent(8, |gid| async move {
                flush_group(ctx, &gid).await;
            })
            .await;
    }
    tracing::info!("group flusher stopped");
}

/// What became of a claimed batch in [`filter_or_dead_letter`], deciding whether the
/// caller may commit the drain (the batch is durably handled) or must leave it buffered.
enum FilterOutcome {
    /// Snapshot loaded; the surviving events after silence/inhibition filtering
    /// (possibly empty).
    Kept(Vec<Event>),
    /// Snapshot load failed; the batch was dead-lettered (durably recorded, safe to
    /// drain from the group buffer).
    DeadLettered,
    /// Snapshot load failed AND the dead-letter write failed. The batch is still
    /// buffered in the group store; the caller must re-arm for retry, not drain.
    DeadLetterFailed,
}

/// Dead-letter every event of a claimed batch, stopping at the first write failure.
/// The batch stays buffered when this errors, so a retry may re-dead-letter events
/// written before the failure: duplicate dead-letter records are the accepted cost of
/// never losing an event that was neither delivered nor recorded anywhere.
async fn dead_letter_batch(
    bus: &dyn EventBus,
    events: &[Event],
    reason: &str,
) -> Result<(), crate::queue::QueueError> {
    for ev in events {
        bus.dead_letter(ev, reason).await?;
    }
    Ok(())
}

/// Load the tenant snapshot and drop suppressed events from a claimed flush batch.
///
/// On a snapshot-load failure the whole batch is dead-lettered (observable,
/// recoverable). The returned [`FilterOutcome`] tells the caller whether the buffered
/// batch may be drained or must stay put for a retry.
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
) -> FilterOutcome {
    let snap = match cache.snapshot(tenant).await {
        Ok(s) => s,
        Err(e) => {
            let reason = format!("loading tenant snapshot failed: {e}");
            tracing::error!(error = %e, group = %gid,
                "loading tenant snapshot failed; dead-lettering claimed batch");
            return match dead_letter_batch(bus, &events, &reason).await {
                Ok(()) => FilterOutcome::DeadLettered,
                Err(de) => {
                    tracing::error!(dead_letter_error = %de, group = %gid,
                        "snapshot failure AND dead-letter write failed; leaving batch buffered for retry");
                    FilterOutcome::DeadLetterFailed
                }
            };
        }
    };
    FilterOutcome::Kept(
        crate::dispatcher::flush_filter::filter_suppressed(&snap, events, now, sink).await,
    )
}

/// Flush one claimed group and then release its in-flight lease. Every return path of the
/// inner flush (delivered, dead-lettered, nothing-due, or a take failure that re-armed the
/// timer) is followed by the release; only an outright crash skips it, and the lease
/// reclaim in [`run_group_flusher`] recovers that case. Public so the load-test harness can
/// drive a single flush; not a stable API.
#[tracing::instrument(
    name = "dispatcher.flush_group",
    skip_all,
    fields(
        gid = %gid,
        events = tracing::field::Empty,
        begun = tracing::field::Empty,
        sent = tracing::field::Empty,
        not_accounted_for = tracing::field::Empty,
        otel.status_code = tracing::field::Empty,
        otel.status_message = tracing::field::Empty,
    )
)]
pub async fn flush_group(ctx: &DispatchCtx, gid: &str) {
    flush_claimed_group(ctx, gid).await;
    if let Err(e) = ctx.groups.release_claim(gid, now_ms()).await {
        tracing::error!(error = %e, group = %gid,
            "releasing group flush lease failed; it will be reclaimed on lease expiry");
    }
}

/// Re-arm the group's flush timer with a short backoff so a failed flush step retries in
/// seconds rather than waiting out the in-flight lease. If the re-arm itself fails
/// (Redis down), the release of the lease will fail for the same reason and the
/// lease-expiry reclaim recovers the group.
async fn rearm_for_retry(ctx: &DispatchCtx, gid: &str, taken_at: i64) {
    rearm_at(ctx, gid, taken_at, TAKE_RETRY_MS).await;
}

/// If the re-arm itself fails (Redis down), the release of the lease will fail for the
/// same reason and the lease-expiry reclaim recovers the group.
async fn rearm_at(ctx: &DispatchCtx, gid: &str, taken_at: i64, delay_ms: i64) {
    if let Err(e) = ctx
        .groups
        .arm_repeat(gid, taken_at + delay_ms, taken_at)
        .await
    {
        tracing::error!(error = %e, group = %gid,
            "re-arming flush timer failed; group will be reclaimed on lease expiry");
    }
}

/// Phase two of the two-phase take: clear exactly the taken `ev:*` fields now that the
/// batch is durably handled (ledger rows written, deduped, dead-lettered, or suppressed
/// on record). Until this runs the events stay buffered, so a crash anywhere earlier
/// re-delivers on reflush (deduped by the notifications ledger) instead of losing the
/// batch. On failure the timer is re-armed so a near-term reflush retries the drain.
async fn commit_drain(ctx: &DispatchCtx, gid: &str, fields: &[(String, String)], taken_at: i64) {
    if fields.is_empty() {
        return;
    }
    if let Err(e) = ctx.groups.commit_drain(gid, fields).await {
        tracing::error!(error = %e, group = %gid,
            "commit_drain failed; re-arming so a deduped reflush retries the drain");
        rearm_for_retry(ctx, gid, taken_at).await;
    }
}

/// Records the batch size and evaluation-span links via `tracing::Span::current()`, so
/// this must only ever be awaited directly from `flush_group`'s `#[instrument]`ed body:
/// never wrapped in its own `.instrument()` or `tokio::spawn`ed, either of which would
/// detach it from that span.
async fn flush_claimed_group(ctx: &DispatchCtx, gid: &str) {
    let taken_at = now_ms();
    let batch = match ctx.groups.take_group(gid, taken_at).await {
        Ok(Some(g)) => g,
        Ok(None) => return,
        Err(e) => {
            // The in-flight lease (dropped by the caller on return) would already recover
            // this group once it expires, but re-arm the flush timer now with a short
            // backoff so a transient Redis/JSON failure retries in seconds rather than
            // waiting out the full lease.
            crate::otel::span_error(&e);
            tracing::error!(error = %e, group = %gid,
                "take_group failed; re-arming flush timer for retry");
            rearm_for_retry(ctx, gid, taken_at).await;
            return;
        }
    };
    let meta = batch.meta;
    let repeat_ms = batch.repeat_interval_ms.filter(|r| *r > 0);
    let firing_count = batch.firing.len();
    // The taken `ev:*` snapshot, cleared via `commit_drain` only once the batch is
    // durably handled. Empty for a pure repeat-reminder flush.
    let event_fields = batch.event_fields;

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
                    if let Err(e) = ctx.groups.arm_repeat(gid, ln + r, taken_at).await {
                        tracing::error!(error = %e, group = %gid, "arm_repeat failed");
                    }
                }
            }
            return;
        }
    } else {
        return; // nothing active to deliver (timer fired on an emptied group)
    };

    // Record the taken batch size and link this flush's span to every distinct
    // evaluation span that emitted a member event, so a trace query can walk from a
    // firing rule to the group flush that (eventually) delivered it. Deduped before the
    // OTel-recommended 16-link cap so a large batch of repeats/duplicates from the same
    // few rules doesn't starve the cap of genuinely distinct evaluations.
    {
        use tracing_opentelemetry::OpenTelemetrySpanExt;
        let span = tracing::Span::current();
        span.record("events", events.len() as u64);
        let distinct_traceparents: std::collections::BTreeSet<&str> = events
            .iter()
            .filter_map(|e| e.traceparent.as_deref())
            .collect();
        for tp in distinct_traceparents.into_iter().take(16) {
            if let Some(sc) = crate::otel::propagation::span_context_from_traceparent(tp) {
                span.add_link(sc);
            }
        }
    }

    // A still-firing group with a repeat interval always gets its next reminder check
    // armed BEFORE the delivery attempt, so a flush-time silence or a delivery failure
    // cannot kill the reminder loop. Resolved-only groups (empty firing set) never
    // re-arm and therefore never repeat.
    if let Some(r) = repeat_ms {
        if firing_count > 0 {
            if let Err(e) = ctx.groups.arm_repeat(gid, taken_at + r, taken_at).await {
                tracing::error!(error = %e, group = %gid, "arm_repeat failed");
            }
        }
    }

    let tenant = TenantId::from_trusted(meta.tenant);
    let now = time::OffsetDateTime::now_utc();
    let events = match filter_or_dead_letter(
        ctx.bus.as_ref(),
        ctx.cache.as_ref(),
        ctx.sink.as_ref(),
        tenant.clone(),
        events,
        gid,
        now,
    )
    .await
    {
        FilterOutcome::Kept(evs) => evs,
        FilterOutcome::DeadLettered => {
            // The batch now lives durably in the dead-letter stream; clear the buffer.
            commit_drain(ctx, gid, &event_fields, taken_at).await;
            return;
        }
        FilterOutcome::DeadLetterFailed => {
            // Neither delivered nor dead-lettered: leave the batch buffered and retry.
            crate::otel::span_error(&"snapshot load failed and dead-letter write also failed");
            rearm_for_retry(ctx, gid, taken_at).await;
            return;
        }
    };
    if events.is_empty() {
        // Every event suppressed at flush time (silence/inhibition). That is a recorded
        // decision (the filter logged each suppression), so the batch drains.
        commit_drain(ctx, gid, &event_fields, taken_at).await;
        return;
    }
    let notif = Notification {
        group_key: meta.group_key.clone(),
        events,
    };
    // Representative event for per-channel delivery bookkeeping (the batch shares a
    // group key).
    let rep = notif.events[0].clone();
    // Resolve the buffered channel NAMES to their stored configs now, at delivery
    // time. On a load failure the whole batch is dead-lettered (observable,
    // recoverable) and drains; if a dead-letter write fails, the batch stays
    // buffered and the re-armed timer retries it.
    let loaded = match ctx
        .store
        .channels_by_names(ctx.cipher.as_ref(), &tenant, &meta.channels)
        .await
    {
        Ok(chs) => chs,
        Err(e) => {
            let reason = format!("loading channels for group flush failed: {e}");
            crate::otel::span_error(&e);
            tracing::error!(error = %e, group = %gid,
                "loading channels failed; dead-lettering claimed batch");
            match dead_letter_batch(ctx.bus.as_ref(), &notif.events, &reason).await {
                Ok(()) => commit_drain(ctx, gid, &event_fields, taken_at).await,
                Err(de) => {
                    tracing::error!(dead_letter_error = %de, group = %gid,
                        "channel load failure AND dead-letter write failed; leaving batch buffered for retry");
                    rearm_for_retry(ctx, gid, taken_at).await;
                }
            }
            return;
        }
    };
    let channels = resolve_channels(gid, &meta.channels, loaded);
    let outcome = deliver_group_channels(
        &ctx.delivery_deps(),
        gid,
        &channels,
        is_repeat.then_some(taken_at),
        &notif,
        &rep,
    )
    .await;
    {
        let span = tracing::Span::current();
        span.record("begun", outcome.begun);
        span.record("sent", outcome.sent);
        span.record("not_accounted_for", outcome.not_accounted_for);
    }
    // A notification was committed for this group on at least one channel; stamp it so
    // the repeat clock measures from the latest send.
    if outcome.begun {
        if let Err(e) = ctx.groups.mark_notified(gid, taken_at).await {
            tracing::error!(error = %e, group = %gid, "mark_notified failed");
        }
    }
    if outcome.not_accounted_for {
        // Some channel neither delivered nor dead-lettered these events (see
        // `FanOutOutcome::not_accounted_for`; `claim_to_send` logged which). Draining
        // would lose them, so keep the batch buffered and re-arm; the reflush
        // dedup-skips every channel whose ledger row did commit.
        tracing::warn!(group = %gid,
            "a channel recorded no outcome; leaving batch buffered for retry");
        rearm_at(ctx, gid, taken_at, IN_FLIGHT_RETRY_MS).await;
    } else {
        // The fan-out has handled every channel (ledger row + delivery/dead-letter,
        // or dedup skip); commit phase two of the take so the buffered batch clears.
        commit_drain(ctx, gid, &event_fields, taken_at).await;
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
        ctx.sink.record_delivery(&rep, &facts).await;
    }
}

/// What one group flush's channel fan-out accomplished.
struct FanOutOutcome {
    /// At least one channel committed a new notification row (not a dedup skip).
    begun: bool,
    /// At least one channel delivered successfully.
    sent: bool,
    /// At least one channel recorded no outcome at all: the ledger claim errored, or
    /// another sender's unexpired lease holds it. Either way nothing delivered or
    /// dead-lettered those events for that channel, so draining would lose them and
    /// the batch must stay buffered for a reflush.
    not_accounted_for: bool,
}

/// What one channel's fan-out did, as the aggregation in [`deliver_group_channels`]
/// needs to see it. `Skipped` covers both a dedup skip and a retired claim: in both,
/// the notification is accounted for and this flush owes it nothing.
enum ChannelOutcome {
    Skipped,
    Begun { sent: bool },
    NotAccountedFor,
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
/// its own ledger row. Channels are independent, so they deliver concurrently — one
/// channel's retry backoff (worst case tens of seconds) never delays the others — and
/// a failing channel never suppresses the rest: failures are recorded (ledger + dead
/// letter) per channel.
///
/// `repeat_taken_at` is `Some(take timestamp)` when this flush is a still-firing
/// repeat reminder, `None` for a normal buffered flush. The batch shares one tenant,
/// so `rep` carries it for every channel's ledger row.
async fn deliver_group_channels(
    deps: &DeliveryDeps<'_>,
    gid: &str,
    channels: &[Channel],
    repeat_taken_at: Option<i64>,
    notif: &Notification,
    rep: &Event,
) -> FanOutOutcome {
    // The claim is atomic on the dedup key, so a name repeated in the buffered list
    // still collapses to one row/send even with the attempts racing.
    let results = futures::future::join_all(channels.iter().map(|ch| async move {
        // A repeat folds the take timestamp into the key so the identical still-firing
        // set yields a NEW notification instead of deduping against the original send.
        let key = match repeat_taken_at {
            Some(taken_at) => grouping::repeat_dedup_key(gid, &ch.name, &notif.events, taken_at),
            None => grouping::group_dedup_key(gid, &ch.name, &notif.events),
        };
        let target = dedup::canonical_target(&ch.config);
        match claim_to_send(
            deps,
            &key,
            rep,
            ch.config.channel_name(),
            &dedup::redact_target(&target),
        )
        .await
        {
            Claim::Send => {
                let sent =
                    deliver_one(deps, &ch.config, &key, notif, rep, ch.config.channel_name()).await;
                ChannelOutcome::Begun { sent }
            }
            Claim::Handled => ChannelOutcome::Skipped,
            Claim::NotAccountedFor => ChannelOutcome::NotAccountedFor,
        }
    }))
    .await;
    FanOutOutcome {
        begun: results
            .iter()
            .any(|o| matches!(o, ChannelOutcome::Begun { .. })),
        sent: results
            .iter()
            .any(|o| matches!(o, ChannelOutcome::Begun { sent: true })),
        not_accounted_for: results
            .iter()
            .any(|o| matches!(o, ChannelOutcome::NotAccountedFor)),
    }
}

/// What the caller of [`claim_to_send`] should do with this notification.
enum Claim {
    /// This caller owns the send.
    Send,
    /// Accounted for by someone: delivered, dead-lettered, or deduped. The caller may
    /// ack the event / drain the batch.
    Handled,
    /// Nobody has recorded an outcome for it yet — another sender holds the lease, or
    /// the ledger write failed outright. The caller must NOT ack or drain: a later
    /// retry either dedup-skips (the holder finished) or reclaims the expired lease
    /// (the holder died).
    NotAccountedFor,
}

/// Claim the right to send one notification, applying the reclaim budget. This is the
/// single place `MAX_NOTIFICATION_CLAIMS` is enforced; both the firehose and the group
/// fan-out route their ledger claim through here so the policy cannot drift between
/// them, and map [`Claim`] onto their own ack/drain shape.
async fn claim_to_send(
    deps: &DeliveryDeps<'_>,
    key: &str,
    rep: &Event,
    channel: &str,
    redacted_target: &str,
) -> Claim {
    match deps
        .ledger
        .try_begin_notification(key, &rep.tenant, channel, redacted_target)
        .await
    {
        // Reclaimed too many times without ever completing: retire it rather than
        // replay whatever keeps killing the sender. Terminal, so the caller proceeds.
        Ok(BeginOutcome::Claimed { claims }) if claims >= MAX_NOTIFICATION_CLAIMS => {
            let reason = format!(
                "notification reclaimed {claims} times without completing; \
                 the sender is dying mid-send on channel '{channel}'"
            );
            crate::otel::span_error(&reason);
            fail_and_dead_letter(deps, key, rep, 0, &reason).await;
            Claim::Handled
        }
        Ok(BeginOutcome::Claimed { claims }) => {
            if claims > 0 {
                tracing::warn!(channel = %channel, claims = claims, key = %key,
                    "reclaimed a notification stranded by a previous sender");
            }
            Claim::Send
        }
        Ok(BeginOutcome::AlreadyHandled) => Claim::Handled,
        Ok(BeginOutcome::InFlight) => {
            tracing::debug!(channel = %channel, key = %key,
                "notification already in flight elsewhere; leaving it for a retry");
            Claim::NotAccountedFor
        }
        Err(e) => {
            crate::otel::span_error(&e);
            tracing::error!(error = %e, channel = %channel, "begin notification failed");
            Claim::NotAccountedFor
        }
    }
}

/// Record a permanent failure for one notification: mark the ledger row failed and
/// dead-letter the event, logging both writes. `attempts` is the delivery retry count
/// the failure came from (0 when no send was attempted).
async fn fail_and_dead_letter(
    deps: &DeliveryDeps<'_>,
    key: &str,
    rep: &Event,
    attempts: u32,
    reason: &str,
) {
    if let Err(e) = deps
        .ledger
        .mark_notification_failed(&rep.tenant, key, attempts, reason)
        .await
    {
        tracing::error!(error = %e, key = %key, "mark_notification_failed write failed");
    }
    if let Err(e) = deps.bus.dead_letter(rep, reason).await {
        tracing::error!(dead_letter_error = %e, original = %reason, key = %key,
            "delivery failed AND dead-letter write failed");
    }
}

/// Shared delivery + bookkeeping: look up the notifier for `config`'s channel, retry,
/// then record sent/failed and dead-letter on permanent/exhausted failure. `rep` is the
/// event used for the dead-letter record. Returns true when delivery succeeded.
///
/// `span_channel` labels the `notify.deliver` span's `channel` field; it is distinct from
/// `config.channel_name()` (used for the notifier-registry lookup and delivery metrics)
/// so the no-routes subscription firehose can trace as "subscription_webhook" while still
/// dispatching through the same "webhook" notifier as a routed group's webhook channel.
#[tracing::instrument(
    name = "notify.deliver",
    skip_all,
    fields(
        otel.kind = "client",
        channel = span_channel,
        target = %dedup::redact_target(&dedup::canonical_target(config)),
        attempts = tracing::field::Empty,
        otel.status_code = tracing::field::Empty,
        otel.status_message = tracing::field::Empty,
    )
)]
async fn deliver_one(
    deps: &DeliveryDeps<'_>,
    config: &crate::domain::channel::ChannelConfig,
    key: &str,
    notif: &Notification,
    rep: &Event,
    span_channel: &'static str,
) -> bool {
    let channel = config.channel_name();
    let metrics = deps.notifiers.engine_metrics();
    let notifier = match deps.notifiers.get(channel) {
        Some(n) => n,
        None => {
            let reason = format!("no notifier registered for channel '{channel}'");
            crate::otel::span_error(&reason);
            fail_and_dead_letter(deps, key, rep, 0, &reason).await;
            metrics.record_delivery(
                channel,
                rep.tenant.as_str(),
                crate::otel::metrics::DeliveryOutcome::NoNotifier,
            );
            tracing::error!(channel = %channel, "no notifier registered; dead-lettered");
            return false;
        }
    };
    match retry::deliver_with_retry(notifier.as_ref(), config, notif, MAX_ATTEMPTS).await {
        Ok(attempts) => {
            tracing::Span::current().record("attempts", attempts);
            metrics.record_delivery(
                channel,
                rep.tenant.as_str(),
                crate::otel::metrics::DeliveryOutcome::Sent,
            );
            if let Err(e) = deps
                .ledger
                .mark_notification_sent(&rep.tenant, key, attempts)
                .await
            {
                tracing::error!(error = %e, key = %key,
                    "mark_notification_sent failed; row stuck 'pending' despite successful delivery");
            }
            true
        }
        Err((attempts, err)) => {
            tracing::Span::current().record("attempts", attempts);
            crate::otel::span_error(&err);
            metrics.record_delivery(
                channel,
                rep.tenant.as_str(),
                crate::otel::metrics::DeliveryOutcome::Failed,
            );
            let reason = err.to_string();
            fail_and_dead_letter(deps, key, rep, attempts, &reason).await;
            tracing::warn!(channel = %channel, error = %err,
                target = %dedup::redact_target(&dedup::canonical_target(config)),
                "notification dead-lettered");
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
    use crate::queue::{EventEntry, EventId, QueueError};
    use async_trait::async_trait;
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
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

    /// The `MemLedger` lease, mirroring `NOTIFICATION_LEASE_MS`'s role. Tests cross it
    /// with [`MemLedger::expire_lease`] rather than hard-coding the value.
    const MEM_LEASE_MS: i64 = 60_000;

    struct MemRow {
        channel: String,
        status: String,
        claims: u32,
        /// When the current owner claimed the row; its lease runs from here.
        claimed_at: i64,
    }

    /// In-memory `NotificationLedger` mirroring the Pg claim semantics: a row is
    /// claimable when absent, or `pending` with an expired lease. The clock is
    /// test-advanced so the crash window is exercised without sleeping.
    #[derive(Default)]
    struct MemLedger {
        rows: Mutex<BTreeMap<String, MemRow>>,
        now: AtomicI64,
    }
    #[async_trait]
    impl NotificationLedger for MemLedger {
        async fn try_begin_notification(
            &self,
            dedup_key: &str,
            _tenant: &TenantId,
            channel: &str,
            _target: &str,
        ) -> Result<BeginOutcome, StoreError> {
            let now = self.now.load(Ordering::SeqCst);
            let mut rows = self.rows.lock().unwrap();
            match rows.get_mut(dedup_key) {
                None => {
                    rows.insert(
                        dedup_key.to_string(),
                        MemRow {
                            channel: channel.to_string(),
                            status: "pending".to_string(),
                            claims: 0,
                            claimed_at: now,
                        },
                    );
                    Ok(BeginOutcome::Claimed { claims: 0 })
                }
                Some(row) if row.status != "pending" => Ok(BeginOutcome::AlreadyHandled),
                Some(row) if now - row.claimed_at < MEM_LEASE_MS => Ok(BeginOutcome::InFlight),
                Some(row) => {
                    row.claims += 1;
                    row.claimed_at = now;
                    Ok(BeginOutcome::Claimed { claims: row.claims })
                }
            }
        }
        async fn mark_notification_sent(
            &self,
            _tenant: &TenantId,
            dedup_key: &str,
            _attempts: u32,
        ) -> Result<(), StoreError> {
            self.rows.lock().unwrap().get_mut(dedup_key).unwrap().status = "sent".to_string();
            Ok(())
        }
        async fn mark_notification_failed(
            &self,
            _tenant: &TenantId,
            dedup_key: &str,
            _attempts: u32,
            _error: &str,
        ) -> Result<(), StoreError> {
            self.rows.lock().unwrap().get_mut(dedup_key).unwrap().status = "failed".to_string();
            Ok(())
        }
    }

    impl MemLedger {
        fn statuses_by_channel(&self) -> BTreeMap<String, String> {
            self.rows
                .lock()
                .unwrap()
                .values()
                .map(|r| (r.channel.clone(), r.status.clone()))
                .collect()
        }

        /// Plant the row a crashed sender would have left behind, claimed at t=0.
        fn seed_pending(&self, dedup_key: &str, channel: &str, claims: u32) {
            self.rows.lock().unwrap().insert(
                dedup_key.to_string(),
                MemRow {
                    channel: channel.to_string(),
                    status: "pending".to_string(),
                    claims,
                    claimed_at: 0,
                },
            );
        }

        fn advance(&self, ms: i64) {
            self.now.fetch_add(ms, Ordering::SeqCst);
        }

        /// Move the clock just past the lease of the currently-held claim.
        fn expire_lease(&self) {
            self.advance(MEM_LEASE_MS + 1);
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
        async fn send(&self, _c: &ChannelConfig, _n: &Notification) -> Result<(), NotifyError> {
            self.sends.fetch_add(1, Ordering::SeqCst);
            if self.fail {
                Err(NotifyError::Permanent("boom".into()))
            } else {
                Ok(())
            }
        }
    }

    fn fake_notifier(name: &'static str, fail: bool) -> Arc<FakeNotifier> {
        Arc::new(FakeNotifier {
            name,
            fail,
            sends: AtomicUsize::new(0),
        })
    }

    /// The recorded status of the one ledger row for `channel`.
    fn status_of(ledger: &MemLedger, channel: &str) -> Option<String> {
        ledger.statuses_by_channel().get(channel).cloned()
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
            &DeliveryDeps {
                ledger: &ledger,
                bus: &bus,
                notifiers: &notifiers,
            },
            "gid-1",
            &channels,
            None,
            &notif,
            &ev,
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
            &DeliveryDeps {
                ledger: &ledger,
                bus: &bus,
                notifiers: &notifiers,
            },
            "gid-1",
            &channels,
            None,
            &notif,
            &ev,
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

    /// Which ledger write a [`FaultyLedger`] fails; everything else delegates to the
    /// inner [`MemLedger`]. Mirrors the `FaultInjector` idiom the evaluator's
    /// durability tests use, so a new fault case is a variant rather than a wrapper.
    enum FailAt {
        /// Claiming the notification, for one channel type only.
        Claim(&'static str),
        /// Recording a send that actually succeeded, stranding the row `pending`.
        MarkSent,
    }

    struct FaultyLedger {
        inner: MemLedger,
        fail: FailAt,
    }
    #[async_trait]
    impl NotificationLedger for FaultyLedger {
        async fn try_begin_notification(
            &self,
            dedup_key: &str,
            tenant: &TenantId,
            channel: &str,
            target: &str,
        ) -> Result<BeginOutcome, StoreError> {
            if matches!(self.fail, FailAt::Claim(c) if c == channel) {
                return Err(StoreError::Sqlx(sqlx::Error::PoolTimedOut));
            }
            self.inner
                .try_begin_notification(dedup_key, tenant, channel, target)
                .await
        }
        async fn mark_notification_sent(
            &self,
            tenant: &TenantId,
            dedup_key: &str,
            attempts: u32,
        ) -> Result<(), StoreError> {
            if matches!(self.fail, FailAt::MarkSent) {
                return Err(StoreError::Sqlx(sqlx::Error::PoolTimedOut));
            }
            self.inner
                .mark_notification_sent(tenant, dedup_key, attempts)
                .await
        }
        async fn mark_notification_failed(
            &self,
            tenant: &TenantId,
            dedup_key: &str,
            attempts: u32,
            error: &str,
        ) -> Result<(), StoreError> {
            self.inner
                .mark_notification_failed(tenant, dedup_key, attempts, error)
                .await
        }
    }

    #[tokio::test]
    async fn fan_out_reports_begin_failure_and_leaves_no_trace_for_that_channel() {
        let ledger = FaultyLedger {
            inner: MemLedger::default(),
            fail: FailAt::Claim("webhook"),
        };
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
            &DeliveryDeps {
                ledger: &ledger,
                bus: &bus,
                notifiers: &notifiers,
            },
            "gid-1",
            &channels,
            None,
            &notif,
            &ev,
        )
        .await;

        // The begin failure must surface so the flush keeps the batch buffered:
        // that channel has no ledger row, no delivery, and no dead letter, so a
        // drain would silently lose its events.
        assert!(
            out.not_accounted_for,
            "transient claim error must be reported"
        );
        assert!(out.begun && out.sent, "the healthy channel still delivered");
        assert_eq!(webhook.sends.load(Ordering::SeqCst), 0);
        assert_eq!(email.sends.load(Ordering::SeqCst), 1);
        let statuses = ledger.inner.statuses_by_channel();
        assert_eq!(statuses.len(), 1, "no ledger row for the failed begin");
        assert_eq!(statuses.get("email").map(String::as_str), Some("sent"));
        assert_eq!(bus.calls.load(Ordering::SeqCst), 0);
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
            &DeliveryDeps {
                ledger: &ledger,
                bus: &bus,
                notifiers: &notifiers,
            },
            "gid-1",
            &channels,
            None,
            &notif,
            &ev,
        )
        .await;
        // Same channel NAMES but an edited config: the dedup key is name-stable, so
        // a config rotation between redeliveries must not re-send the identical set.
        let rotated = vec![
            webhook_channel("ops-hook", "http://x/h-rotated"),
            email_channel("ops-mail", "b@x.test"),
        ];
        let second = deliver_group_channels(
            &DeliveryDeps {
                ledger: &ledger,
                bus: &bus,
                notifiers: &notifiers,
            },
            "gid-1",
            &rotated,
            None,
            &notif,
            &ev,
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
            &DeliveryDeps {
                ledger: &ledger,
                bus: &bus,
                notifiers: &notifiers,
            },
            "gid-1",
            &channels,
            None,
            &notif,
            &ev,
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

    /// Fixture for the crash-window tests: one webhook channel, the dedup key its
    /// group flush computes (so a test can plant the row a dead sender left), and the
    /// delivery deps to fan out with.
    struct CrashWindow {
        ev: Event,
        notif: Notification,
        channels: Vec<Channel>,
        key: String,
        bus: DeadLetterBus,
        notifiers: Notifiers,
        webhook: Arc<FakeNotifier>,
    }

    impl CrashWindow {
        fn new(repeat_taken_at: Option<i64>) -> Self {
            let ev = event();
            let notif = Notification::single(&ev);
            let key = match repeat_taken_at {
                Some(at) => grouping::repeat_dedup_key("gid-1", "ops-hook", &notif.events, at),
                None => grouping::group_dedup_key("gid-1", "ops-hook", &notif.events),
            };
            let webhook = fake_notifier("webhook", false);
            let mut notifiers = Notifiers::new();
            notifiers.register(webhook.clone());
            Self {
                ev,
                notif,
                channels: vec![webhook_channel("ops-hook", "http://x/h")],
                key,
                bus: DeadLetterBus::default(),
                notifiers,
                webhook,
            }
        }

        async fn fan_out(
            &self,
            ledger: &dyn NotificationLedger,
            repeat_taken_at: Option<i64>,
        ) -> FanOutOutcome {
            deliver_group_channels(
                &DeliveryDeps {
                    ledger,
                    bus: &self.bus,
                    notifiers: &self.notifiers,
                },
                "gid-1",
                &self.channels,
                repeat_taken_at,
                &self.notif,
                &self.ev,
            )
            .await
        }

        fn sends(&self) -> usize {
            self.webhook.sends.load(Ordering::SeqCst)
        }
        fn dead_letters(&self) -> usize {
            self.bus.calls.load(Ordering::SeqCst)
        }
    }

    /// The crash window: a sender wrote `pending` and died. Once the lease expires the
    /// flush must reclaim the row and actually deliver, instead of reading the leftover
    /// row as "already sent" and dropping the notification forever.
    #[tokio::test]
    async fn fan_out_reclaims_a_stale_pending_row_and_redelivers() {
        let cw = CrashWindow::new(None);
        let ledger = MemLedger::default();
        ledger.seed_pending(&cw.key, "webhook", 0);
        ledger.expire_lease();

        let out = cw.fan_out(&ledger, None).await;

        assert!(out.begun && out.sent, "the stranded notification delivers");
        assert!(!out.not_accounted_for);
        assert_eq!(cw.sends(), 1);
        assert_eq!(status_of(&ledger, "webhook"), Some("sent".to_string()));
        assert_eq!(cw.dead_letters(), 0);
    }

    /// Repeat reminders key on the take timestamp, so they get their own ledger row —
    /// and their own crash window, which must recover the same way.
    #[tokio::test]
    async fn fan_out_reclaims_a_stale_repeat_reminder() {
        let taken_at = 1_700_000_000_000;
        let cw = CrashWindow::new(Some(taken_at));
        let ledger = MemLedger::default();
        ledger.seed_pending(&cw.key, "webhook", 0);
        ledger.expire_lease();

        let out = cw.fan_out(&ledger, Some(taken_at)).await;

        assert!(out.begun && out.sent, "the stranded reminder delivers");
        assert_eq!(cw.sends(), 1);
        assert_eq!(status_of(&ledger, "webhook"), Some("sent".to_string()));
    }

    /// A `pending` row still inside its lease means another sender may be mid-send. Not
    /// a dedup skip: nothing is delivered, and the flush must be told to keep the batch
    /// buffered rather than drain it.
    #[tokio::test]
    async fn fan_out_reports_in_flight_without_sending_or_draining() {
        let cw = CrashWindow::new(None);
        let ledger = MemLedger::default();
        ledger.seed_pending(&cw.key, "webhook", 0);
        ledger.advance(1_000); // well inside the lease

        let out = cw.fan_out(&ledger, None).await;

        assert!(
            out.not_accounted_for,
            "an unexpired lease must hold the batch"
        );
        assert!(!out.begun && !out.sent);
        assert_eq!(cw.sends(), 0);
        assert_eq!(status_of(&ledger, "webhook"), Some("pending".to_string()));
        assert_eq!(cw.dead_letters(), 0);
    }

    /// A notification that kills its sender every time would otherwise be reclaimed
    /// forever. Past the claim cap it is dead-lettered and the batch drains.
    #[tokio::test]
    async fn fan_out_dead_letters_a_notification_that_keeps_outliving_its_lease() {
        let cw = CrashWindow::new(None);
        let ledger = MemLedger::default();
        ledger.seed_pending(&cw.key, "webhook", MAX_NOTIFICATION_CLAIMS - 1);
        ledger.expire_lease();

        let out = cw.fan_out(&ledger, None).await;

        assert_eq!(cw.sends(), 0, "no further delivery attempt past the cap");
        assert_eq!(cw.dead_letters(), 1, "dead-lettered instead");
        assert_eq!(status_of(&ledger, "webhook"), Some("failed".to_string()));
        assert!(
            !out.not_accounted_for,
            "terminal: the batch must drain rather than retry forever"
        );
    }

    /// The one case the lease cannot tell apart: delivery succeeded but the `sent` write
    /// did not land, so the row still looks stranded. Reclaiming it re-sends. That
    /// duplicate is the deliberate trade — for alerting, a repeated page beats a page
    /// that never arrives — and this test pins the behavior so it stays a choice rather
    /// than a surprise.
    #[tokio::test]
    async fn unrecorded_send_is_redelivered_once_its_lease_expires() {
        let cw = CrashWindow::new(None);
        let ledger = FaultyLedger {
            inner: MemLedger::default(),
            fail: FailAt::MarkSent,
        };

        let first = cw.fan_out(&ledger, None).await;
        assert!(first.begun && first.sent);
        assert_eq!(cw.sends(), 1);
        assert_eq!(
            status_of(&ledger.inner, "webhook"),
            Some("pending".to_string()),
            "the successful send went unrecorded"
        );

        // Inside the lease the row is still owned, so nothing re-sends.
        ledger.inner.advance(1_000);
        let during = cw.fan_out(&ledger, None).await;
        assert!(during.not_accounted_for && !during.sent);
        assert_eq!(cw.sends(), 1);

        // Past it the row is indistinguishable from a crashed send and is retried.
        ledger.inner.expire_lease();
        let after = cw.fan_out(&ledger, None).await;
        assert!(after.begun && after.sent);
        assert_eq!(
            cw.sends(),
            2,
            "at-least-once: an unrecorded send is repeated rather than dropped"
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
            &DeliveryDeps {
                ledger: &ledger,
                bus: &bus,
                notifiers: &notifiers,
            },
            "gid-1",
            &resolved,
            None,
            &notif,
            &ev,
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
            &DeliveryDeps {
                ledger: &ledger,
                bus: &bus,
                notifiers: &notifiers,
            },
            "gid-1",
            &channels,
            None,
            &notif,
            &ev,
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

    /// Spec: "a failed delivery yields `notify.deliver` with error status." Drives
    /// `deliver_one` (the smallest seam that creates the `notify.deliver` span) with a
    /// permanently-failing notifier under an in-memory span exporter, mirroring the
    /// `SdkTracerProvider` + `InMemorySpanExporter` + `tracing::subscriber` pattern in
    /// `otel::status`'s tests.
    #[tokio::test]
    async fn deliver_one_failure_yields_error_status_span() {
        use opentelemetry::trace::{Status, TracerProvider as _};
        use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
        use tracing_subscriber::layer::SubscriberExt;

        let exporter = InMemorySpanExporter::default();
        let provider = SdkTracerProvider::builder()
            .with_simple_exporter(exporter.clone())
            .build();
        // Sibling tests in this module call `deliver_one` without a subscriber,
        // which can otherwise cache `notify.deliver` as uninteresting for the
        // whole process and leave this test's exporter empty.
        crate::otel::testing::ensure_permissive_callsite_interest();

        let subscriber = tracing_subscriber::registry()
            .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
        // `set_default` (not `with_default`) so the thread-local dispatcher stays active
        // across the `.await` below: `deliver_one`'s `#[instrument]` span is created
        // synchronously at call time, but the delivery future spans several awaits and
        // this test runs on the current-thread `#[tokio::test]` runtime.
        let _guard = tracing::subscriber::set_default(subscriber);

        let ledger = MemLedger::default();
        let bus = DeadLetterBus::default();
        let notifier = Arc::new(FakeNotifier {
            name: "webhook",
            fail: true,
            sends: AtomicUsize::new(0),
        });
        let mut notifiers = Notifiers::new();
        notifiers.register(notifier.clone());
        let ev = event();
        let notif = Notification::single(&ev);
        let config = ChannelConfig::Webhook {
            url: "http://x/h".into(),
        };
        let deps = DeliveryDeps {
            ledger: &ledger,
            bus: &bus,
            notifiers: &notifiers,
        };
        // `deliver_one` assumes the ledger row already exists (normally inserted by its
        // caller, `deliver_group_channels`, before it delivers); seed it the same way so
        // the later `mark_notification_failed` write has a row to update.
        ledger
            .try_begin_notification("key-1", &ev.tenant, "webhook", "http://x/h")
            .await
            .unwrap();

        let sent = deliver_one(&deps, &config, "key-1", &notif, &ev, "webhook").await;

        assert!(!sent, "permanent failure must not report success");
        drop(_guard);
        provider.force_flush().unwrap();
        let spans = exporter.get_finished_spans().unwrap();
        let span = spans
            .iter()
            .find(|s| s.name == "notify.deliver")
            .expect("notify.deliver span exported");
        match &span.status {
            Status::Error { .. } => {}
            other => panic!("expected error status, got {other:?}"),
        }
        assert!(
            span.attributes
                .iter()
                .any(|kv| kv.key.as_str() == "attempts"),
            "attempts attribute recorded on the span"
        );
    }
}

#[cfg(test)]
mod flush_dead_letter_tests {
    use super::*;
    use crate::dispatcher::cache::Snapshot;
    use crate::domain::event::EventStatus;
    use crate::domain::ids::{InstanceKey, RuleId};
    use crate::domain::rule::Severity;
    use crate::queue::{EventEntry, EventId, QueueError};
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
                receivers: Default::default(),
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

    /// On snapshot-load failure EVERY event of the claimed batch is dead-lettered with a
    /// descriptive reason — the alerts are neither silently dropped nor delivered
    /// unfiltered, and no event vanishes without a recoverable record.
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

        assert!(
            matches!(out, FilterOutcome::DeadLettered),
            "snapshot failure must stop the flush, with the batch durably dead-lettered"
        );
        assert_eq!(bus.dead_letter_calls.load(Ordering::SeqCst), 2);
        let recorded = bus.dead_lettered.lock().unwrap();
        assert_eq!(recorded.len(), 2, "every event of the batch dead-lettered");
        assert_eq!(recorded[0].0.labels.get("service").unwrap(), "api");
        assert_eq!(recorded[1].0.labels.get("service").unwrap(), "web");
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

        let FilterOutcome::Kept(out) = out else {
            panic!("successful snapshot returns the surviving events");
        };
        assert_eq!(
            out.len(),
            2,
            "no silences/inhibitions => nothing suppressed"
        );
        assert_eq!(bus.dead_letter_calls.load(Ordering::SeqCst), 0);
    }

    /// EventBus whose dead-letter write also fails (e.g. Redis down), exercising the
    /// keep-buffered outcome.
    struct FailingBus;
    #[async_trait]
    impl EventBus for FailingBus {
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
        async fn dead_letter(&self, _ev: &Event, _reason: &str) -> Result<(), QueueError> {
            Err(QueueError::Json(
                serde_json::from_str::<i32>("not a number").unwrap_err(),
            ))
        }
    }

    /// When the dead-letter write fails too, the outcome must tell the flusher the batch
    /// is still buffered so it re-arms for retry instead of dropping it (the batch is
    /// only removed from Redis by the post-handling commit-drain).
    #[tokio::test]
    async fn dead_letter_failure_reports_the_batch_still_buffered() {
        let out = filter_or_dead_letter(
            &FailingBus,
            &FailingSnapshots,
            &crate::domain::sink::NullSink,
            TenantId::from_trusted("t1".to_string()),
            vec![event("api")],
            "grp-1",
            time::OffsetDateTime::UNIX_EPOCH,
        )
        .await;

        assert!(
            matches!(out, FilterOutcome::DeadLetterFailed),
            "neither delivered nor dead-lettered: the caller must keep the batch buffered"
        );
    }
}
