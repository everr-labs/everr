use crate::support::create_test_slo;
use cc::domain::ids::{SloId, TenantId};
use cc::domain::slo::{SliSpec, SloSpec, TimeWindow};
use cc::stores::{PgStore, SloCreate, SloUpdate};
use std::collections::BTreeMap;

fn tenant() -> TenantId {
    TenantId::from_trusted("acme")
}

fn spec() -> SloSpec {
    SloSpec {
        sli: SliSpec {
            sql: "SELECT 1 AS good, 1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}".into(),
        },
        target_percent: 99.9,
        time_window: TimeWindow { duration: "30d".into(), is_rolling: true, calendar: None },
        min_valid_events: None,
        annotations: BTreeMap::new(),
        suppressed: false,
    }
}

async fn store() -> PgStore {
    let url = crate::support::fresh_db().await;
    PgStore::connect(&url).await.unwrap()
}

#[tokio::test]
async fn create_get_roundtrip() {
    let s = store().await;
    let created = create_test_slo(&s, tenant(), "checkout", &spec()).await;
    assert_eq!(created.version, 1);
    assert!(!created.paused);
    assert_eq!(created.name, "checkout");

    let (got, updated_at, budget_epoch) = s.get_slo(tenant(), created.id).await.unwrap().unwrap();
    assert_eq!(got, created);
    // Both timestamps are populated by insert defaults and never in the future;
    // on create the budget epoch is the SLO's birth (same `now()` as the write).
    let now = time::OffsetDateTime::now_utc();
    assert!(updated_at <= now);
    assert!(budget_epoch <= now);
}

#[tokio::test]
async fn budget_epoch_advances_only_on_significant_edits() {
    let s = store().await;
    let slo = create_test_slo(&s, tenant(), "e", &spec()).await;
    let (_, _, epoch0) = s.get_slo(tenant(), slo.id).await.unwrap().unwrap();

    // A no-op re-write of the identical spec is not an objective change: the
    // budget epoch must NOT move.
    s.update_slo(tenant(), slo.id, &spec(), None).await.unwrap();
    let (_, _, epoch1) = s.get_slo(tenant(), slo.id).await.unwrap().unwrap();
    assert_eq!(
        epoch1, epoch0,
        "a non-objective edit must not advance the budget epoch"
    );

    // A target change redefines the budget: the epoch MUST advance.
    let mut spec2 = spec();
    spec2.target_percent = 99.5;
    s.update_slo(tenant(), slo.id, &spec2, None).await.unwrap();
    let (_, _, epoch2) = s.get_slo(tenant(), slo.id).await.unwrap().unwrap();
    assert!(
        epoch2 > epoch1,
        "a target change must advance the budget epoch"
    );
}

#[tokio::test]
async fn objective_change_clears_the_status_snapshot() {
    let s = store().await;
    let slo = create_test_slo(&s, tenant(), "snap", &spec()).await;

    // Seed a status snapshot as the evaluator would.
    let seed_payload = serde_json::json!({
        "window": "30d", "target_percent": 99.9,
        "sli": null, "budget_remaining": null, "tiers": [],
        "window_computed_at": {}, "objective_fingerprint": "x",
    });
    s.upsert_slo_status(
        slo.id,
        &tenant(),
        &seed_payload,
        time::OffsetDateTime::now_utc(),
    )
    .await
    .unwrap();

    // A non-objective edit (identical spec) keeps the snapshot: its numbers still
    // describe the same query, so aging it out would waste a full recompute.
    s.update_slo(tenant(), slo.id, &spec(), None).await.unwrap();
    assert!(
        s.get_slo_status(&tenant(), slo.id).await.unwrap().is_some(),
        "a non-objective edit must not clear the snapshot"
    );

    // An objective edit drops the snapshot because it describes the old objective.
    let mut spec2 = spec();
    spec2.target_percent = 99.5;
    s.update_slo(tenant(), slo.id, &spec2, None).await.unwrap();
    assert!(
        s.get_slo_status(&tenant(), slo.id).await.unwrap().is_none(),
        "an objective change must clear the snapshot"
    );
}

#[tokio::test]
async fn objective_change_clears_the_instance_rows() {
    use cc::domain::ids::{InstanceKey, RuleId, SourceId};
    use cc::domain::instance::{InstanceState, Status};

    let s = store().await;
    let slo = create_test_slo(&s, tenant(), "inst", &spec()).await;

    // Seed a firing tier instance as the evaluator would.
    let rule = RuleId(slo.id.0);
    let labels = BTreeMap::from([("slo_tier".to_string(), "fast-burn".to_string())]);
    let mut inst = InstanceState::new_inactive(
        InstanceKey::new(rule, &labels),
        SourceId::Slo(slo.id),
        tenant(),
        labels,
    );
    inst.status = Status::Firing;
    inst.value = Some(1.0);
    inst.active_since = Some(time::OffsetDateTime::now_utc());
    inst.last_seen = Some(time::OffsetDateTime::now_utc());
    s.persist_slo_eval_batch(std::slice::from_ref(&inst), &[])
        .await
        .unwrap();
    assert_eq!(
        s.load_slo_instances(&tenant(), slo.id).await.unwrap().len(),
        1
    );

    // A non-objective edit (identical spec) keeps the instance rows: their keys still
    // hash the same label set, so future evaluations keep updating them.
    s.update_slo(tenant(), slo.id, &spec(), None).await.unwrap();
    assert_eq!(
        s.load_slo_instances(&tenant(), slo.id).await.unwrap().len(),
        1,
        "a non-objective edit must not clear the instance rows"
    );

    // An objective edit drops instance rows because their prior state no longer
    // describes the redefined objective.
    let mut spec2 = spec();
    spec2.sli.sql.push_str(" AND true");
    s.update_slo(tenant(), slo.id, &spec2, None).await.unwrap();
    assert!(
        s.load_slo_instances(&tenant(), slo.id)
            .await
            .unwrap()
            .is_empty(),
        "an objective change must clear the instance rows"
    );
}

#[tokio::test]
async fn duplicate_name_conflicts() {
    let s = store().await;
    s.create_slo(tenant(), "", "dup", &spec()).await.unwrap();
    let again = s.create_slo(tenant(), "", "dup", &spec()).await.unwrap();
    assert!(matches!(again, SloCreate::NameConflict));
}

#[tokio::test]
async fn update_bumps_version_and_honors_optimistic_lock() {
    let s = store().await;
    let slo = create_test_slo(&s, tenant(), "u", &spec()).await;

    let mut spec2 = spec();
    spec2.target_percent = 99.5;

    // stale expected_version -> conflict
    let conflict = s
        .update_slo(tenant(), slo.id, &spec2, Some(999))
        .await
        .unwrap();
    assert!(matches!(
        conflict,
        SloUpdate::VersionConflict { current: 1 }
    ));

    // correct version -> updated, version bumped
    let ok = s
        .update_slo(tenant(), slo.id, &spec2, Some(1))
        .await
        .unwrap();
    match ok {
        SloUpdate::Updated(u) => {
            assert_eq!(u.version, 2);
            assert_eq!(u.spec.target_percent, 99.5);
        }
        other => panic!("expected Updated, got {other:?}"),
    }

    // unknown id -> NotFound
    let missing = s
        .update_slo(tenant(), SloId(uuid::Uuid::new_v4()), &spec2, None)
        .await
        .unwrap();
    assert!(matches!(missing, SloUpdate::NotFound));
}

#[tokio::test]
async fn pause_resume_and_delete() {
    let s = store().await;
    let slo = create_test_slo(&s, tenant(), "pd", &spec()).await;

    assert!(s.pause_slo(tenant(), slo.id).await.unwrap());
    assert!(s.get_slo(tenant(), slo.id).await.unwrap().unwrap().0.paused);
    assert!(s.resume_slo(tenant(), slo.id).await.unwrap());
    assert!(!s.get_slo(tenant(), slo.id).await.unwrap().unwrap().0.paused);

    // pause does not bump version
    assert_eq!(
        s.get_slo(tenant(), slo.id)
            .await
            .unwrap()
            .unwrap()
            .0
            .version,
        1
    );

    assert!(s.delete_slo(tenant(), slo.id).await.unwrap());
    assert!(s.get_slo(tenant(), slo.id).await.unwrap().is_none());
    assert!(!s.delete_slo(tenant(), slo.id).await.unwrap()); // second delete = false
}

#[tokio::test]
async fn list_is_tenant_scoped() {
    let s = store().await;
    s.create_slo(tenant(), "", "a", &spec()).await.unwrap();
    s.create_slo(tenant(), "", "b", &spec()).await.unwrap();
    s.create_slo(TenantId::from_trusted("other"), "", "c", &spec())
        .await
        .unwrap();

    let mine = s.list_slos(&tenant(), None, None).await.unwrap();
    assert_eq!(mine.len(), 2);
    assert!(mine.iter().all(|(slo, _, _)| slo.tenant == tenant()));
}

#[tokio::test]
async fn slo_identity_scoped_by_namespace() {
    let s = store().await;
    let t = tenant();
    let live = s
        .create_slo(t.clone(), "", "default/checkout", &spec())
        .await
        .unwrap();
    assert!(matches!(live, SloCreate::Created(_)));
    // Same name, preview namespace: no conflict (this replaces the old
    // ".pv-" name-suffix workaround).
    let preview = s
        .create_slo(t.clone(), "pv-123", "default/checkout", &spec())
        .await
        .unwrap();
    assert!(matches!(preview, SloCreate::Created(_)));
    // Duplicate within the live namespace: conflict.
    let dup = s
        .create_slo(t.clone(), "", "default/checkout", &spec())
        .await
        .unwrap();
    assert!(matches!(dup, SloCreate::NameConflict));
    // Listing filtered to the live namespace sees exactly the live row.
    let rows = s.list_slos(&t, Some(""), None).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0.namespace, "");
}
