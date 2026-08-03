use cc::domain::ids::TenantId;
use cc::domain::routing::{MatchOp, Matcher};
use cc::stores::PgStore;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

async fn store() -> PgStore {
    let url = crate::support::fresh_db().await;
    let s = PgStore::connect(&url).await.unwrap();
    s
}

fn m(label: &str, value: &str) -> Matcher {
    Matcher {
        label: label.into(),
        op: MatchOp::Eq,
        value: value.into(),
    }
}

#[tokio::test]
async fn silence_crud_and_active_window() {
    let store = store().await;
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());
    let now = OffsetDateTime::now_utc();

    let active = store
        .create_silence(
            tenant.clone(),
            &[m("svc", "api")],
            now - Duration::seconds(5),
            now + Duration::seconds(60),
            "maint",
            "ops",
        )
        .await
        .unwrap();
    let _past = store
        .create_silence(
            tenant.clone(),
            &[m("svc", "api")],
            now - Duration::seconds(120),
            now - Duration::seconds(60),
            "old",
            "ops",
        )
        .await
        .unwrap();
    let _future = store
        .create_silence(
            tenant.clone(),
            &[m("svc", "api")],
            now + Duration::seconds(60),
            now + Duration::seconds(120),
            "later",
            "ops",
        )
        .await
        .unwrap();

    assert_eq!(
        store.list_silences(tenant.clone()).await.unwrap().len(),
        3,
        "list returns all"
    );

    let act = store
        .list_active_silences(tenant.clone(), now)
        .await
        .unwrap();
    assert_eq!(act.len(), 1, "only the window-covering silence is active");
    assert_eq!(act[0].id, active.id);

    assert!(store
        .delete_silence(tenant.clone(), active.id)
        .await
        .unwrap());
    assert!(
        !store
            .delete_silence(tenant.clone(), active.id)
            .await
            .unwrap(),
        "second delete is a no-op"
    );
    assert_eq!(store.list_silences(tenant).await.unwrap().len(), 2);
}
