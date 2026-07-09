use cc::domain::ids::TenantId;
use cc::stores::PgStore;
use uuid::Uuid;

#[tokio::test]
async fn notification_dedup_and_status() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let key = "k1";

    assert!(store
        .try_begin_notification(key, tenant.clone(), "webhook", "http://x")
        .await
        .unwrap());
    assert!(!store
        .try_begin_notification(key, tenant.clone(), "webhook", "http://x")
        .await
        .unwrap());

    assert_eq!(
        store.notification_status(&tenant, key).await.unwrap(),
        Some(("pending".into(), 0))
    );
    store.mark_notification_sent(&tenant, key, 2).await.unwrap();
    assert_eq!(
        store.notification_status(&tenant, key).await.unwrap(),
        Some(("sent".into(), 2))
    );

    let key2 = "k2";
    assert!(store
        .try_begin_notification(key2, tenant.clone(), "webhook", "http://y")
        .await
        .unwrap());
    store
        .mark_notification_failed(&tenant, key2, 3, "boom")
        .await
        .unwrap();
    assert_eq!(
        store.notification_status(&tenant, key2).await.unwrap(),
        Some(("failed".into(), 3))
    );
}
