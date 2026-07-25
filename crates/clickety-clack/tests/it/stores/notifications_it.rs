use cc::domain::ids::TenantId;
use cc::stores::{BeginOutcome, PgStore};
use sqlx::{Connection, PgConnection};
use uuid::Uuid;

/// Age a notification's lease past expiry, standing in for the wall-clock wait without
/// sleeping (and without needing a short, flake-prone test lease). Takes a single
/// connection and closes it, rather than leaking a whole pool per call: every test in
/// this binary shares one Postgres server.
async fn expire_lease(url: &str, dedup_key: &str) {
    let mut conn = PgConnection::connect(url).await.unwrap();
    sqlx::query(
        "UPDATE notifications SET updated_at = now() - interval '1 hour' WHERE dedup_key=$1",
    )
    .bind(dedup_key)
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
}

#[tokio::test]
async fn notification_dedup_and_status() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let key = "k1";

    assert!(matches!(
        store
            .try_begin_notification(key, tenant.clone(), "webhook", "http://x")
            .await
            .unwrap(),
        BeginOutcome::Claimed { claims: 0 }
    ));
    // Second claim inside the lease: another sender may still be in flight, so this
    // is NOT "handled" — the caller must retry rather than ack.
    assert!(matches!(
        store
            .try_begin_notification(key, tenant.clone(), "webhook", "http://x")
            .await
            .unwrap(),
        BeginOutcome::InFlight
    ));

    assert_eq!(
        store.notification_status(&tenant, key).await.unwrap(),
        Some(("pending".into(), 0))
    );
    store.mark_notification_sent(&tenant, key, 2).await.unwrap();
    assert_eq!(
        store.notification_status(&tenant, key).await.unwrap(),
        Some(("sent".into(), 2))
    );
    // Terminal row: now a genuine dedup skip.
    assert!(matches!(
        store
            .try_begin_notification(key, tenant.clone(), "webhook", "http://x")
            .await
            .unwrap(),
        BeginOutcome::AlreadyHandled
    ));

    let key2 = "k2";
    assert!(matches!(
        store
            .try_begin_notification(key2, tenant.clone(), "webhook", "http://y")
            .await
            .unwrap(),
        BeginOutcome::Claimed { claims: 0 }
    ));
    store
        .mark_notification_failed(&tenant, key2, 3, "boom")
        .await
        .unwrap();
    assert_eq!(
        store.notification_status(&tenant, key2).await.unwrap(),
        Some(("failed".into(), 3))
    );
    // `failed` is terminal too (the event was dead-lettered), so it stays deduped.
    assert!(matches!(
        store
            .try_begin_notification(key2, tenant.clone(), "webhook", "http://y")
            .await
            .unwrap(),
        BeginOutcome::AlreadyHandled
    ));
}

/// The crash window: a sender inserts `pending` and dies before reaching a terminal
/// state. Once the lease expires the row must be reclaimable, or that exact
/// notification is suppressed forever.
#[tokio::test]
async fn stale_pending_row_is_reclaimed_after_lease_expiry() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let key = "crashed";

    assert!(matches!(
        store
            .try_begin_notification(key, tenant.clone(), "webhook", "http://x")
            .await
            .unwrap(),
        BeginOutcome::Claimed { claims: 0 }
    ));
    // ... sender dies here, leaving the row `pending` ...
    expire_lease(&url, key).await;

    // The reclaiming sender owns the send, and the claim count carries over so a
    // notification that keeps killing its sender can be bounded by the caller.
    assert!(matches!(
        store
            .try_begin_notification(key, tenant.clone(), "webhook", "http://x")
            .await
            .unwrap(),
        BeginOutcome::Claimed { claims: 1 }
    ));
    // The claim count is its own column: `attempts` still describes delivery retries.
    assert_eq!(
        store.notification_status(&tenant, key).await.unwrap(),
        Some(("pending".into(), 0))
    );

    // Reclaiming refreshes the lease, so a concurrent sender is held off again.
    assert!(matches!(
        store
            .try_begin_notification(key, tenant.clone(), "webhook", "http://x")
            .await
            .unwrap(),
        BeginOutcome::InFlight
    ));

    // Once it reaches a terminal state the row stops being reclaimable, however long
    // it sits there.
    store.mark_notification_sent(&tenant, key, 1).await.unwrap();
    expire_lease(&url, key).await;
    assert!(matches!(
        store
            .try_begin_notification(key, tenant.clone(), "webhook", "http://x")
            .await
            .unwrap(),
        BeginOutcome::AlreadyHandled
    ));
}

/// Only one of several racing senders may claim the same expired lease.
#[tokio::test]
async fn concurrent_reclaim_of_one_stale_row_yields_a_single_claim() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let key = "raced";
    store
        .try_begin_notification(key, tenant.clone(), "webhook", "http://x")
        .await
        .unwrap();
    expire_lease(&url, key).await;

    let results = futures::future::join_all((0..8).map(|_| {
        let store = store.clone();
        let tenant = tenant.clone();
        async move {
            store
                .try_begin_notification(key, tenant, "webhook", "http://x")
                .await
                .unwrap()
        }
    }))
    .await;

    let claimed = results
        .iter()
        .filter(|o| matches!(o, BeginOutcome::Claimed { .. }))
        .count();
    assert_eq!(claimed, 1, "exactly one sender may own an expired lease");
    assert!(results
        .iter()
        .all(|o| matches!(o, BeginOutcome::Claimed { .. } | BeginOutcome::InFlight)));
}
