use std::{collections::HashMap, sync::Arc, time::Duration};

use super::local_auth::LocalAuth;
use crate::{build, device_auth::build_auth_http_client};
use anyhow::{Context, Result, anyhow, bail};
#[cfg(everr_embedded_local_ui)]
use axum::body::Body;
use axum::{
    Json, Router,
    extract::{Path, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::{
    net::TcpListener,
    sync::{mpsc, oneshot},
};

#[cfg(everr_embedded_local_ui)]
static UI: include_dir::Dir<'_> = include_dir::include_dir!("$EVERR_LOCAL_UI_DIR");

type RestartRequest = oneshot::Sender<std::result::Result<(), String>>;

#[derive(Clone)]
struct ServerState {
    origin: String,
    identity: super::local_instance::Identity,
    auth: Arc<LocalAuth>,
    restart: mpsc::Sender<RestartRequest>,
    http: reqwest::Client,
}

#[derive(Deserialize)]
struct SqlQuery {
    sql: String,
    #[serde(default)]
    params: HashMap<String, Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum CollectorState {
    Running,
    Stopped,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CollectorStatus {
    status: CollectorState,
    otlp_endpoint: String,
    sql_endpoint: String,
    health_endpoint: String,
    telemetry_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetryContext {
    service_version: &'static str,
}

#[derive(Serialize)]
struct CommandError {
    error: String,
}

pub struct LocalServer {
    listener: TcpListener,
    state: ServerState,
}

impl LocalServer {
    pub async fn bind(
        _restart: mpsc::Sender<RestartRequest>,
        _instance_id: String,
    ) -> Result<Self> {
        #[cfg(not(everr_embedded_local_ui))]
        bail!(
            "local UI assets are missing; build the CLI with `pnpm --filter @everr/cli build:debug`"
        );
        #[cfg(everr_embedded_local_ui)]
        {
            let address = super::local_instance::listen_address(&build::local_ui_origin())?;
            let listener = TcpListener::bind(address)
                .await
                .with_context(|| format!("cannot start Everr: local UI address {address} is unavailable; another instance may be starting"))?;
            Ok(Self {
                listener,
                state: ServerState {
                    origin: build::local_ui_origin(),
                    identity: super::local_instance::Identity::ui(_instance_id),
                    auth: Arc::new(LocalAuth::new(
                        crate::auth::state_store(),
                        crate::auth::resolve_auth_config()?,
                        build_auth_http_client()?,
                    )),
                    restart: _restart,
                    http: reqwest::Client::builder()
                        .timeout(Duration::from_secs(15))
                        .build()?,
                },
            })
        }
    }

    pub async fn serve(self) -> Result<()> {
        axum::serve(self.listener, router(self.state))
            .await
            .context("serve local UI")
    }
}

fn router(state: ServerState) -> Router {
    Router::new()
        .route(
            "/health",
            get(|State(state): State<ServerState>| async move { Json(state.identity) }),
        )
        .route("/api/commands/{command}", post(command))
        .route("/api/telemetry/{signal}", post(export_telemetry))
        .route("/api/{*path}", get(|| async { StatusCode::NOT_FOUND }))
        .fallback(get(asset))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            protect_local_server,
        ))
        .with_state(state)
}

async fn protect_local_server(
    State(state): State<ServerState>,
    request: Request,
    next: Next,
) -> Response {
    let expected_host = state.origin.trim_start_matches("http://");
    if request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        != Some(expected_host)
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    if request.uri().path().starts_with("/api/") {
        let origin = request
            .headers()
            .get(header::ORIGIN)
            .and_then(|v| v.to_str().ok());
        let valid_origin = origin == Some(state.origin.as_str())
            || (cfg!(debug_assertions) && origin == Some("http://127.0.0.1:1420"));
        if !valid_origin
            || request
                .headers()
                .get("x-everr-local")
                .and_then(|v| v.to_str().ok())
                != Some("1")
        {
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    response
        .headers_mut()
        .insert("x-frame-options", "DENY".parse().unwrap());
    response
}

async fn asset(_request: Request) -> Response {
    #[cfg(everr_embedded_local_ui)]
    {
        let path = _request.uri().path().trim_start_matches('/');
        if path.split('/').any(|segment| segment == "..") {
            return StatusCode::NOT_FOUND.into_response();
        }
        let file = UI.get_file(path).or_else(|| {
            if path.is_empty() || !path.rsplit('/').next().unwrap_or_default().contains('.') {
                UI.get_file("index.html")
            } else {
                None
            }
        });
        if let Some(file) = file {
            let mime = mime_guess::from_path(file.path()).first_or_octet_stream();
            return (
                [(header::CONTENT_TYPE, mime.as_ref())],
                Body::from(file.contents()),
            )
                .into_response();
        }
    }
    StatusCode::NOT_FOUND.into_response()
}

async fn command(
    State(state): State<ServerState>,
    Path(command): Path<String>,
    Json(args): Json<Value>,
) -> Response {
    match dispatch(&state, &command, args).await {
        Ok(response) => response,
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(CommandError {
                error: format!("{error:#}"),
            }),
        )
            .into_response(),
    }
}

async fn export_telemetry(
    State(state): State<ServerState>,
    Path(signal): Path<String>,
    body: String,
) -> Response {
    if !matches!(signal.as_str(), "logs" | "traces" | "metrics") {
        return StatusCode::NOT_FOUND.into_response();
    }
    let result = state
        .http
        .post(format!("{}/v1/{signal}", build::otlp_http_origin()))
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await;
    match result {
        Ok(response) if response.status().is_success() => StatusCode::NO_CONTENT.into_response(),
        _ => StatusCode::BAD_GATEWAY.into_response(),
    }
}

fn json_response(value: impl Serialize) -> Response {
    Json(value).into_response()
}

async fn dispatch(state: &ServerState, command: &str, args: Value) -> Result<Response> {
    Ok(match command {
        "get_auth_status" => json_response(state.auth.status()?),
        "get_pending_sign_in" => json_response(state.auth.pending_sign_in().await),
        "start_sign_in" => json_response(state.auth.start_sign_in().await?),
        "poll_sign_in" => json_response(state.auth.poll_sign_in().await?),
        "open_sign_in_browser" => json_response(state.auth.open_sign_in_browser().await?),
        "sign_out" => json_response(state.auth.sign_out().await?),
        "get_user_profile" => json_response(state.auth.user_profile().await?),
        "get_org" => json_response(state.auth.org().await?),
        "get_collector_status" => json_response(collector_status(state).await?),
        "restart_collector" => {
            let (tx, rx) = oneshot::channel();
            state
                .restart
                .send(tx)
                .await
                .context("collector supervisor stopped")?;
            rx.await
                .context("collector restart interrupted")?
                .map_err(|error| anyhow!(error))?;
            json_response(collector_status(state).await?)
        }
        "telemetry_sql_query" => {
            let SqlQuery { sql, params } =
                serde_json::from_value(args).context("invalid SQL arguments")?;
            let query: Vec<_> = params
                .into_iter()
                .map(|(name, value)| (format!("param_{name}"), value.to_string()))
                .collect();
            let response = state
                .http
                .post(format!("{}/sql", build::sql_http_origin()))
                .header("content-type", "text/plain")
                .query(&query)
                .body(sql)
                .send()
                .await?;
            let status = response.status();
            let body = response.text().await?;
            if !status.is_success() {
                bail!("collector query failed ({status}): {body}");
            }
            json_response(super::client::parse_ndjson(&body)?.values)
        }
        "get_telemetry_context" => json_response(TelemetryContext {
            service_version: env!("EVERR_VERSION"),
        }),
        _ => bail!("unknown local command: {command}"),
    })
}

async fn collector_status(state: &ServerState) -> Result<CollectorStatus> {
    let running = build::healthcheck_endpoint();
    let healthy = crate::collector::wait_for_collector(
        &running,
        &state.identity.instance_id,
        Duration::from_secs(1),
    )
    .await;
    Ok(CollectorStatus {
        status: if healthy {
            CollectorState::Running
        } else {
            CollectorState::Stopped
        },
        otlp_endpoint: build::otlp_http_origin(),
        sql_endpoint: build::sql_http_origin(),
        health_endpoint: running,
        telemetry_dir: build::telemetry_dir()?.display().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    async fn test_server() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let (restart, _) = mpsc::channel(1);
        let auth_dir = tempfile::tempdir().unwrap();
        let state = ServerState {
            origin: origin.clone(),
            identity: crate::telemetry::local_instance::Identity::ui("test-instance".into()),
            auth: Arc::new(LocalAuth::new(
                crate::state::AppStateStore::for_namespace(auth_dir.path().to_string_lossy()),
                crate::device_auth::AuthConfig {
                    api_base_url: "http://example.test".into(),
                },
                reqwest::Client::new(),
            )),
            restart,
            http: reqwest::Client::new(),
        };
        let task = tokio::spawn(async move {
            let _auth_dir = auth_dir;
            axum::serve(listener, router(state)).await.unwrap();
        });
        (origin, task)
    }

    #[tokio::test]
    async fn signed_out_commands_preserve_json_responses() {
        let (origin, task) = test_server().await;
        let client = reqwest::Client::new();
        for (command, expected) in [
            ("get_pending_sign_in", Value::Null),
            ("poll_sign_in", json!({"status":"expired"})),
            ("get_user_profile", Value::Null),
        ] {
            let response = client
                .post(format!("{origin}/api/commands/{command}"))
                .header("origin", &origin)
                .header("x-everr-local", "1")
                .json(&json!({}))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.json::<Value>().await.unwrap(), expected);
        }
        let response = client
            .post(format!("{origin}/api/commands/get_auth_status"))
            .header("origin", &origin)
            .header("x-everr-local", "1")
            .json(&json!({}))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        assert_eq!(response["status"], "signed_out");
        assert!(
            response["session_path"]
                .as_str()
                .unwrap()
                .ends_with("session-dev.json")
        );
        assert_eq!(response.as_object().unwrap().len(), 2);
        task.abort();
    }

    #[tokio::test]
    async fn sql_commands_reject_invalid_arguments_with_json_errors() {
        let (origin, task) = test_server().await;
        let client = reqwest::Client::new();
        for args in [
            json!({}),
            json!({"sql":42}),
            json!({"sql":"SELECT 1", "params":null}),
            json!({"sql":"SELECT 1", "params":[]}),
        ] {
            let response = client
                .post(format!("{origin}/api/commands/telemetry_sql_query"))
                .header("origin", &origin)
                .header("x-everr-local", "1")
                .json(&args)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            let error = response.json::<Value>().await.unwrap();
            assert!(
                error["error"]
                    .as_str()
                    .unwrap()
                    .starts_with("invalid SQL arguments:")
            );
            assert_eq!(error.as_object().unwrap().len(), 1);
        }
        task.abort();
    }

    #[tokio::test]
    async fn health_identifies_ui_without_requiring_browser_headers() {
        let (origin, task) = test_server().await;
        let response = reqwest::get(format!("{origin}/health")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let body = response
            .json::<crate::telemetry::local_instance::Identity>()
            .await
            .unwrap();
        assert_eq!(body.service, "everr-local-ui");
        assert_eq!(body.version, env!("EVERR_VERSION"));
        assert_eq!(body.instance_id, "test-instance");
        assert_eq!(body.status, "ok");
        assert_eq!(body.protocol_version, 1);
        assert!(matches!(
            crate::telemetry::local_instance::probe(&format!("{origin}/health"), "everr-local-ui")
                .await,
            crate::telemetry::local_instance::ServiceState::Running(_)
        ));
        task.abort();
    }

    #[tokio::test]
    async fn local_commands_require_same_origin_and_custom_header() {
        let (origin, task) = test_server().await;
        let client = reqwest::Client::new();
        let url = format!("{origin}/api/commands/get_telemetry_context");
        for (source, header) in [
            ("https://untrusted.example", true),
            (origin.as_str(), false),
            ("null", true),
        ] {
            let mut request = client.post(&url).header("origin", source).json(&json!({}));
            if header {
                request = request.header("x-everr-local", "1");
            }
            assert_eq!(
                request.send().await.unwrap().status(),
                StatusCode::FORBIDDEN
            );
        }
        let response = client
            .post(&url)
            .header("origin", &origin)
            .header("x-everr-local", "1")
            .json(&json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(
            response.json::<Value>().await.unwrap()["serviceVersion"],
            env!("EVERR_VERSION")
        );
        task.abort();
    }

    #[tokio::test]
    async fn rebinding_hosts_and_unknown_api_routes_are_rejected() {
        let (origin, task) = test_server().await;
        let client = reqwest::Client::new();
        assert_eq!(
            client
                .get(&origin)
                .header("host", "untrusted.example")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            client
                .get(format!("{origin}/api/missing"))
                .header("origin", &origin)
                .header("x-everr-local", "1")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        task.abort();
    }

    #[cfg(everr_embedded_local_ui)]
    #[tokio::test]
    async fn direct_browser_routes_serve_shell_and_missing_assets_return_404() {
        let (origin, task) = test_server().await;
        let client = reqwest::Client::new();
        let response = client
            .get(format!("{origin}/traces/0123456789abcdef"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(
            response.headers()[header::CONTENT_TYPE]
                .to_str()
                .unwrap()
                .starts_with("text/html")
        );
        assert!(response.text().await.unwrap().contains("Everr Local"));
        assert_eq!(
            client
                .get(format!("{origin}/assets/missing.js"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        task.abort();
    }
}
