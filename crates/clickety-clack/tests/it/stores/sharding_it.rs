use crate::support::create_test_rule;
use cc::domain::ids::TenantId;
use cc::domain::rule::{RuleSpec, Severity};
use cc::stores::PgStore;
use std::collections::{BTreeMap, HashSet};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

fn spec() -> RuleSpec {
    RuleSpec {
        sql: "SELECT 1".into(),
        interval_secs: 30,
        for_secs: 0,
        label_columns: vec![],
        value_column: None,
        severity: Severity::Warning,
        annotations: BTreeMap::new(),
        resolve_after: 1,
        max_interval_secs: None,
        suppressed: false,
    }
}

async fn store() -> (PgStore, impl Sized) {
    let url = crate::support::fresh_db().await;
    let store = PgStore::connect(&url).await.unwrap();
    (store, ())
}

#[tokio::test]
async fn sharded_claim_partitions_without_loss_or_overlap() {
    let (store, _node) = store().await;
    let mut all = HashSet::new();
    for _ in 0..50 {
        let t = TenantId::from_trusted(Uuid::new_v4().to_string());
        all.insert(
            create_test_rule(
                &store,
                t,
                "t/sharded_claim_partitions_without_loss_or_overlap",
                &spec(),
            )
            .await
            .id
            .0,
        );
    }
    // Past one full interval: create_rule arms next_eval at the rule's jitter
    // phase in [0, interval_secs), so +31s guarantees every rule is due.
    let now = OffsetDateTime::now_utc() + Duration::seconds(31);
    let n = 256;
    let lo: Vec<i32> = (0..128).collect();
    let hi: Vec<i32> = (128..256).collect();

    let a = store
        .claim_due_rules_sharded(now, 1000, &lo, n)
        .await
        .unwrap();
    let b = store
        .claim_due_rules_sharded(now, 1000, &hi, n)
        .await
        .unwrap();

    let mut union = HashSet::new();
    for r in a.iter().chain(b.iter()) {
        assert!(
            union.insert(r.id.0),
            "rule {} claimed by both shard halves",
            r.id.0
        );
    }
    assert_eq!(
        union, all,
        "every due rule claimed exactly once across the partition"
    );
}

#[tokio::test]
async fn full_shard_set_claims_all_rules() {
    let (store, _node) = store().await;
    let mut ids = HashSet::new();
    for _ in 0..20 {
        let t = TenantId::from_trusted(Uuid::new_v4().to_string());
        ids.insert(
            create_test_rule(&store, t, "t/full_shard_set_claims_all_rules", &spec())
                .await
                .id
                .0,
        );
    }
    // Past one full interval: create_rule arms next_eval at the rule's jitter
    // phase in [0, interval_secs), so +31s guarantees every rule is due.
    let now = OffsetDateTime::now_utc() + Duration::seconds(31);
    let all: Vec<i32> = (0..256).collect();
    let claimed = store
        .claim_due_rules_sharded(now, 1000, &all, 256)
        .await
        .unwrap();
    let got: HashSet<_> = claimed.iter().map(|r| r.id.0).collect();
    assert_eq!(got, ids);
}
