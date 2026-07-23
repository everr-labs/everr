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
            label_columns: vec!["service".into()],
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
    let created = match s.create_slo(tenant(), "checkout", &spec()).await.unwrap() {
        SloCreate::Created(slo) => slo,
        SloCreate::NameConflict => panic!("unexpected name conflict"),
    };
    assert_eq!(created.version, 1);
    assert!(!created.paused);
    assert_eq!(created.name, "checkout");

    let (got, updated_at, budget_epoch) =
        s.get_slo(tenant(), created.id).await.unwrap().unwrap();
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
    let SloCreate::Created(slo) = s.create_slo(tenant(), "e", &spec()).await.unwrap() else {
        panic!()
    };
    let (_, _, epoch0) = s.get_slo(tenant(), slo.id).await.unwrap().unwrap();

    // A pure rename leaves the spec untouched: the budget epoch must NOT move.
    s.update_slo(tenant(), slo.id, "e2", &spec(), None)
        .await
        .unwrap();
    let (_, _, epoch1) = s.get_slo(tenant(), slo.id).await.unwrap().unwrap();
    assert_eq!(epoch1, epoch0, "rename must not advance the budget epoch");

    // A target change redefines the budget: the epoch MUST advance.
    let mut spec2 = spec();
    spec2.target_percent = 99.5;
    s.update_slo(tenant(), slo.id, "e2", &spec2, None)
        .await
        .unwrap();
    let (_, _, epoch2) = s.get_slo(tenant(), slo.id).await.unwrap().unwrap();
    assert!(epoch2 > epoch1, "a target change must advance the budget epoch");
}

#[tokio::test]
async fn objective_change_clears_the_status_snapshot() {
    let s = store().await;
    let SloCreate::Created(slo) = s.create_slo(tenant(), "snap", &spec()).await.unwrap() else {
        panic!()
    };

    // Seed a status snapshot as the evaluator would.
    let seed_payload = serde_json::json!({
        "window": "30d", "target_percent": 99.9, "groups": [],
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

    // A non-objective edit (rename) keeps the snapshot: its numbers still describe
    // the same query, so aging it out would waste a full recompute.
    s.update_slo(tenant(), slo.id, "snap2", &spec(), None)
        .await
        .unwrap();
    assert!(
        s.get_slo_status(&tenant(), slo.id).await.unwrap().is_some(),
        "a rename must not clear the snapshot"
    );

    // An objective edit (target change) drops the snapshot: its groups/burn/budget
    // were computed for the old objective and must not be carried forward.
    let mut spec2 = spec();
    spec2.target_percent = 99.5;
    s.update_slo(tenant(), slo.id, "snap2", &spec2, None)
        .await
        .unwrap();
    assert!(
        s.get_slo_status(&tenant(), slo.id).await.unwrap().is_none(),
        "an objective change must clear the snapshot"
    );
}

#[tokio::test]
async fn duplicate_name_conflicts() {
    let s = store().await;
    s.create_slo(tenant(), "dup", &spec()).await.unwrap();
    let again = s.create_slo(tenant(), "dup", &spec()).await.unwrap();
    assert!(matches!(again, SloCreate::NameConflict));
}

#[tokio::test]
async fn update_bumps_version_and_honors_optimistic_lock() {
    let s = store().await;
    let SloCreate::Created(slo) = s.create_slo(tenant(), "u", &spec()).await.unwrap() else {
        panic!()
    };

    let mut spec2 = spec();
    spec2.target_percent = 99.5;

    // stale expected_version -> conflict
    let conflict = s
        .update_slo(tenant(), slo.id, "u", &spec2, Some(999))
        .await
        .unwrap();
    assert!(matches!(
        conflict,
        SloUpdate::VersionConflict { current: 1 }
    ));

    // correct version -> updated, version bumped
    let ok = s
        .update_slo(tenant(), slo.id, "u", &spec2, Some(1))
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
        .update_slo(tenant(), SloId(uuid::Uuid::new_v4()), "u", &spec2, None)
        .await
        .unwrap();
    assert!(matches!(missing, SloUpdate::NotFound));
}

#[tokio::test]
async fn pause_resume_and_delete() {
    let s = store().await;
    let SloCreate::Created(slo) = s.create_slo(tenant(), "pd", &spec()).await.unwrap() else {
        panic!()
    };

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
    s.create_slo(tenant(), "a", &spec()).await.unwrap();
    s.create_slo(tenant(), "b", &spec()).await.unwrap();
    s.create_slo(TenantId::from_trusted("other"), "c", &spec())
        .await
        .unwrap();

    let mine = s.list_slos(&tenant()).await.unwrap();
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
