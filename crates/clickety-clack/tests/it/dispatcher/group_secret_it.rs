use cc::crypto::{EnvKeyring, SecretCipher};
use cc::domain::event::{Event, EventStatus};
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::rule::Severity;
use cc::queue::groups::{GroupMeta, GroupStore, RedisGroups};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use testcontainers_modules::redis::Redis;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use time::OffsetDateTime;
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

fn sample_event(tenant: TenantId) -> Event {
    Event {
        tenant,
        rule: RuleId(Uuid::nil()),
        instance_key: InstanceKey("k".into()),
        status: EventStatus::Firing,
        kind: cc::domain::event::EventKind::Alert,
        labels: BTreeMap::new(),
        value: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::UNIX_EPOCH,
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    }
}

#[tokio::test]
async fn group_meta_target_is_encrypted_in_redis() {
    let redis = Redis::default().start().await.unwrap();
    let redis_url = format!(
        "redis://127.0.0.1:{}",
        redis.get_host_port_ipv4(6379).await.unwrap()
    );
    let groups = RedisGroups::connect(&redis_url).await.unwrap();
    let cipher = test_cipher();
    let tenant = TenantId::from_trusted(Uuid::new_v4().to_string());

    // Buffer with an ENCRYPTED target, exactly as the dispatcher does.
    let secret = "https://hooks.slack/SECRET-XYZ";
    let enc_target = cc::crypto::encrypt_str(cipher.as_ref(), secret).unwrap();
    let gid = "g-test";
    let meta = GroupMeta {
        tenant: tenant.as_str().to_string(),
        channel: "slack".into(),
        target: enc_target.clone(),
        group_key: "slack/[]".into(),
        receiver: "slack".into(),
    };
    let ev = sample_event(tenant);
    groups
        .add_to_group(gid, &meta, "fp1", &ev, 0, 1000, 1000, true, None)
        .await
        .unwrap();

    // Raw Redis read: the secret must not be present anywhere in the group hash.
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_multiplexed_async_connection().await.unwrap();
    let meta_raw: String = redis::cmd("HGET")
        .arg(format!("cc:group:{gid}"))
        .arg("__meta__")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(
        !meta_raw.contains("SECRET-XYZ"),
        "secret leaked into Redis: {meta_raw}"
    );

    // take_group returns the encrypted target; decrypt restores cleartext.
    let batch = groups.take_group(gid, 1).await.unwrap().unwrap();
    assert_eq!(batch.events.len(), 1);
    assert_eq!(
        cc::crypto::decrypt_str(cipher.as_ref(), &batch.meta.target).unwrap(),
        secret
    );
}
