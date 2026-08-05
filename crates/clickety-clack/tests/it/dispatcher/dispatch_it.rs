use crate::common;
use crate::support::create_test_rule;
use cc::dispatcher::cache::FilterCache;
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

#[derive(Clone, Default)]
struct CapturingSink {
    calls: Arc<Mutex<Vec<(Event, DeliveryFacts)>>>,
}

fn capturing_ctx(infra: &common::DispatchInfra) -> (CapturingSink, DispatchCtx) {
    let sink = CapturingSink::default();
    let ctx = DispatchCtx {
        cache: Arc::new(FilterCache::with_ttl(infra.store.clone(), Duration::ZERO)),
        sink: Arc::new(sink.clone()),
        ..common::dispatch_ctx(infra)
    };
    (sink, ctx)
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

#[tokio::test]
async fn unrouted_events_are_acked_without_delivery_or_grouping() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();
    let (url, hits, _hook) = common::start_counting_webhook().await;
    let (sink, ctx) = capturing_ctx(&infra);
    let no_routes_tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    store
        .create_channel(
            ctx.cipher.as_ref(),
            no_routes_tenant.clone(),
            "unused-hook",
            &ChannelConfig::Webhook { url: url.clone() },
        )
        .await
        .unwrap();
    store
        .create_receiver(
            no_routes_tenant.clone(),
            "unused-receiver",
            &["unused-hook".to_string()],
            &BTreeMap::new(),
        )
        .await
        .unwrap();

    let unmatched_tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    store
        .create_channel(
            ctx.cipher.as_ref(),
            unmatched_tenant.clone(),
            "critical-hook",
            &ChannelConfig::Webhook { url },
        )
        .await
        .unwrap();
    store
        .create_receiver(
            unmatched_tenant.clone(),
            "critical-oncall",
            &["critical-hook".to_string()],
            &BTreeMap::new(),
        )
        .await
        .unwrap();
    store
        .create_route(
            unmatched_tenant.clone(),
            &[Matcher {
                label: "severity".into(),
                op: MatchOp::Eq,
                value: "critical".into(),
            }],
            "critical-oncall",
            false,
            0,
            None,
            Some(0),
            Some(0),
            None,
        )
        .await
        .unwrap();

    for (event, consumer) in [
        (ev_svc(no_routes_tenant, "api"), "no-routes"),
        (ev_svc(unmatched_tenant, "api"), "unmatched-route"),
    ] {
        infra.bus.publish(&event).await.unwrap();
        let entries = infra.bus.consume(consumer, 1, 500).await.unwrap();
        assert_eq!(entries.len(), 1);
        assert!(process_event(&ctx, &entries[0]).await, "{consumer}");
    }

    assert_eq!(hits.load(Ordering::Relaxed), 0);
    assert!(sink.calls.lock().unwrap().is_empty());
    assert!(infra
        .groups
        .claim_due(i64::MAX / 2, 32)
        .await
        .unwrap()
        .is_empty());
}

/// Grouped delivery records the receiver name rather than the internal group key.
#[tokio::test]
async fn grouped_delivery_uses_clean_receiver_name() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let (url, hits, _hook) = common::start_counting_webhook().await;

    let (sink, ctx) = capturing_ctx(&infra);

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

    let acked = process_event(&ctx, &entries[0]).await;
    assert!(acked, "routed event should ack after buffering");
    assert_eq!(
        hits.load(Ordering::Relaxed),
        0,
        "grouped path defers delivery to flush"
    );

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

/// A silenced event records the matching silence without delivery.
#[tokio::test]
async fn silenced_event_emits_a_silenced_record() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let (url, hits, _hook) = common::start_counting_webhook().await;

    let (sink, ctx) = capturing_ctx(&infra);

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    common::create_webhook_delivery(&store, ctx.cipher.as_ref(), tenant.clone(), &url).await;

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

/// A silence created after buffering still suppresses delivery at flush time.
#[tokio::test]
async fn flush_time_silence_emits_a_silenced_record() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let (url, hits, _hook) = common::start_counting_webhook().await;

    let (sink, ctx) = capturing_ctx(&infra);

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

/// Flush-time inhibition suppresses delivery without emitting a delivery record.
#[tokio::test]
async fn flush_time_inhibition_emits_no_record() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();

    let (url, hits, _hook) = common::start_counting_webhook().await;

    let (sink, ctx) = capturing_ctx(&infra);

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

    let target = ev_svc(tenant.clone(), "db");
    infra.bus.publish(&target).await.unwrap();
    let entries = infra.bus.consume("test-consumer", 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);

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
