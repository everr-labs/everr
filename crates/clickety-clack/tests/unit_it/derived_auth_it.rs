use cc::clickhouse::{build_ch_auth, ChClient};
use cc::domain::ids::TenantId;
use std::sync::{Arc, Mutex};

#[derive(Default, Clone)]
struct Captured {
    user: Option<String>,
    key: Option<String>,
    quota: Option<String>,
    settings: Option<String>,
}

/// Start an in-process stub that records the next request's CH auth headers and returns
/// one JSONEachRow row. Returns (base_url, captured-handle).
async fn capturing_stub() -> (String, Arc<Mutex<Captured>>) {
    use axum::http::HeaderMap;
    use axum::routing::post;
    use axum::Router;
    let cap = Arc::new(Mutex::new(Captured::default()));
    let cap2 = cap.clone();
    let app = Router::new().route(
        "/",
        post(move |headers: HeaderMap| {
            let cap = cap2.clone();
            async move {
                let g = |k: &str| {
                    headers
                        .get(k)
                        .and_then(|v| v.to_str().ok())
                        .map(|s| s.to_string())
                };
                *cap.lock().unwrap() = Captured {
                    user: g("x-clickhouse-user"),
                    key: g("x-clickhouse-key"),
                    quota: g("x-clickhouse-quota"),
                    settings: g("x-clickhouse-settings"),
                };
                "{\"u\":\"ok\"}\n".to_string()
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    (format!("http://{addr}/"), cap)
}

#[tokio::test]
async fn derived_mode_sends_per_tenant_credentials_and_suppresses_readonly() {
    let (url, cap) = capturing_stub().await;
    let auth = build_ch_auth(
        "derived",
        "",
        "",
        Some("sql_api_org_{tenant}"),
        Some("masterkey"),
        "A!",
        None,
    )
    .unwrap();
    let ch = ChClient::new(url, auth);

    ch.query_rows(
        &TenantId::from_trusted("ta"),
        "SELECT u",
        &["u".to_string()],
        None,
    )
    .await
    .unwrap();

    let c = cap.lock().unwrap().clone();
    assert_eq!(c.user.as_deref(), Some("sql_api_org_ta"));
    assert_eq!(c.quota.as_deref(), Some("sql_api_org_ta"));
    let expected_pw = cc::clickhouse::derived_password_for_test(b"masterkey", "ta", "A!");
    assert_eq!(c.key.as_deref(), Some(expected_pw.as_str()));
    // server_enforced_limits ⇒ no readonly in the settings header.
    assert!(!c.settings.unwrap_or_default().contains("readonly"));
}

#[tokio::test]
async fn shared_mode_is_unchanged_on_the_wire() {
    let (url, cap) = capturing_stub().await;
    let auth = build_ch_auth("shared", "default", "", None, None, "", None).unwrap();
    let ch = ChClient::new(url, auth);

    ch.query_rows(
        &TenantId::from_trusted("anything"),
        "SELECT u",
        &["u".to_string()],
        None,
    )
    .await
    .unwrap();

    let c = cap.lock().unwrap().clone();
    assert_eq!(c.user.as_deref(), Some("default"));
    assert_eq!(c.quota, None);
    assert!(c.settings.unwrap_or_default().contains("readonly=1"));
}
