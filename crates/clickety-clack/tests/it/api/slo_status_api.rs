//! `GET /v1/slos/:id/status`: pending (null `computed_at`/`payload`) before
//! any snapshot exists, then a read-only view of the evaluator's `slo_status`
//! row once seeded, enriched at read time with time-to-exhaustion +
//! live firing-tier state (spec §8.2) -- the stored row itself is never
//! touched. 404 is keyed on the SLO's existence, not the snapshot's.

use crate::api::support::{body_json, setup, TENANT};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc::domain::ids::{InstanceKey, RuleId};
use cc::domain::instance::{InstanceState, Status};
use serde_json::json;
use tower::ServiceExt;

#[tokio::test]
async fn status_pending_then_returns_snapshot() {
    let (router, store) = setup().await;

    // create via API to get an id
    let created = router
        .clone()
        .oneshot(
            Request::post("/v1/slos")
                .header("X-CC-Tenant", TENANT)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "s",
                        "sli": {"sql": "SELECT 1 AS good,1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}"},
                        "targetPercent": 99.9,
                        "timeWindow": {"duration": "30d"}
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let id = body_json(created).await["id"].as_str().unwrap().to_string();

    // Pending before any snapshot: the SLO exists, so this is 200 with null
    // computed_at/payload (and real health), not a 404.
    let r = router
        .clone()
        .oneshot(
            Request::get(format!("/v1/slos/{id}/status"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let b = body_json(r).await;
    assert!(b["computed_at"].is_null());
    assert!(b["payload"].is_null());
    assert_eq!(b["health"]["status"], "healthy");

    // A status read for an SLO that does not exist at all is still a 404.
    let r = router
        .clone()
        .oneshot(
            Request::get("/v1/slos/00000000-0000-0000-0000-000000000000/status")
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NOT_FOUND);

    // seed a snapshot directly, then GET
    use cc::domain::ids::{SloId, TenantId};
    store
        .upsert_slo_status(
            SloId(id.parse().unwrap()),
            &TenantId::from_trusted(TENANT),
            &json!({
                "window": "30d",
                "target_percent": 99.9,
                "sli": null,
                "budget_remaining": null,
                "tiers": [],
                "window_computed_at": {}
            }),
            time::OffsetDateTime::now_utc(),
        )
        .await
        .unwrap();
    let r = router
        .clone()
        .oneshot(
            Request::get(format!("/v1/slos/{id}/status"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let b = body_json(r).await;
    assert_eq!(b["payload"]["window"], "30d");
    assert!(b["computed_at"].as_str().is_some());
    assert_eq!(b["health"]["status"], "healthy");
    assert!(b["health"]["degraded_since"].is_null());
    assert!(b["health"]["last_error"].is_null());

    // Degrade the SLO (threshold 1) and confirm the sibling `health` object reflects it.
    store
        .record_slo_failure(
            cc::domain::ids::SloId(id.parse().unwrap()),
            &cc::domain::ids::TenantId::from_trusted(TENANT),
            "boom",
            1,
            time::OffsetDateTime::now_utc(),
            None,
        )
        .await
        .unwrap();
    let r = router
        .oneshot(
            Request::get(format!("/v1/slos/{id}/status"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let b = body_json(r).await;
    assert_eq!(b["health"]["status"], "degraded");
    assert_eq!(b["health"]["last_error"], "boom");
    assert!(b["health"]["degraded_since"].as_str().is_some());
}

async fn create_slo(router: &axum::Router, name: &str) -> String {
    let created = router
        .clone()
        .oneshot(
            Request::post("/v1/slos")
                .header("X-CC-Tenant", TENANT)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": name,
                        "sli": {"sql": "SELECT 1 AS good,1 AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}"},
                        "targetPercent": 99.9,
                        "timeWindow": {"duration": "30d"}
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    body_json(created).await["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn status_enriches_time_to_exhaustion_and_firing_tiers() {
    let (router, store) = setup().await;
    let id = create_slo(&router, "a").await;
    let slo_id = cc::domain::ids::SloId(id.parse().unwrap());
    let tenant = cc::domain::ids::TenantId::from_trusted(TENANT);

    store
        .upsert_slo_status(
            slo_id,
            &tenant,
            &json!({
                "window": "30d",
                "target_percent": 99.9,
                "sli": 0.998,
                "budget_remaining": 0.5,
                "tiers": [{
                    "name": "fast-burn",
                    "long_burn_rate": 2.0,
                    "short_burn_rate": 3.0,
                    "long_window_valid": 1000.0
                }],
                "window_computed_at": {}
            }),
            time::OffsetDateTime::now_utc(),
        )
        .await
        .unwrap();

    // A firing instance for the fast-burn tier.
    let rule = RuleId(slo_id.0);
    let mut inst_labels = std::collections::BTreeMap::new();
    inst_labels.insert("slo_tier".to_string(), "fast-burn".to_string());
    let mut inst = InstanceState::new_inactive(
        InstanceKey::new(rule, &inst_labels),
        cc::domain::ids::SourceId::Slo(slo_id),
        tenant.clone(),
        inst_labels,
    );
    inst.status = Status::Firing;
    inst.value = Some(2.0);
    inst.active_since = Some(time::OffsetDateTime::now_utc());
    inst.last_seen = Some(time::OffsetDateTime::now_utc());
    store.persist_slo_eval_batch(&[inst], &[]).await.unwrap();

    let r = router
        .oneshot(
            Request::get(format!("/v1/slos/{id}/status"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let b = body_json(r).await;
    let payload = &b["payload"];
    assert_eq!(
        payload["time_to_exhaustion_secs"],
        json!((2_592_000.0 * 0.5 / 2.0) as u64)
    );
    assert_eq!(
        payload["firing_tiers"],
        json!([{"tier": "fast-burn", "status": "firing"}])
    );
}

#[tokio::test]
async fn status_enrichment_without_burn_has_no_instances_and_null_tte() {
    let (router, store) = setup().await;
    let id = create_slo(&router, "b").await;
    let slo_id = cc::domain::ids::SloId(id.parse().unwrap());
    let tenant = cc::domain::ids::TenantId::from_trusted(TENANT);

    // No burn rate means no exhaustion horizon. No instances means no firing tiers.
    store
        .upsert_slo_status(
            slo_id,
            &tenant,
            &json!({
                "window": "30d",
                "target_percent": 99.9,
                "sli": null,
                "budget_remaining": 0.5,
                "tiers": [{
                    "name": "fast-burn",
                    "long_burn_rate": null,
                    "short_burn_rate": null,
                    "long_window_valid": null
                }],
                "window_computed_at": {}
            }),
            time::OffsetDateTime::now_utc(),
        )
        .await
        .unwrap();

    let r = router
        .oneshot(
            Request::get(format!("/v1/slos/{id}/status"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let b = body_json(r).await;
    let payload = &b["payload"];
    assert!(payload["time_to_exhaustion_secs"].is_null());
    assert_eq!(payload["firing_tiers"], json!([]));
}

#[tokio::test]
async fn status_enrichment_passed_spike_has_null_tte() {
    let (router, store) = setup().await;
    let id = create_slo(&router, "c").await;
    let slo_id = cc::domain::ids::SloId(id.parse().unwrap());
    let tenant = cc::domain::ids::TenantId::from_trusted(TENANT);

    // The long window still remembers a spike (3x) but the short window has
    // recovered to 0: the effective burn is min(long, short) = 0, so the budget
    // is not being spent and there is no exhaustion to project.
    store
        .upsert_slo_status(
            slo_id,
            &tenant,
            &json!({
                "window": "30d",
                "target_percent": 99.9,
                "sli": 0.99,
                "budget_remaining": 0.5,
                "tiers": [{
                    "name": "fast-burn",
                    "long_burn_rate": 3.0,
                    "short_burn_rate": 0.0,
                    "long_window_valid": 1000.0
                }],
                "window_computed_at": {}
            }),
            time::OffsetDateTime::now_utc(),
        )
        .await
        .unwrap();

    let r = router
        .oneshot(
            Request::get(format!("/v1/slos/{id}/status"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let b = body_json(r).await;
    assert!(b["payload"]["time_to_exhaustion_secs"].is_null());
}

#[tokio::test]
async fn status_enrichment_gives_no_horizon_when_recent_burn_stopped_even_if_a_slow_tier_fires() {
    let (router, store) = setup().await;
    let id = create_slo(&router, "d").await;
    let slo_id = cc::domain::ids::SloId(id.parse().unwrap());
    let tenant = cc::domain::ids::TenantId::from_trusted(TENANT);

    // The payments-success-rate shape: a burst 1-6h ago still sits inside the slow
    // `ticket` tier's windows (both > 1x, so it fires), but the fastest tier's short
    // window is back to 0 — nothing has been spent recently. Current spend is the
    // fastest tier's min(long, short) = min(4.0, 0.0) = 0, so the budget is not
    // draining and there is NO horizon, even though `ticket` is firing. Projecting
    // the ticket's lagging 3d/6h rate would fabricate an exhaustion time for a
    // budget that is actually recovering.
    store
        .upsert_slo_status(
            slo_id,
            &tenant,
            &json!({
                "window": "30d",
                "target_percent": 99.9,
                "sli": 0.98,
                "budget_remaining": 0.3,
                "tiers": [
                    {
                        "name": "fast-burn",
                        "long_burn_rate": 4.0,
                        "short_burn_rate": 0.0,
                        "long_window_valid": 1000.0
                    },
                    {
                        "name": "ticket",
                        "long_burn_rate": 2.0,
                        "short_burn_rate": 1.5,
                        "long_window_valid": 1000.0
                    }
                ],
                "window_computed_at": {}
            }),
            time::OffsetDateTime::now_utc(),
        )
        .await
        .unwrap();

    // A firing instance for the ticket tier only (fast-burn has recovered).
    let rule = RuleId(slo_id.0);
    let mut inst_labels = std::collections::BTreeMap::new();
    inst_labels.insert("slo_tier".to_string(), "ticket".to_string());
    let mut inst = InstanceState::new_inactive(
        InstanceKey::new(rule, &inst_labels),
        cc::domain::ids::SourceId::Slo(slo_id),
        tenant.clone(),
        inst_labels,
    );
    inst.status = Status::Firing;
    inst.active_since = Some(time::OffsetDateTime::now_utc());
    inst.last_seen = Some(time::OffsetDateTime::now_utc());
    store.persist_slo_eval_batch(&[inst], &[]).await.unwrap();

    let r = router
        .oneshot(
            Request::get(format!("/v1/slos/{id}/status"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let b = body_json(r).await;
    let payload = &b["payload"];
    // Fastest tier's current spend is min(4.0, 0.0) = 0 -> no horizon, even though
    // the slow ticket tier is still firing on the passed burst.
    assert!(payload["time_to_exhaustion_secs"].is_null());
    assert_eq!(
        payload["firing_tiers"],
        json!([{"tier": "ticket", "status": "firing"}])
    );
}

#[tokio::test]
async fn status_enrichment_projects_from_the_fastest_tier_that_has_a_computed_burn() {
    let (router, store) = setup().await;
    let id = create_slo(&router, "d").await;
    let slo_id = cc::domain::ids::SloId(id.parse().unwrap());
    let tenant = cc::domain::ids::TenantId::from_trusted(TENANT);

    // Low traffic: the fastest tier saw no events in either window (both rates
    // null), so the horizon falls through to the next tier that does have a
    // computed burn (slow-burn) and projects from its min(long, short).
    store
        .upsert_slo_status(
            slo_id,
            &tenant,
            &json!({
                "window": "30d",
                "target_percent": 99.9,
                "sli": 0.99,
                "budget_remaining": 0.3,
                "tiers": [
                    {
                        "name": "fast-burn",
                        "long_burn_rate": null,
                        "short_burn_rate": null,
                        "long_window_valid": null
                    },
                    {
                        "name": "slow-burn",
                        "long_burn_rate": 2.0,
                        "short_burn_rate": 1.5,
                        "long_window_valid": 1000.0
                    },
                    {
                        "name": "ticket",
                        "long_burn_rate": 1.8,
                        "short_burn_rate": 1.8,
                        "long_window_valid": 1000.0
                    }
                ],
                "window_computed_at": {}
            }),
            time::OffsetDateTime::now_utc(),
        )
        .await
        .unwrap();

    let r = router
        .oneshot(
            Request::get(format!("/v1/slos/{id}/status"))
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let b = body_json(r).await;
    let payload = &b["payload"];
    // slow-burn is the fastest tier with a computed burn: 2_592_000 * 0.3 / min(2.0, 1.5).
    assert_eq!(
        payload["time_to_exhaustion_secs"],
        json!((2_592_000.0 * 0.3 / 1.5) as u64)
    );
}
