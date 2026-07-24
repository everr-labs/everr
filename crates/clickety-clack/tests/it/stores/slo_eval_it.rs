use cc::domain::event::{EventKind, EventStatus};
use cc::domain::ids::{SloId, TenantId};
use cc::domain::slo::{SliSpec, SloSpec, TimeWindow};
use cc::stores::{PgStore, SloCreate};
use serde_json::json;
use std::collections::BTreeMap;
use time::{Duration, OffsetDateTime};

fn tenant() -> TenantId {
    TenantId::from_trusted("acme")
}
fn spec() -> SloSpec {
    SloSpec {
        sli: SliSpec { sql: "SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}".into(), label_columns: vec![] },
        target_percent: 99.9,
        time_window: TimeWindow { duration: "30d".into(), is_rolling: true, calendar: None },
        min_valid_events: None, annotations: BTreeMap::new(), suppressed: false,
    }
}
async fn store() -> PgStore {
    PgStore::connect(&crate::support::fresh_db().await)
        .await
        .unwrap()
}
async fn make_slo(s: &PgStore, name: &str) -> SloId {
    match s.create_slo(tenant(), "", name, &spec()).await.unwrap() {
        SloCreate::Created(slo) => slo.id,
        _ => panic!(),
    }
}

#[tokio::test]
async fn claims_only_due_and_advances_next_eval() {
    let s = store().await;
    let id = make_slo(&s, "a").await;
    // create_slo arms next_eval at the SLO's jitter phase within one cadence,
    // so claim past one full cadence to be sure it's due.
    let now = OffsetDateTime::now_utc() + Duration::seconds(30);
    let due = s
        .claim_due_slos_sharded(now, 10, &[0], 1, 30)
        .await
        .unwrap();
    assert!(due.iter().any(|slo| slo.id == id));
    // second claim at the same instant returns nothing (next_eval advanced past now)
    let due2 = s
        .claim_due_slos_sharded(now, 10, &[0], 1, 30)
        .await
        .unwrap();
    assert!(!due2.iter().any(|slo| slo.id == id));
}

#[tokio::test]
async fn idempotency_ledger_claims_once() {
    let s = store().await;
    let id = make_slo(&s, "b").await;
    let ts = OffsetDateTime::now_utc();
    assert!(s.try_claim_slo_eval(id, ts).await.unwrap());
    assert!(!s.try_claim_slo_eval(id, ts).await.unwrap());
}

#[tokio::test]
async fn health_degrades_after_k_and_recovers() {
    let s = store().await;
    let id = make_slo(&s, "c").await;
    let now = OffsetDateTime::now_utc();
    assert!(s
        .record_slo_failure(id, &tenant(), "boom", 2, now)
        .await
        .unwrap()
        .is_none()); // 1st

    // 2nd -> degraded: a Firing/RuleHealth event with `slo` set, written to the outbox.
    let (ev, outbox_id) = s
        .record_slo_failure(id, &tenant(), "boom", 2, now)
        .await
        .unwrap()
        .expect("crosses threshold");
    assert_eq!(ev.kind, EventKind::RuleHealth);
    assert_eq!(ev.slo, Some(id));
    assert_eq!(ev.status, EventStatus::Firing);
    let claimed = s
        .claim_outbox(now + Duration::seconds(60), 10)
        .await
        .unwrap();
    assert!(
        claimed.iter().any(|(oid, _)| *oid == outbox_id),
        "degrade event present in outbox"
    );

    // Recovers: a Resolved/RuleHealth event with `slo` set.
    let (ev, _id) = s
        .record_slo_success(id, &tenant(), now)
        .await
        .unwrap()
        .expect("recovers from degraded");
    assert_eq!(ev.kind, EventKind::RuleHealth);
    assert_eq!(ev.slo, Some(id));
    assert_eq!(ev.status, EventStatus::Resolved);

    // Already healthy: no further transition.
    assert!(s
        .record_slo_success(id, &tenant(), now)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn status_snapshot_upsert_and_read() {
    let s = store().await;
    let id = make_slo(&s, "d").await;
    let now = OffsetDateTime::now_utc();
    s.upsert_slo_status(id, &tenant(), &json!({"groups": []}), now)
        .await
        .unwrap();
    let got = s.get_slo_status(&tenant(), id).await.unwrap().unwrap();
    assert_eq!(got.payload, json!({"groups": []}));
    // upsert replaces
    s.upsert_slo_status(id, &tenant(), &json!({"groups": [1]}), now)
        .await
        .unwrap();
    assert_eq!(
        s.get_slo_status(&tenant(), id)
            .await
            .unwrap()
            .unwrap()
            .payload,
        json!({"groups": [1]})
    );
}
