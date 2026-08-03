//! Reliability of the group buffer/flush store: out-of-order buffering must not
//! resurrect a resolved alert, and a claimed group whose take fails must be retried
//! rather than orphaned.

use crate::common;
use cc::dispatcher::flush_group;
use cc::domain::channel::ChannelConfig;
use cc::domain::event::EventStatus;
use cc::domain::ids::TenantId;
use cc::queue::groups::GroupMeta;
use redis::AsyncCommands;
use std::sync::atomic::Ordering;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

fn now_ms() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

fn meta() -> GroupMeta {
    GroupMeta {
        tenant: "t".into(),
        channels: vec![Uuid::nil()],
        group_key: "k".into(),
        receiver: "r".into(),
    }
}

/// A Firing and a later Resolved for the same instance can be buffered concurrently, so
/// the older Firing may HSET last. The eval_ts guard in `add_to_group` must make the newer
/// Resolved win regardless of write order: no stale buffered event and no firing membership.
#[tokio::test]
async fn stale_firing_does_not_resurrect_a_newer_resolved() {
    let infra = common::dispatch_infra().await;
    let groups = infra.groups.clone();
    let (gid, fp) = ("g-reorder", "svc=api");

    let t1 = OffsetDateTime::UNIX_EPOCH + Duration::seconds(30);
    let t2 = t1 + Duration::seconds(30);
    let mut firing = common::base_event();
    firing.status = EventStatus::Firing;
    firing.eval_ts = t1;
    let mut resolved = common::base_event();
    resolved.status = EventStatus::Resolved;
    resolved.eval_ts = t2;

    let now = now_ms();
    // The concurrent reorder: the newer Resolved lands first, the older Firing lands last.
    groups
        .add_to_group(gid, &meta(), fp, &resolved, now, 0, 0, false, None)
        .await
        .unwrap();
    groups
        .add_to_group(gid, &meta(), fp, &firing, now, 0, 0, true, None)
        .await
        .unwrap();

    let batch = groups
        .take_group(gid, now)
        .await
        .unwrap()
        .expect("group exists");
    assert!(
        batch.firing.is_empty(),
        "a stale firing must not re-add firing membership"
    );
    assert_eq!(batch.events.len(), 1, "one buffered event for the instance");
    assert_eq!(
        batch.events[0].status,
        EventStatus::Resolved,
        "the newest eval_ts (Resolved) wins regardless of write order"
    );
}

/// `claim_due` removes a group's flush timer before the flusher takes it. If `take_group`
/// then fails, the group must be re-armed rather than left buffered with no scheduled
/// flush. Force the failure by corrupting `__meta__` so the snapshot parse errors.
#[tokio::test]
async fn take_group_failure_rearms_instead_of_orphaning() {
    let infra = common::dispatch_infra().await;
    let ctx = common::dispatch_ctx(&infra);
    let groups = infra.groups.clone();
    let (gid, fp) = ("g-poison", "svc=api");

    let mut ev = common::base_event();
    ev.eval_ts = OffsetDateTime::UNIX_EPOCH + Duration::seconds(30);
    let now = now_ms();
    groups
        .add_to_group(gid, &meta(), fp, &ev, now, 0, 0, true, None)
        .await
        .unwrap();

    // Claim the group, mirroring the flusher (this removes its timer from the zset).
    let claimed = groups.claim_due(now, 16).await.unwrap();
    assert!(
        claimed.contains(&gid.to_string()),
        "group was armed and claimed"
    );

    // Corrupt __meta__ so take_group's JSON parse fails on the next flush.
    let client = redis::Client::open(infra.redis.url.clone()).unwrap();
    let mut conn = client.get_multiplexed_async_connection().await.unwrap();
    let _: () = conn
        .hset(format!("cc:group:{gid}"), "__meta__", "not-json")
        .await
        .unwrap();

    // The flush hits the take failure; the fix must re-arm the timer instead of returning.
    flush_group(&ctx, gid).await;

    // The group is re-armed shortly in the future; claiming past that offset finds it again.
    let rearmed = groups.claim_due(now + 60_000, 16).await.unwrap();
    assert!(
        rearmed.contains(&gid.to_string()),
        "a take_group failure must re-arm the flush timer, not orphan the group"
    );
}

/// Delivery-capable harness: one webhook channel (counting stub) registered for a fresh
/// tenant, plus a `GroupMeta` referencing it, so `flush_group` runs the full path.
struct DeliveryHarness {
    _infra: common::DispatchInfra,
    ctx: cc::dispatcher::DispatchCtx,
    groups: std::sync::Arc<dyn cc::queue::groups::GroupStore>,
    meta: GroupMeta,
    tenant: TenantId,
    hits: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

impl DeliveryHarness {
    fn hits(&self) -> usize {
        self.hits.load(Ordering::Relaxed)
    }
}

async fn delivery_harness() -> DeliveryHarness {
    let infra = common::dispatch_infra().await;
    let ctx = common::dispatch_ctx(&infra);
    let (url, hits, _hook) = common::start_counting_webhook().await;

    let tenant_s = Uuid::new_v4().to_string();
    let tenant = TenantId::from_trusted(tenant_s.clone());
    let hook = infra
        .store
        .create_channel(
            ctx.cipher.as_ref(),
            tenant.clone(),
            "hook",
            &ChannelConfig::Webhook { url },
        )
        .await
        .unwrap();
    let meta = GroupMeta {
        tenant: tenant_s,
        channels: vec![hook.id],
        group_key: "k".into(),
        receiver: "r".into(),
    };
    DeliveryHarness {
        groups: infra.groups.clone(),
        _infra: infra,
        ctx,
        meta,
        tenant,
        hits,
    }
}

/// The take -> deliver crash window: a flusher that takes (snapshots) a batch and dies
/// before delivering must not lose it. The take is non-destructive, so once the lease
/// expires the reclaimed group still holds the batch and the next flush delivers it.
#[tokio::test]
async fn batch_taken_but_undelivered_is_redelivered_after_reclaim() {
    let h = delivery_harness().await;
    let (gid, fp) = ("g-take-crash", "svc=api");

    let mut ev = common::base_event();
    ev.tenant = h.tenant.clone();
    ev.eval_ts = OffsetDateTime::UNIX_EPOCH + Duration::seconds(30);
    let now = now_ms();
    h.groups
        .add_to_group(gid, &h.meta, fp, &ev, now, 0, 0, true, None)
        .await
        .unwrap();
    assert!(h
        .groups
        .claim_due(now, 16)
        .await
        .unwrap()
        .contains(&gid.to_string()));

    // The dying flusher got exactly as far as the take: batch snapshotted, nothing
    // delivered, nothing drained, lease never released.
    let taken = h
        .groups
        .take_group(gid, now)
        .await
        .unwrap()
        .expect("group exists");
    assert_eq!(taken.events.len(), 1);
    assert_eq!(h.hits(), 0, "crashed before delivery");

    // Lease expiry: another replica reclaims, claims, and flushes the group.
    assert!(h
        .groups
        .reclaim_expired(now + 61_000, 16)
        .await
        .unwrap()
        .contains(&gid.to_string()));
    assert!(h
        .groups
        .claim_due(now + 61_000, 16)
        .await
        .unwrap()
        .contains(&gid.to_string()));
    flush_group(&h.ctx, gid).await;

    assert_eq!(
        h.hits(),
        1,
        "the taken-but-undelivered batch must be re-delivered, not lost"
    );
    // The successful flush committed the drain: nothing is left to deliver.
    let after = h
        .groups
        .take_group(gid, now + 62_000)
        .await
        .unwrap()
        .unwrap();
    assert!(after.events.is_empty(), "drain committed after delivery");
}

/// A reflush of an already-delivered batch (crash between delivery and the drain
/// commit) must not double-send: the notifications ledger dedups the identical set.
#[tokio::test]
async fn reflush_of_a_delivered_batch_is_deduped_not_double_sent() {
    let h = delivery_harness().await;
    let (gid, fp) = ("g-reflush", "svc=api");

    let mut ev = common::base_event();
    ev.tenant = h.tenant.clone();
    ev.eval_ts = OffsetDateTime::UNIX_EPOCH + Duration::seconds(30);
    let now = now_ms();
    h.groups
        .add_to_group(gid, &h.meta, fp, &ev, now, 0, 0, true, None)
        .await
        .unwrap();
    h.groups.claim_due(now, 16).await.unwrap();
    flush_group(&h.ctx, gid).await;
    assert_eq!(h.hits(), 1, "original delivery");

    // The crash-window replay: the identical event (same instance, status, eval_ts) is
    // buffered again, which is exactly what a reflush of an undrained batch takes.
    let now = now_ms();
    h.groups
        .add_to_group(gid, &h.meta, fp, &ev, now, 0, 0, true, None)
        .await
        .unwrap();
    assert!(h
        .groups
        .claim_due(now, 16)
        .await
        .unwrap()
        .contains(&gid.to_string()));
    flush_group(&h.ctx, gid).await;

    assert_eq!(h.hits(), 1, "ledger dedup must suppress the re-delivery");
    // The deduped reflush still commits the drain: the batch does not linger.
    let after = h.groups.take_group(gid, now_ms()).await.unwrap().unwrap();
    assert!(after.events.is_empty(), "reflush drained the batch");
}
