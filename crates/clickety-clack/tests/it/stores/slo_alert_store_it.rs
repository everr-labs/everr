use cc::domain::ids::{InstanceKey, RuleId, SloId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::rule::Severity;
use cc::domain::slo::{SliSpec, SloSpec, TimeWindow};
use cc::domain::{Event, EventKind, EventStatus};
use cc::stores::{PgStore, SloCreate};
use std::collections::BTreeMap;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

fn tenant() -> TenantId {
    TenantId::from_trusted(Uuid::new_v4().to_string())
}

fn spec() -> SloSpec {
    SloSpec {
        sli: SliSpec { sql: "SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}".into(), label_columns: vec![] },
        target_percent: 99.9,
        time_window: TimeWindow { duration: "30d".into(), is_rolling: true, calendar: None },
        min_valid_events: None, tiers: None, annotations: BTreeMap::new(), suppressed: false,
    }
}

async fn store() -> PgStore {
    PgStore::connect(&crate::support::fresh_db().await)
        .await
        .unwrap()
}

async fn make_slo(s: &PgStore, tenant: &TenantId, name: &str) -> SloId {
    match s.create_slo(tenant.clone(), name, &spec()).await.unwrap() {
        SloCreate::Created(slo) => slo.id,
        _ => panic!(),
    }
}

#[tokio::test]
async fn persist_and_load_roundtrip() {
    let s = store().await;
    let t = tenant();
    let slo_id = make_slo(&s, &t, "a").await;
    let rule = RuleId(slo_id.0);

    let labels_a = BTreeMap::from([("svc".to_string(), "checkout".to_string())]);
    let inst_a =
        InstanceState::new_inactive(InstanceKey::new(rule, &labels_a), rule, t.clone(), labels_a);

    let labels_b = BTreeMap::from([("svc".to_string(), "payments".to_string())]);
    let mut inst_b = InstanceState::new_inactive(
        InstanceKey::new(rule, &labels_b),
        rule,
        t.clone(),
        labels_b.clone(),
    );
    inst_b.status = Status::Firing;
    inst_b.value = Some(1.0);
    inst_b.active_since = Some(OffsetDateTime::now_utc());
    inst_b.last_seen = Some(OffsetDateTime::now_utc());

    let event = Event {
        tenant: t.clone(),
        rule,
        slo: Some(slo_id),
        instance_key: inst_b.key.clone(),
        status: EventStatus::Firing,
        kind: EventKind::Alert,
        labels: labels_b.clone(),
        value: Some(1.0),
        severity: Severity::Critical,
        annotations: BTreeMap::new(),
        eval_ts: OffsetDateTime::now_utc(),
        suppressed: false,
        evidence: None,
        evidence_truncated: false,
    };

    let ids = s
        .persist_slo_eval_batch(
            &[inst_a.clone(), inst_b.clone()],
            std::slice::from_ref(&event),
        )
        .await
        .unwrap();
    assert_eq!(ids.len(), 1);

    let loaded = s.load_slo_instances(&t, slo_id).await.unwrap();
    assert_eq!(loaded.len(), 2);
    let got_a = loaded.iter().find(|i| i.key == inst_a.key).unwrap();
    assert_eq!(got_a.status, Status::Inactive);
    let got_b = loaded.iter().find(|i| i.key == inst_b.key).unwrap();
    assert_eq!(got_b.status, Status::Firing);
}

#[tokio::test]
async fn firing_source_set_resolves_tier_severity() {
    let s = store().await;
    let t = tenant();
    let slo_id = make_slo(&s, &t, "b").await;
    let rule = RuleId(slo_id.0);

    let labels = BTreeMap::from([("slo_tier".to_string(), "ticket".to_string())]);
    let mut inst =
        InstanceState::new_inactive(InstanceKey::new(rule, &labels), rule, t.clone(), labels);
    inst.status = Status::Firing;
    inst.value = Some(2.0);
    inst.active_since = Some(OffsetDateTime::now_utc());
    inst.last_seen = Some(OffsetDateTime::now_utc());

    s.persist_slo_eval_batch(&[inst.clone()], &[])
        .await
        .unwrap();

    let firing = s.list_firing_slos(&t).await.unwrap();
    assert_eq!(firing.len(), 1);
    assert_eq!(firing[0].key, inst.key);
    assert_eq!(firing[0].rule, rule);
    assert_eq!(firing[0].severity, Severity::Warning); // canonical "ticket" tier severity
}

#[tokio::test]
async fn stale_scan_excludes_paused_and_degraded() {
    let s = store().await;
    let t = tenant();

    let healthy_slo = make_slo(&s, &t, "healthy").await;
    let paused_slo = make_slo(&s, &t, "paused").await;
    let degraded_slo = make_slo(&s, &t, "degraded").await;

    s.pause_slo(t.clone(), paused_slo).await.unwrap();
    let now = OffsetDateTime::now_utc();
    // threshold 1: first failure degrades immediately
    assert!(s
        .record_slo_failure(degraded_slo, &t, "boom", 1, now)
        .await
        .unwrap()
        .is_some());

    let old = now - Duration::hours(1);
    for slo_id in [healthy_slo, paused_slo, degraded_slo] {
        let rule = RuleId(slo_id.0);
        let labels = BTreeMap::from([("svc".to_string(), "x".to_string())]);
        let mut inst =
            InstanceState::new_inactive(InstanceKey::new(rule, &labels), rule, t.clone(), labels);
        inst.status = Status::Firing;
        inst.value = Some(1.0);
        inst.active_since = Some(old);
        inst.last_seen = Some(old);
        s.persist_slo_eval_batch(&[inst], &[]).await.unwrap();
    }

    let stale = s.list_stale_slo_instances(now, 30, 10).await.unwrap();
    assert_eq!(stale.len(), 1);
    assert_eq!(stale[0].rule, RuleId(healthy_slo.0));
}

#[tokio::test]
async fn ledger_prune_deletes_old_rows() {
    let s = store().await;
    let t = tenant();
    let slo_id = make_slo(&s, &t, "prune").await;
    let _ = &t;

    let now = OffsetDateTime::now_utc();
    let old_ts = now - Duration::hours(2);

    assert!(s.try_claim_slo_eval(slo_id, old_ts).await.unwrap());
    assert!(s.try_claim_slo_eval(slo_id, now).await.unwrap());

    let (rules_pruned, slos_pruned) = s
        .prune_eval_ledgers(now - Duration::hours(1))
        .await
        .unwrap();
    assert_eq!(rules_pruned, 0);
    assert_eq!(slos_pruned, 1);

    // The pruned (slo, old_ts) pair can be claimed again.
    assert!(s.try_claim_slo_eval(slo_id, old_ts).await.unwrap());
    // The still-present recent claim cannot be reclaimed.
    assert!(!s.try_claim_slo_eval(slo_id, now).await.unwrap());
}
