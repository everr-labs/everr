use std::{collections::HashMap, sync::Arc, time::Duration};

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
use chrono::{DateTime, Utc};
use crate::{
    api::ApiClient,
    device_auth::{
        DeviceAuthorization, DevicePollStatus, build_auth_http_client, poll_device_authorization,
        session_from_device_token, start_device_authorization,
    },
    build,
    skill_store::{self as skills, SkillOperationOptions, SkillProvider, SkillScope},
};
use serde_json::{Value, json};
use tokio::{
    net::TcpListener,
    sync::{Mutex, mpsc, oneshot},
};

#[cfg(everr_embedded_local_ui)]
static UI: include_dir::Dir<'_> = include_dir::include_dir!("$EVERR_LOCAL_UI_DIR");

type RestartRequest = oneshot::Sender<std::result::Result<(), String>>;

#[derive(Clone)]
struct ServerState {
    origin: String,
    pending_auth: Arc<Mutex<Option<PendingAuth>>>,
    restart: mpsc::Sender<RestartRequest>,
    http: reqwest::Client,
}

struct PendingAuth {
    authorization: DeviceAuthorization,
    expires_at: DateTime<Utc>,
    next_poll_at: std::time::Instant,
}

pub struct LocalServer {
    listener: TcpListener,
    state: ServerState,
}

impl LocalServer {
    pub async fn bind(_restart: mpsc::Sender<RestartRequest>) -> Result<Self> {
        #[cfg(not(everr_embedded_local_ui))]
        bail!(
            "local UI assets are missing; build the CLI with `pnpm --filter @everr/cli build:debug`"
        );
        #[cfg(everr_embedded_local_ui)]
        {
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, build::LOCAL_UI_PORT))
                .await
                .context(
                    "bind local UI server (another `everr local start` may already be running)",
                )?;
            Ok(Self {
                listener,
                state: ServerState {
                    origin: build::local_ui_origin(),
                    pending_auth: Arc::new(Mutex::new(None)),
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
                UI.get_file("_shell.html")
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
        Ok(value) => Json(value).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("{error:#}")})),
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

fn store() -> crate::state::AppStateStore {
    crate::auth::state_store()
}
fn api() -> Result<ApiClient> {
    let config = crate::auth::resolve_auth_config()?;
    ApiClient::from_session(&store().load_session_for_api_base_url(&config.api_base_url)?)
}
fn auth_status() -> Result<Value> {
    let config = crate::auth::resolve_auth_config()?;
    Ok(
        json!({"status": if store().has_active_session_for_api_base_url(&config.api_base_url)? {"signed_in"} else {"signed_out"}, "session_path": store().session_file_path()?.display().to_string()}),
    )
}
fn pending_value(pending: &PendingAuth) -> Value {
    json!({"status":"pending", "user_code":pending.authorization.user_code, "verification_url":pending.authorization.verification_url, "expires_at":pending.expires_at.to_rfc3339(), "poll_interval_seconds":pending.authorization.interval})
}

async fn dispatch(state: &ServerState, command: &str, args: Value) -> Result<Value> {
    match command {
        "get_auth_status" => auth_status(),
        "get_pending_sign_in" => {
            let mut pending = state.pending_auth.lock().await;
            if pending.as_ref().is_some_and(|p| p.expires_at <= Utc::now()) { *pending = None; }
            Ok(pending.as_ref().map(pending_value).unwrap_or(Value::Null))
        }
        "start_sign_in" => {
            if auth_status()?["status"] == "signed_in" { return auth_status(); }
            let config = crate::auth::resolve_auth_config()?;
            let authorization = start_device_authorization(&build_auth_http_client()?, &config).await?;
            let pending = PendingAuth { expires_at: Utc::now() + chrono::Duration::seconds(authorization.expires_in as i64), next_poll_at: std::time::Instant::now() + Duration::from_secs(authorization.interval), authorization };
            let value = pending_value(&pending);
            *state.pending_auth.lock().await = Some(pending);
            Ok(value)
        }
        "poll_sign_in" => {
            let mut guard = state.pending_auth.lock().await;
            let Some(pending) = guard.as_mut() else { return Ok(json!({"status":"expired"})); };
            if pending.expires_at <= Utc::now() { *guard = None; return Ok(json!({"status":"expired"})); }
            if std::time::Instant::now() < pending.next_poll_at { return Ok(pending_value(pending)); }
            let config = crate::auth::resolve_auth_config()?;
            let status = poll_device_authorization(&build_auth_http_client()?, &config, &pending.authorization).await?;
            pending.next_poll_at = std::time::Instant::now() + Duration::from_secs(pending.authorization.interval);
            match status {
                DevicePollStatus::Authorized(token) => {
                    let session = session_from_device_token(&config, token)?;
                    let profile = ApiClient::from_session(&session)?.get_me().await.ok();
                    store().update_state(|state| {
                        state.session = Some(session);
                        state.settings.user_profile = profile.as_ref().map(|me| crate::state::UserProfile { email: me.email.clone(), name: me.name.clone(), profile_url: me.profile_url.clone() });
                        state.settings.notification_emails = profile.map(|me| vec![me.email]).unwrap_or_default();
                    })?;
                    *guard = None;
                    auth_status()
                }
                DevicePollStatus::Pending => Ok(pending_value(pending)),
                DevicePollStatus::SlowDown => { pending.authorization.interval += 5; pending.next_poll_at += Duration::from_secs(5); Ok(pending_value(pending)) }
                DevicePollStatus::Denied => { *guard = None; Ok(json!({"status":"denied"})) }
                DevicePollStatus::Expired => { *guard = None; Ok(json!({"status":"expired"})) }
            }
        }
        "open_sign_in_browser" => {
            let pending = state.pending_auth.lock().await;
            let pending = pending.as_ref().filter(|p| p.expires_at > Utc::now()).context("sign-in expired")?;
            webbrowser::open(&pending.authorization.verification_url)?;
            Ok(Value::Null)
        }
        "sign_out" => { store().clear_session()?; *state.pending_auth.lock().await = None; auth_status() }
        "get_user_profile" => {
            if auth_status()?["status"] != "signed_in" { return Ok(Value::Null); }
            let profile = api()?.get_me().await?;
            Ok(json!({"email":profile.email,"name":profile.name,"profile_url":profile.profile_url}))
        }
        "get_org" => Ok(json!({"name":api()?.get_org().await?.name})),
        "get_notification_emails" => Ok(json!(store().load_state()?.settings.notification_emails)),
        "set_notification_emails" => {
            let emails: Vec<String> = serde_json::from_value(args["emails"].clone())?;
            store().update_state(|state| state.settings.notification_emails = emails)?;
            Ok(Value::Null)
        }
        "get_skills_status" => tokio::task::spawn_blocking(|| -> Result<Value> {
            let home = dirs::home_dir().context("resolve home directory")?;
            let bundled = skills::bundled_skills()?;
            Ok(json!(skills::provider_statuses(&home).into_iter().map(|p| json!({"provider":p.provider.as_str(),"display_name":p.provider.display_name(),"detected":p.detected,"installed":bundled.iter().all(|s| std::path::Path::new(&p.path).join(&s.name).join("SKILL.md").is_file())})).collect::<Vec<_>>()))
        }).await?,
        "install_skills" => {
            tokio::task::spawn_blocking(move || -> Result<()> {
                let names: Vec<String> = serde_json::from_value(args["providers"].clone())?;
                let providers = names.iter().map(|name| SkillProvider::ALL.into_iter().find(|p| p.as_str() == name).with_context(|| format!("unknown skill provider: {name}"))).collect::<Result<Vec<_>>>()?;
                if providers.is_empty() { bail!("select at least one skill provider"); }
                skills::install_bundled_skills(&SkillOperationOptions { scope:SkillScope::Global,cwd:std::env::current_dir()?,home_dir:dirs::home_dir().context("resolve home directory")?,providers,skill_names:Vec::new(),all:true,dry_run:false })?;
                Ok(())
            }).await??;
            Ok(Value::Null)
        }
        "get_collector_status" => collector_status().await,
        "restart_collector" => {
            let (tx, rx) = oneshot::channel();
            state.restart.send(tx).await.context("collector supervisor stopped")?;
            rx.await.context("collector restart interrupted")?.map_err(|error| anyhow!(error))?;
            collector_status().await
        }
        "telemetry_sql_query" => {
            let sql = args["sql"].as_str().context("missing SQL")?;
            let params: HashMap<String, Value> = serde_json::from_value(args.get("params").cloned().unwrap_or(json!({})))?;
            let query: Vec<_> = params.into_iter().map(|(name,value)| (format!("param_{name}"),value.to_string())).collect();
            let response = state.http.post(format!("{}/sql", build::sql_http_origin())).header("content-type","text/plain").query(&query).body(sql.to_owned()).send().await?;
            let status = response.status(); let body = response.text().await?;
            if !status.is_success() { bail!("collector query failed ({status}): {body}"); }
            Ok(json!(super::client::parse_ndjson(&body)?.values))
        }
        "get_runs_list" | "get_runs_histogram" | "get_run_filter_options" => {
            let mut query = Vec::<(&str, String)>::new();
            for key in ["from","to","limit","offset","runId","includeTotalCount","histogramBuckets"] {
                if let Some(value) = args.get(key).filter(|v| !v.is_null()) { query.push((key,value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string()))); }
            }
            for key in ["repos","branches","conclusions","workflowNames"] {
                if let Some(values) = args[key].as_array() { for value in values { query.push((key,value.as_str().context("invalid run filter")?.to_owned())); } }
            }
            if args["onlyMine"].as_bool() == Some(true) {
                let emails = store().load_state()?.settings.notification_emails;
                if emails.is_empty() { query.push(("authorEmails","__everr_no_matching_author__".into())); }
                for email in emails { query.push(("authorEmails",email)); }
            }
            let client = api()?;
            match command { "get_runs_list" => client.get_runs_list(&query).await, "get_runs_histogram" => client.get_runs_histogram(&query).await, _ => client.get_run_filter_options(&query).await }
        }
        "open_run_in_browser" => {
            let trace = args["traceId"].as_str().context("missing trace ID")?;
            if trace.is_empty() || !trace.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') { bail!("invalid trace ID"); }
            webbrowser::open(&format!("{}/runs/{trace}", crate::auth::resolve_auth_config()?.api_base_url.trim_end_matches('/')))?;
            Ok(Value::Null)
        }
        "get_run_auto_fix_prompt" => {
            let trace = args["traceId"].as_str().context("missing trace ID")?;
            let failure = api()?.get_notification_for_trace(trace).await?.context("run not found")?;
            Ok(json!(super::auto_fix_prompt::build_notification_auto_fix_prompt(&failure)))
        }
        "get_telemetry_context" => Ok(json!({"serviceVersion":env!("EVERR_VERSION")})),
        _ => bail!("unknown local command: {command}"),
    }
}

async fn collector_status() -> Result<Value> {
    let running = build::healthcheck_origin();
    let healthy =
        crate::collector::wait_healthcheck(&format!("{running}/"), Duration::from_secs(1))
            .await;
    Ok(
        json!({"status":if healthy {"running"} else {"stopped"},"otlpEndpoint":build::otlp_http_origin(),"sqlEndpoint":build::sql_http_origin(),"healthEndpoint":running,"telemetryDir":build::telemetry_dir()?.display().to_string()}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_server() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let (restart, _) = mpsc::channel(1);
        let state = ServerState {
            origin: origin.clone(),
            pending_auth: Arc::new(Mutex::new(None)),
            restart,
            http: reqwest::Client::new(),
        };
        let task = tokio::spawn(async move {
            axum::serve(listener, router(state)).await.unwrap();
        });
        (origin, task)
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
