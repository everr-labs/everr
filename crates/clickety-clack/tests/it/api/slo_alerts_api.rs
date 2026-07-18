//! `GET /v1/alerts` unions rule-side `instances` with SLO-side (burn-rate)
//! `slo_instances`: an SLO's firing burn-rate instance must appear alongside a
//! rule's firing instance, with the SLO row carrying the `slo_tier` label.

use crate::api::slos_api_support::{body_json, setup, TENANT};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc::domain::ids::{InstanceKey, RuleId, SloId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use serde_json::json;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn union_includes_rule_and_slo_alerts() {
    let (router, store) = setup().await;
    let tenant = TenantId::from_trusted(TENANT);

    // Rule-side: create a rule via the API, then seed a firing instance directly.
    let create_rule = router
        .clone()
        .oneshot(
            Request::post("/v1/rules")
                .header("X-CC-Tenant", TENANT)
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_rule.status(), StatusCode::OK);
    let rule_id_str = body_json(create_rule).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let rule_id = RuleId(Uuid::parse_str(&rule_id_str).unwrap());

    let rule_labels = std::collections::BTreeMap::from([("host".to_string(), "web-1".to_string())]);
    let key = InstanceKey::new(rule_id, &rule_labels);
    let mut rule_inst = InstanceState::new_inactive(key, rule_id, tenant.clone(), rule_labels);
    rule_inst.status = Status::Firing;
    rule_inst.value = Some(1.0);
    rule_inst.active_since = Some(time::OffsetDateTime::now_utc());
    rule_inst.last_seen = Some(time::OffsetDateTime::now_utc());
    store.upsert_instance(&rule_inst).await.unwrap();

    // SLO-side: create an SLO via the API, then persist a firing `slo_instances` row
    // directly (bypassing the firing pipeline, mirroring the store-level test fixtures).
    let create_slo = router
        .clone()
        .oneshot(
            Request::post("/v1/slos")
                .header("X-CC-Tenant", TENANT)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "checkout",
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
    assert_eq!(create_slo.status(), StatusCode::OK);
    let slo_id_str = body_json(create_slo).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    let slo_id = SloId(Uuid::parse_str(&slo_id_str).unwrap());
    let slo_rule = RuleId(slo_id.0); // slo_instances type-pun: rule column carries the SLO uuid

    let slo_labels = std::collections::BTreeMap::from([
        ("slo_tier".to_string(), "fast-burn".to_string()),
        ("svc".to_string(), "checkout".to_string()),
    ]);
    let slo_key = InstanceKey::new(slo_rule, &slo_labels);
    let mut slo_inst =
        InstanceState::new_inactive(slo_key, slo_rule, tenant.clone(), slo_labels.clone());
    slo_inst.status = Status::Firing;
    slo_inst.value = Some(20.0);
    slo_inst.active_since = Some(time::OffsetDateTime::now_utc());
    slo_inst.last_seen = Some(time::OffsetDateTime::now_utc());
    store
        .persist_slo_eval_batch(&[slo_inst.clone()], &[])
        .await
        .unwrap();

    let r = router
        .oneshot(
            Request::get("/v1/alerts")
                .header("X-CC-Tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let body = body_json(r).await;
    let alerts = body.as_array().unwrap();
    assert_eq!(alerts.len(), 2, "{alerts:?}");

    let rule_alert = alerts
        .iter()
        .find(|a| a["rule"] == rule_id_str)
        .expect("rule-side alert present");
    assert_eq!(rule_alert["status"], "firing");

    let slo_alert = alerts
        .iter()
        .find(|a| a["rule"] == slo_id_str)
        .expect("slo-side alert present, keyed by the slo uuid in `rule`");
    assert_eq!(slo_alert["status"], "firing");
    assert_eq!(slo_alert["labels"]["slo_tier"], "fast-burn");
}
