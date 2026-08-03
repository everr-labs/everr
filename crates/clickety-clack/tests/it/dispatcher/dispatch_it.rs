use crate::common;
use crate::support::create_test_rule;
use cc::dispatcher::cache::FilterCache;
use cc::dispatcher::dedup::dedup_key;
use cc::dispatcher::{flush_group, grouping, process_event, DispatchCtx};
use cc::domain::channel::ChannelConfig;
use cc::domain::event::Event;
use cc::domain::ids::{InstanceKey, SourceId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::routing::{MatchOp, Matcher};
use cc::domain::rule::{RuleSpec, Severity};
use cc::domain::sink::{AlertLogSink, DeliveryFacts};
use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use time::OffsetDateTime;
use uuid::Uuid;

fn ev(tenant: TenantId) -> Event {
    let mut e = common::base_event();
    e.tenant = tenant;
    e.instance_key = InstanceKey("svc=api".into());
    e.value = Some(1.0);
    e
}

#[tokio::test]
async fn dispatcher_delivers_once_and_dedups() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();
    let ctx = common::dispatch_ctx(&infra);

    let (url, hits, _hook) = common::start_counting_webhook().await;

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_subscription(ctx.cipher.as_ref(), tenant.clone(), &url)
        .await
        .unwrap();

    let dispatcher = common::spawn_dispatcher(&ctx, false);

    infra.bus.publish(&ev(tenant.clone())).await.unwrap();
    infra.bus.publish(&ev(tenant.clone())).await.unwrap();

    for _ in 0..50 {
        if hits.load(Ordering::Relaxed) >= 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tokio::time::sleep(Duration::from_millis(500)).await;

    assert_eq!(
        hits.load(Ordering::Relaxed),
        1,
        "dedup must prevent the second delivery"
    );
    let key = dedup_key("webhook", &url, &ev(tenant.clone()));
    assert_eq!(
        store
            .notification_status(&tenant, &key)
            .await
            .unwrap()
            .unwrap()
            .0,
        "sent"
    );

    dispatcher.shutdown().await;
}

/// The immediate firehose crash window: a sender claimed the notification and died
/// before delivering. While the lease holds, the event must NOT be acked (nothing has
/// delivered it); once the lease expires the redelivery reclaims the row and sends,
/// instead of reading the leftover `pending` row as "already delivered" and dropping
/// the notification for good.
#[tokio::test]
async fn firehose_recovers_a_notification_stranded_by_a_dead_sender() {
    let infra = common::dispatch_infra().await;
    let (url, hits, _hook) = common::start_counting_webhook().await;
    let ctx = common::dispatch_ctx(&infra);
    let store = infra.store.clone();

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_subscription(ctx.cipher.as_ref(), tenant.clone(), &url)
        .await
        .unwrap();

    let event = ev(tenant.clone());
    let key = dedup_key("webhook", &url, &event);
    // Stand in for the sender that claimed this notification and then died: the row
    // is left `pending`, exactly as a crash mid-send would leave it.
    store
        .try_begin_notification(&key, &tenant, "webhook", "redacted")
        .await
        .unwrap();

    infra.bus.publish(&event).await.unwrap();
    let entries = infra.bus.consume("test-consumer", 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);

    // Inside the lease: the previous sender may still be in flight, so nothing is
    // delivered AND the event stays unacked so it comes back.
    let acked = process_event(&ctx, &entries[0]).await;
    assert!(
        !acked,
        "an in-flight lease must not ack the event; that would lose it"
    );
    assert_eq!(hits.load(Ordering::Relaxed), 0, "no duplicate send yet");

    // Age the lease past expiry rather than sleeping it out.
    crate::support::expire_lease(&store, &key).await;

    // Past the lease the row is reclaimable: the redelivery must actually deliver.
    let acked = process_event(&ctx, &entries[0]).await;
    assert!(acked, "the reclaimed notification is delivered and acked");
    assert_eq!(
        hits.load(Ordering::Relaxed),
        1,
        "the stranded notification is delivered on reclaim"
    );
    let (status, _) = store
        .notification_status(&tenant, &key)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(status, "sent");
}

/// Capturing `AlertLogSink` that records every `(event, facts)` pair so a test can assert
/// the dispatcher emitted the expected delivery/silenced alert-log records.
#[derive(Clone, Default)]
struct CapturingSink {
    calls: Arc<Mutex<Vec<(Event, DeliveryFacts)>>>,
}

#[async_trait::async_trait]
impl AlertLogSink for CapturingSink {
    async fn record_delivery(&self, ev: &Event, facts: &DeliveryFacts) {
        self.calls.lock().unwrap().push((ev.clone(), facts.clone()));
    }
}

fn ev_svc(tenant: TenantId, svc: &str) -> Event {
    let mut e = ev(tenant);
    e.instance_key = InstanceKey(format!("svc={svc}"));
    e.labels = BTreeMap::from([("svc".to_string(), svc.to_string())]);
    e
}

/// A delivered event (firehose webhook path, no routes) emits exactly one `delivery`
/// alert-log record carrying the delivery target, and no `silenced` record.
#[tokio::test]
async fn delivery_emits_a_delivery_record() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let (url, hits, _hook) = common::start_counting_webhook().await;

    // No routes for this tenant -> the firehose webhook path delivers immediately.
    let sink = CapturingSink::default();
    let ctx = DispatchCtx {
        sink: Arc::new(sink.clone()),
        ..common::dispatch_ctx(&infra)
    };

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_subscription(ctx.cipher.as_ref(), tenant.clone(), &url)
        .await
        .unwrap();

    let event = ev_svc(tenant.clone(), "api");
    infra.bus.publish(&event).await.unwrap();
    let entries = infra.bus.consume("test-consumer", 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);

    let acked = process_event(&ctx, &entries[0]).await;
    assert!(acked, "delivered event should ack");

    assert_eq!(
        hits.load(Ordering::Relaxed),
        1,
        "webhook should have been hit once"
    );
    let calls = sink.calls.lock().unwrap();
    assert_eq!(
        calls.len(),
        1,
        "exactly one alert-log record; got {calls:?}"
    );
    let (rec_ev, facts) = &calls[0];
    assert_eq!(rec_ev.instance_key, event.instance_key);
    assert!(!facts.silenced, "delivery record must not be silenced");
    assert_eq!(facts.silence_id, None);
    assert_eq!(
        facts.delivery_targets,
        vec!["webhook".to_string()],
        "delivery target is the firehose webhook channel"
    );
}

/// A grouped delivery (routed event, buffered then flushed) emits a `delivery` alert-log
/// record whose target is the CLEAN receiver name — not the `receiver|k=v,...` group key.
/// Driven deterministically: buffer via `process_event`, then flush the known group id
/// directly (no flusher loop / sleeps).
#[tokio::test]
async fn grouped_delivery_uses_clean_receiver_name() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let (url, hits, _hook) = common::start_counting_webhook().await;

    // Zero TTL so the snapshot reflects the receiver/route we just created.
    let sink = CapturingSink::default();
    let ctx = DispatchCtx {
        cache: Arc::new(FilterCache::with_ttl(store.clone(), Duration::ZERO)),
        sink: Arc::new(sink.clone()),
        ..common::dispatch_ctx(&infra)
    };

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    // A receiver + a catch-all route make this the routed (grouping) path, not the firehose.
    let receiver_name = "oncall";
    store
        .create_channel(
            ctx.cipher.as_ref(),
            tenant.clone(),
            "oncall-hook",
            &ChannelConfig::Webhook { url: url.clone() },
        )
        .await
        .unwrap();
    let cc::stores::ReceiverWrite::Stored(receiver) = store
        .create_receiver(
            tenant.clone(),
            receiver_name,
            &["oncall-hook".to_string()],
            &std::collections::BTreeMap::new(),
        )
        .await
        .unwrap()
    else {
        panic!("expected the receiver to be stored");
    };
    store
        .create_route(
            tenant.clone(),
            &[],
            receiver_name,
            false,
            0,
            None,
            Some(0), // group_wait 0s: arm a due flush immediately
            Some(0),
            None, // repeat_interval_secs
        )
        .await
        .unwrap();

    let event = ev_svc(tenant.clone(), "api");
    infra.bus.publish(&event).await.unwrap();
    let entries = infra.bus.consume("test-consumer", 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);

    // Buffer the event into its group (arms a flush timer).
    let acked = process_event(&ctx, &entries[0]).await;
    assert!(acked, "routed event should ack after buffering");
    assert_eq!(
        hits.load(Ordering::Relaxed),
        0,
        "grouped path defers delivery to flush"
    );

    // Recompute the deterministic group id (default group_by: rule, severity) and flush it
    // directly — same code path the flusher loop drives, without any timing.
    let group_by = grouping::default_group_by();
    let labels = cc::dispatcher::routing::match_labels(&event);
    let values = grouping::group_by_values(&labels, &group_by);
    let gid = grouping::group_id(&tenant, &receiver.id.to_string(), &group_by, &values);

    flush_group(&ctx, &gid).await;

    assert_eq!(
        hits.load(Ordering::Relaxed),
        1,
        "grouped delivery hits the webhook once"
    );
    let calls = sink.calls.lock().unwrap();
    assert_eq!(calls.len(), 1, "exactly one delivery record; got {calls:?}");
    let (_, facts) = &calls[0];
    assert!(!facts.silenced, "delivery record must not be silenced");
    assert_eq!(
        facts.delivery_targets,
        vec![receiver_name.to_string()],
        "grouped delivery target is the clean receiver name, not the group key"
    );
}

/// A silenced event emits exactly one `silenced` alert-log record carrying the matching
/// silence id and no delivery (the webhook is never hit).
#[tokio::test]
async fn silenced_event_emits_a_silenced_record() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let (url, hits, _hook) = common::start_counting_webhook().await;

    // Zero TTL so the snapshot reflects the silence we just created.
    let sink = CapturingSink::default();
    let ctx = DispatchCtx {
        cache: Arc::new(FilterCache::with_ttl(store.clone(), Duration::ZERO)),
        sink: Arc::new(sink.clone()),
        ..common::dispatch_ctx(&infra)
    };

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    store
        .create_subscription(ctx.cipher.as_ref(), tenant.clone(), &url)
        .await
        .unwrap();

    // Active silence covering svc=api.
    let now = OffsetDateTime::now_utc();
    let silence = store
        .create_silence(
            tenant.clone(),
            &[Matcher {
                label: "svc".into(),
                op: MatchOp::Eq,
                value: "api".into(),
            }],
            now - time::Duration::seconds(5),
            now + time::Duration::hours(1),
            "maint",
            "ops",
        )
        .await
        .unwrap();

    let event = ev_svc(tenant.clone(), "api");
    infra.bus.publish(&event).await.unwrap();
    let entries = infra.bus.consume("test-consumer", 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);

    let acked = process_event(&ctx, &entries[0]).await;
    assert!(acked, "silenced event is dropped but still acked");

    assert_eq!(
        hits.load(Ordering::Relaxed),
        0,
        "silenced event must not be delivered"
    );
    let calls = sink.calls.lock().unwrap();
    assert_eq!(calls.len(), 1, "exactly one silenced record; got {calls:?}");
    let (_, facts) = &calls[0];
    assert!(facts.silenced, "record must be marked silenced");
    assert_eq!(
        facts.silence_id.as_deref(),
        Some(silence.id.to_string().as_str()),
        "silenced record carries the matching silence id"
    );
    assert!(
        facts.delivery_targets.is_empty(),
        "silenced events have no delivery targets"
    );
}

/// A late-arriving silence (created AFTER the event is buffered into its group) only takes
/// effect at FLUSH time. It must still emit exactly one `silenced` alert-log record carrying
/// the matching silence id, and the event must not be delivered. Driven deterministically:
/// buffer via `process_event` (no silence yet), create the silence, then flush the known
/// group id directly.
#[tokio::test]
async fn flush_time_silence_emits_a_silenced_record() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let (url, hits, _hook) = common::start_counting_webhook().await;

    // Zero TTL so the flush-time snapshot reflects the silence we create after buffering.
    let sink = CapturingSink::default();
    let ctx = DispatchCtx {
        cache: Arc::new(FilterCache::with_ttl(store.clone(), Duration::ZERO)),
        sink: Arc::new(sink.clone()),
        ..common::dispatch_ctx(&infra)
    };

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    // Routed (grouping) path so the event is buffered, not delivered at ingest.
    let receiver_name = "oncall";
    store
        .create_channel(
            ctx.cipher.as_ref(),
            tenant.clone(),
            "oncall-hook",
            &ChannelConfig::Webhook { url: url.clone() },
        )
        .await
        .unwrap();
    let cc::stores::ReceiverWrite::Stored(receiver) = store
        .create_receiver(
            tenant.clone(),
            receiver_name,
            &["oncall-hook".to_string()],
            &std::collections::BTreeMap::new(),
        )
        .await
        .unwrap()
    else {
        panic!("expected the receiver to be stored");
    };
    store
        .create_route(
            tenant.clone(),
            &[],
            receiver_name,
            false,
            0,
            None,
            Some(0), // group_wait 0s: arm a due flush immediately
            Some(0),
            None, // repeat_interval_secs
        )
        .await
        .unwrap();

    let event = ev_svc(tenant.clone(), "api");
    infra.bus.publish(&event).await.unwrap();
    let entries = infra.bus.consume("test-consumer", 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);

    // Buffer the event into its group (no silence exists yet → not suppressed at ingest).
    let acked = process_event(&ctx, &entries[0]).await;
    assert!(acked, "routed event should ack after buffering");
    assert_eq!(
        hits.load(Ordering::Relaxed),
        0,
        "grouped path defers delivery to flush"
    );
    assert!(
        sink.calls.lock().unwrap().is_empty(),
        "no record at ingest: the silence does not exist yet"
    );

    // The silence arrives LATE, after the event is already buffered.
    let now = OffsetDateTime::now_utc();
    let silence = store
        .create_silence(
            tenant.clone(),
            &[Matcher {
                label: "svc".into(),
                op: MatchOp::Eq,
                value: "api".into(),
            }],
            now - time::Duration::seconds(5),
            now + time::Duration::hours(1),
            "maint",
            "ops",
        )
        .await
        .unwrap();

    // Flush the deterministic group id directly (same path the flusher loop drives).
    let group_by = grouping::default_group_by();
    let labels = cc::dispatcher::routing::match_labels(&event);
    let values = grouping::group_by_values(&labels, &group_by);
    let gid = grouping::group_id(&tenant, &receiver.id.to_string(), &group_by, &values);

    flush_group(&ctx, &gid).await;

    assert_eq!(
        hits.load(Ordering::Relaxed),
        0,
        "event suppressed by the late silence must not be delivered"
    );
    let calls = sink.calls.lock().unwrap();
    assert_eq!(
        calls.len(),
        1,
        "exactly one silenced record from the flush-time suppression; got {calls:?}"
    );
    let (rec_ev, facts) = &calls[0];
    assert_eq!(rec_ev.instance_key, event.instance_key);
    assert!(facts.silenced, "record must be marked silenced");
    assert_eq!(
        facts.silence_id.as_deref(),
        Some(silence.id.to_string().as_str()),
        "silenced record carries the matching silence id"
    );
    assert!(
        facts.delivery_targets.is_empty(),
        "silenced events have no delivery targets"
    );
}

/// An event dropped by an INHIBITION at flush time must emit NO alert-log record (no
/// event_type exists for inhibition; out of scope). Driven deterministically: buffer the
/// target event (no inhibition active yet), then create the inhibition rule + firing source,
/// then flush directly.
#[tokio::test]
async fn flush_time_inhibition_emits_no_record() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let (url, hits, _hook) = common::start_counting_webhook().await;

    let sink = CapturingSink::default();
    let ctx = DispatchCtx {
        cache: Arc::new(FilterCache::with_ttl(store.clone(), Duration::ZERO)),
        sink: Arc::new(sink.clone()),
        ..common::dispatch_ctx(&infra)
    };

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let receiver_name = "oncall";
    store
        .create_channel(
            ctx.cipher.as_ref(),
            tenant.clone(),
            "oncall-hook",
            &ChannelConfig::Webhook { url: url.clone() },
        )
        .await
        .unwrap();
    let cc::stores::ReceiverWrite::Stored(receiver) = store
        .create_receiver(
            tenant.clone(),
            receiver_name,
            &["oncall-hook".to_string()],
            &std::collections::BTreeMap::new(),
        )
        .await
        .unwrap()
    else {
        panic!("expected the receiver to be stored");
    };
    store
        .create_route(
            tenant.clone(),
            &[],
            receiver_name,
            false,
            0,
            None,
            Some(0),
            Some(0),
            None, // repeat_interval_secs
        )
        .await
        .unwrap();

    // Target event: severity=warning, svc=db (Severity::Warning so synthetic "severity"
    // label matches the inhibition target_matchers).
    let target = ev_svc(tenant.clone(), "db");
    infra.bus.publish(&target).await.unwrap();
    let entries = infra.bus.consume("test-consumer", 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);

    // Buffer the target (no inhibition active yet → survives ingest, gets grouped).
    let acked = process_event(&ctx, &entries[0]).await;
    assert!(acked, "target event should ack after buffering");
    assert_eq!(
        hits.load(Ordering::Relaxed),
        0,
        "grouped path defers delivery to flush"
    );
    assert!(
        sink.calls.lock().unwrap().is_empty(),
        "no record at ingest: the inhibition does not exist yet"
    );

    // Inhibition arrives LATE: a firing critical svc=db source + a rule inhibiting warnings.
    let now = OffsetDateTime::now_utc();
    let spec = RuleSpec {
        sql: "SELECT 1 AS n".into(),
        interval_secs: 1,
        for_secs: 0,
        label_columns: vec![],
        value_column: Some("n".into()),
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        resolve_after: 1,
        max_interval_secs: None,
        suppressed: false,
    };
    let src_rule = create_test_rule(
        &store,
        tenant.clone(),
        "t/flush_time_inhibition_emits_no_record",
        &spec,
    )
    .await;
    let mut src_labels = BTreeMap::new();
    src_labels.insert("svc".to_string(), "db".to_string());
    let src_key = InstanceKey::new(src_rule.id, &src_labels);
    let mut firing = InstanceState::new_inactive(
        src_key.clone(),
        SourceId::Rule(src_rule.id),
        tenant.clone(),
        src_labels,
    );
    firing.status = Status::Firing;
    firing.active_since = Some(now);
    store.upsert_instance(&firing).await.unwrap();
    store
        .create_inhibition(
            tenant.clone(),
            &[Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "critical".into(),
            }],
            &[Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "warning".into(),
            }],
            &["svc".to_string()],
        )
        .await
        .unwrap();

    // Flush the deterministic group id directly.
    let group_by = grouping::default_group_by();
    let labels = cc::dispatcher::routing::match_labels(&target);
    let values = grouping::group_by_values(&labels, &group_by);
    let gid = grouping::group_id(&tenant, &receiver.id.to_string(), &group_by, &values);

    flush_group(&ctx, &gid).await;

    assert_eq!(
        hits.load(Ordering::Relaxed),
        0,
        "event inhibited at flush time must not be delivered"
    );
    assert!(
        sink.calls.lock().unwrap().is_empty(),
        "inhibition flush-drop must emit NO alert-log record; got {:?}",
        *sink.calls.lock().unwrap()
    );
}
