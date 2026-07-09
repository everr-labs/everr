use cc::crypto::{EnvKeyring, SecretCipher};
use cc::domain::ids::TenantId;
use cc::stores::PgStore;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

fn test_cipher() -> Arc<dyn SecretCipher> {
    Arc::new(
        EnvKeyring::new(
            HashMap::from([("v1".to_string(), [7u8; 32])]),
            "v1".to_string(),
        )
        .unwrap(),
    )
}

#[tokio::test]
async fn subscription_url_not_stored_cleartext() {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    let cipher = test_cipher();
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    store
        .create_subscription(
            cipher.as_ref(),
            tenant.clone(),
            "https://hook.test/SUB-SECRET",
        )
        .await
        .unwrap();

    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    let raw: String = sqlx::query_scalar("SELECT webhook_url FROM subscriptions WHERE tenant=$1")
        .bind(tenant.as_str())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        !raw.contains("SUB-SECRET"),
        "subscription url leaked at rest: {raw}"
    );

    let subs = store
        .subscriptions_for(cipher.as_ref(), tenant)
        .await
        .unwrap();
    assert_eq!(subs.len(), 1);
    assert_eq!(subs[0].webhook_url, "https://hook.test/SUB-SECRET");
}
