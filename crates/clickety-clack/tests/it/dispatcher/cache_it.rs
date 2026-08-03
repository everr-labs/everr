use cc::dispatcher::cache::FilterCache;
use cc::domain::ids::TenantId;
use cc::domain::routing::{MatchOp, Matcher};
use cc::stores::PgStore;
use std::time::Duration;
use time::OffsetDateTime;
use uuid::Uuid;

#[tokio::test]
async fn snapshot_caches_within_ttl_and_reloads_after() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();

    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let now = OffsetDateTime::now_utc();
    let m = vec![Matcher {
        label: "svc".into(),
        op: MatchOp::Eq,
        value: "api".into(),
    }];
    store
        .create_silence(
            tenant.clone(),
            &m,
            now - time::Duration::seconds(1),
            now + time::Duration::hours(1),
            "",
            "",
        )
        .await
        .unwrap();

    let cache = FilterCache::with_ttl(store.clone(), Duration::from_millis(150));

    let s1 = cache.snapshot(tenant.clone()).await.unwrap();
    assert_eq!(s1.silences.len(), 1);

    // Add a second silence directly; the cached snapshot must NOT see it yet.
    store
        .create_silence(
            tenant.clone(),
            &m,
            now - time::Duration::seconds(1),
            now + time::Duration::hours(1),
            "",
            "",
        )
        .await
        .unwrap();
    let s2 = cache.snapshot(tenant.clone()).await.unwrap();
    assert_eq!(s2.silences.len(), 1, "served from cache within TTL");

    // After the TTL elapses, the next snapshot reloads and sees both.
    tokio::time::sleep(Duration::from_millis(200)).await;
    let s3 = cache.snapshot(tenant).await.unwrap();
    assert_eq!(s3.silences.len(), 2, "reloaded after TTL");
}
