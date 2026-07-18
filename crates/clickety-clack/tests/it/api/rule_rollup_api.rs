use crate::api::support::body_json;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc::api::auth::HeaderAuth;
use cc::api::{build_router, AppState};
use cc::clickhouse::ChClient;
use cc::crypto::EnvKeyring;
use cc::domain::ids::{InstanceKey, RuleId, SourceId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::rollup::{AlertState, RuleRollup};
use cc::stores::PgStore;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use time::OffsetDateTime;
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn rules_list_and_get_expose_rollup() {
    let pg_url = crate::support::fresh_db().await;
    let store = PgStore::connect(&pg_url).await.unwrap();
    let store2 = store.clone();
    let state = AppState {
        store,
        ch: ChClient::new(
            "http://127.0.0.1:1",
            cc::clickhouse::build_ch_auth("shared", "default", "", None, None, "", None).unwrap(),
        ),
        auth: Arc::new(HeaderAuth),
        cipher: Arc::new(
            EnvKeyring::new(
                HashMap::from([("v1".to_string(), [7u8; 32])]),
                "v1".to_string(),
            )
            .unwrap(),
        ),
        allow_private_webhooks: false,
    };
    let app = build_router(state);
    let tenant = Uuid::new_v4();

    let create = Request::builder()
        .method("POST").uri("/v1/rules")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(
            r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}"#,
        )).unwrap();
    let resp = app.clone().oneshot(create).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let id = body_json(resp).await["id"].as_str().unwrap().to_string();
    let rid = RuleId(Uuid::parse_str(&id).unwrap());
    let tid = TenantId::from_trusted(tenant.to_string());

    // Fresh rule rolls up as inactive.
    let get = Request::builder()
        .uri(format!("/v1/rules/{id}"))
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let body = body_json(app.clone().oneshot(get).await.unwrap()).await;
    assert_eq!(body["rollup"]["alert_state"], "inactive");
    assert_eq!(body["rollup"]["firing_instance_count"], 0);

    // Drive a firing rollup straight through the store.
    let labels = BTreeMap::from([("host".to_string(), "a".to_string())]);
    let key = InstanceKey::new(rid, &labels);
    let mut inst = InstanceState::new_inactive(key, SourceId::Rule(rid), tid.clone(), labels);
    inst.status = Status::Firing;
    let now = OffsetDateTime::from_unix_timestamp(1_000).unwrap();
    let rollup = RuleRollup {
        state: AlertState::Firing,
        firing_instance_count: 1,
        fired_at: Some(now),
        resolved_at: None,
        seen_at: Some(now),
        row_count: 1,
    };
    store2
        .persist_eval_batch(
            std::slice::from_ref(&inst),
            &[],
            Some((rid, rollup)),
            None,
            Some(&tid),
        )
        .await
        .unwrap();

    let list = Request::builder()
        .uri("/v1/rules")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::empty())
        .unwrap();
    let body = body_json(app.clone().oneshot(list).await.unwrap()).await;
    assert_eq!(body["items"][0]["rollup"]["alert_state"], "firing");
    assert_eq!(body["items"][0]["rollup"]["firing_instance_count"], 1);
    assert!(body["items"][0]["rollup"]["last_fired_at"].is_string());
}
