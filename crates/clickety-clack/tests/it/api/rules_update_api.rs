use axum::body::Body;
use axum::http::{Request, StatusCode};
use cc::api::auth::HeaderAuth;
use cc::api::{build_router, AppState};
use cc::clickhouse::ChClient;
use cc::crypto::EnvKeyring;
use cc::domain::ids::{InstanceKey, RuleId, TenantId};
use cc::domain::instance::{InstanceState, Status};
use cc::domain::Event;
use cc::stores::PgStore;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

async fn setup() -> (axum::Router, PgStore) {
    let pg_url = crate::support::fresh_db().await;
    let store = PgStore::connect(&pg_url).await.unwrap();
    let (events_tx, _rx) = tokio::sync::broadcast::channel::<Event>(16);
    let state = AppState {
        store: store.clone(),
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
        events_tx,
        allow_private_webhooks: false,
    };
    (build_router(state), store)
}

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn create_rule(app: &axum::Router, tenant: Uuid) -> String {
    let create = Request::builder()
        .method("POST")
        .uri("/v1/rules")
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(
            r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}"#,
        ))
        .unwrap();
    let resp = app.clone().oneshot(create).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    body_json(resp).await["id"].as_str().unwrap().to_string()
}

fn put(tenant: Uuid, id: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method("PUT")
        .uri(format!("/v1/rules/{id}"))
        .header("content-type", "application/json")
        .header("X-CC-Tenant", tenant.to_string())
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn seed_firing_instance(rule: &str, tenant: Uuid) -> InstanceState {
    InstanceState {
        key: InstanceKey("k1".into()),
        rule: RuleId(Uuid::parse_str(rule).unwrap()),
        tenant: TenantId::from_trusted(tenant.to_string()),
        status: Status::Firing,
        labels: BTreeMap::from([("host".to_string(), "web-1".to_string())]),
        value: Some(1.0),
        active_since: Some(time::OffsetDateTime::now_utc()),
        last_seen: Some(time::OffsetDateTime::now_utc()),
        absent_count: 0,
    }
}

#[tokio::test]
async fn put_updates_spec_in_place_and_preserves_instances() {
    let (app, store) = setup().await;
    let tenant = Uuid::new_v4();
    let id = create_rule(&app, tenant).await;
    store
        .upsert_instance(&seed_firing_instance(&id, tenant))
        .await
        .unwrap();

    // Same label_columns, new SQL + severity, no version guard (last-write-wins).
    let resp = app
        .clone()
        .oneshot(put(
            tenant,
            &id,
            r#"{"sql":"SELECT host FROM t WHERE errors > 200","interval_secs":60,"for_secs":0,"label_columns":["host"],"severity":"critical"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(resp).await;
    assert_eq!(v["id"], id, "rule id preserved");
    assert_eq!(v["version"], 2, "version bumped");
    assert_eq!(v["paused"], false);
    assert_eq!(v["spec"]["sql"], "SELECT host FROM t WHERE errors > 200");
    assert_eq!(v["spec"]["severity"], "critical");

    let instances = store
        .load_instances(
            &TenantId::from_trusted(tenant.to_string()),
            RuleId(Uuid::parse_str(&id).unwrap()),
        )
        .await
        .unwrap();
    assert_eq!(instances.len(), 1, "instance state preserved");
    assert_eq!(instances[0].status, Status::Firing);
}

#[tokio::test]
async fn put_version_conflict_is_409_problem_details() {
    let (app, _store) = setup().await;
    let tenant = Uuid::new_v4();
    let id = create_rule(&app, tenant).await;

    let stale = r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning","version":7}"#;
    let resp = app.clone().oneshot(put(tenant, &id, stale)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    let v = body_json(resp).await;
    assert_eq!(v["code"], "conflict");
    assert_eq!(v["status"], 409);

    // The matching version succeeds and bumps.
    let ok = r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning","version":1}"#;
    let resp = app.clone().oneshot(put(tenant, &id, ok)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(body_json(resp).await["version"], 2);
}

#[tokio::test]
async fn put_label_columns_change_clears_instances() {
    let (app, store) = setup().await;
    let tenant = Uuid::new_v4();
    let id = create_rule(&app, tenant).await;
    store
        .upsert_instance(&seed_firing_instance(&id, tenant))
        .await
        .unwrap();

    let resp = app
        .clone()
        .oneshot(put(
            tenant,
            &id,
            r#"{"sql":"SELECT host, region FROM t","interval_secs":30,"for_secs":0,"label_columns":["host","region"],"severity":"warning"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let instances = store
        .load_instances(
            &TenantId::from_trusted(tenant.to_string()),
            RuleId(Uuid::parse_str(&id).unwrap()),
        )
        .await
        .unwrap();
    assert!(
        instances.is_empty(),
        "old instance identities cleared on label_columns change"
    );
}

#[tokio::test]
async fn put_reuses_create_validation_and_scoping() {
    let (app, _store) = setup().await;
    let tenant = Uuid::new_v4();
    let id = create_rule(&app, tenant).await;

    // Non-SELECT SQL: 422 via sqlguard, exactly like create.
    let resp = app
        .clone()
        .oneshot(put(
            tenant,
            &id,
            r#"{"sql":"DELETE FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // Reserved label prefix: 422.
    let resp = app
        .clone()
        .oneshot(put(
            tenant,
            &id,
            r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["__cc_x"],"severity":"warning"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // Unknown id: 404. Other tenant's rule: 404.
    let body = r#"{"sql":"SELECT host FROM t","interval_secs":30,"for_secs":0,"label_columns":["host"],"severity":"warning"}"#;
    let resp = app
        .clone()
        .oneshot(put(tenant, &Uuid::new_v4().to_string(), body))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let resp = app
        .clone()
        .oneshot(put(Uuid::new_v4(), &id, body))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
