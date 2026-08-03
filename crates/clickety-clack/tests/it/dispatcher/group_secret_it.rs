//! Secret hygiene of the group buffer: metas carry channel NAMES only, so no secret
//! ever reaches Redis, and the flusher resolves names to their stored configs at
//! delivery time — a secret rotation between buffering and flush is picked up.

use crate::common;
use cc::dispatcher::{flush_group, grouping, process_event};
use cc::domain::channel::ChannelConfig;
use cc::domain::event::Event;
use cc::domain::ids::TenantId;
use std::sync::atomic::Ordering;
use uuid::Uuid;

fn sample_event(tenant: TenantId) -> Event {
    let mut e = common::base_event();
    e.tenant = tenant;
    e
}

#[tokio::test]
async fn group_hash_holds_no_secret_and_flush_uses_the_rotated_config() {
    let infra = common::dispatch_infra().await;
    let store = infra.store.clone();
    let ctx = common::dispatch_ctx(&infra);
    let redis_url = infra.redis.url.clone();

    // Two webhook endpoints whose URLs carry a secret token: the original config and
    // the rotated one it is replaced with between buffering and flush.
    let (old_base, old_hits, _old_task) = common::start_counting_webhook().await;
    let old_url = format!("{old_base}?token=SECRET-XYZ");
    let (new_base, new_hits, _new_task) = common::start_counting_webhook().await;
    let new_url = format!("{new_base}?token=ROTATED-SECRET");

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let receiver_name = "oncall";
    let channel = store
        .create_channel(
            ctx.cipher.as_ref(),
            tenant.clone(),
            "oncall-hook",
            &ChannelConfig::Webhook {
                url: old_url.clone(),
            },
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

    // Zero TTL so the flush-time snapshot picks up the rotated channel config.
    let ctx = cc::dispatcher::DispatchCtx {
        cache: std::sync::Arc::new(cc::dispatcher::cache::FilterCache::with_ttl(
            store.clone(),
            std::time::Duration::ZERO,
        )),
        ..ctx
    };

    // Buffer through the real ingest path, exactly as the dispatcher does.
    let event = sample_event(tenant.clone());
    infra.bus.publish(&event).await.unwrap();
    let entries = infra.bus.consume("test-consumer", 1, 500).await.unwrap();
    assert_eq!(entries.len(), 1);
    let acked = process_event(&ctx, &entries[0]).await;
    assert!(acked, "routed event should ack after buffering");

    // Raw Redis read of the whole group hash: only the channel ID is buffered; the
    // secret-bearing URL must not be present anywhere.
    let group_by = grouping::default_group_by();
    let labels = cc::dispatcher::routing::match_labels(&event);
    let values = grouping::group_by_values(&labels, &group_by);
    let gid = grouping::group_id(&tenant, &receiver.id.to_string(), &group_by, &values);
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_multiplexed_async_connection().await.unwrap();
    let raw: Vec<String> = redis::cmd("HGETALL")
        .arg(format!("cc:group:{gid}"))
        .query_async(&mut conn)
        .await
        .unwrap();
    let flat = raw.join("\n");
    assert!(
        !flat.contains("SECRET-XYZ"),
        "secret leaked into Redis: {flat}"
    );
    assert!(
        flat.contains(&channel.id.to_string()),
        "meta should carry the channel id: {flat}"
    );
    assert!(
        !flat.contains("oncall-hook"),
        "meta should not carry the channel name: {flat}"
    );

    // Rotate the channel's secret between buffering and flush (upsert by name).
    store
        .create_channel(
            ctx.cipher.as_ref(),
            tenant.clone(),
            "oncall-hook",
            &ChannelConfig::Webhook {
                url: new_url.clone(),
            },
        )
        .await
        .unwrap();

    // Flush resolves the buffered name to the CURRENT stored config.
    flush_group(&ctx, &gid).await;

    assert_eq!(
        old_hits.load(Ordering::Relaxed),
        0,
        "the pre-rotation endpoint must not be hit"
    );
    assert_eq!(
        new_hits.load(Ordering::Relaxed),
        1,
        "flush delivers to the config stored at delivery time"
    );
}
