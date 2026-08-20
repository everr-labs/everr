use std::fmt;

use anyhow::{Context, Result};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use opentelemetry::global;
use opentelemetry::propagation::Injector;
use reqwest::StatusCode;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::build;
use crate::state::Session;

#[derive(Debug)]
struct ReauthenticationRequired;

impl fmt::Display for ReauthenticationRequired {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Session expired. Run `{} cloud login` to re-authenticate.",
            build::command_name()
        )
    }
}

impl std::error::Error for ReauthenticationRequired {}

pub fn is_reauthentication_required(error: &anyhow::Error) -> bool {
    error.downcast_ref::<ReauthenticationRequired>().is_some()
}

/// Which credential the client authenticates with. Apply's 401 handling differs
/// by kind: a bad `EVERR_API_KEY` can't be fixed by `cloud login`, while a
/// missing/expired session can.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuthKind {
    Session,
    Token,
}

pub struct ApiClient {
    http: reqwest::Client,
    base_url: String,
    base_endpoint: String,
    auth_kind: AuthKind,
}

impl ApiClient {
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn from_session(session: &Session) -> Result<Self> {
        let mut headers = HeaderMap::new();
        let bearer = format!("Bearer {}", session.token);
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&bearer).context("invalid token for Authorization header")?,
        );
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let http = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .context("failed to build HTTP client")?;
        let base_url = session.api_base_url.trim_end_matches('/').to_string();
        let base_endpoint = format!("{}/api/cli", base_url);

        Ok(Self {
            http,
            base_url,
            base_endpoint,
            auth_kind: AuthKind::Session,
        })
    }

    /// Build a client from a raw bearer token + base URL (for CI: `EVERR_API_KEY`).
    pub fn from_token(api_base_url: &str, token: &str) -> Result<Self> {
        let mut headers = HeaderMap::new();
        let bearer = format!("Bearer {token}");
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&bearer).context("invalid token for Authorization header")?,
        );
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        let http = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .context("failed to build HTTP client")?;
        let base_url = api_base_url.trim_end_matches('/').to_string();
        let base_endpoint = format!("{base_url}/api/cli");
        Ok(Self {
            http,
            base_url,
            base_endpoint,
            auth_kind: AuthKind::Token,
        })
    }

    pub async fn apply(
        &self,
        request: &crate::apply::ApplyRequest,
    ) -> Result<crate::apply::ApplySummary> {
        let response = self
            .http
            .post(format!("{}/api/apply", self.base_url))
            .json(request)
            .send()
            .await
            .context("apply request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".to_string());
            // A 401 means different things per credential: a bad EVERR_API_KEY
            // can't be fixed by `cloud login`, so the token path returns its own
            // message; a missing/expired session (already refresh-attempted)
            // routes through the standard reauth path that directs `cloud login`.
            if status == StatusCode::UNAUTHORIZED {
                return Err(match self.auth_kind {
                    AuthKind::Token => anyhow::anyhow!(
                        "apply was rejected (401 Unauthorized): the API key (EVERR_API_KEY, \
                         or the deprecated EVERR_API_TOKEN) is missing, invalid, or not \
                         authorized to apply resources in this organization."
                    ),
                    AuthKind::Session => anyhow::Error::new(ReauthenticationRequired),
                });
            }
            return Err(http_status_error(status, text, "apply"));
        }

        response
            .json()
            .await
            .context("failed to decode apply response")
    }

    pub async fn get_runs_list(&self, query: &[(&str, String)]) -> Result<Value> {
        self.get_json("/runs", query).await
    }

    pub async fn get_runs_histogram(&self, query: &[(&str, String)]) -> Result<Value> {
        self.get_json("/runs/histogram", query).await
    }

    pub async fn get_run_filter_options(&self, query: &[(&str, String)]) -> Result<Value> {
        self.get_json("/runs/filter-options", query).await
    }

    pub async fn get_status(&self, query: &[(&str, String)]) -> Result<WatchResponse> {
        self.get("/runs/status", query).await
    }

    pub async fn get_me(&self) -> Result<MeResponse> {
        self.get("/me", &[]).await
    }

    pub async fn get_run_details(&self, trace_id: &str, query: &[(&str, String)]) -> Result<Value> {
        let path = format!("/runs/{trace_id}");
        self.get_json(&path, query).await
    }

    pub async fn post_sql(&self, sql: &str) -> Result<String> {
        // A CLIENT span whose W3C context is injected into the request, so the
        // server continues this trace (CLI → server → ClickHouse). No-op unless
        // the caller installed a tracer provider + propagator (the CLI does).
        let span = tracing::info_span!(
            target: "everr_api",
            "POST /api/cli/sql",
            otel.kind = "client",
            http.request.method = "POST",
        );
        async move {
            let request = self
                .http
                .post(format!("{}/sql", self.base_endpoint))
                .header(CONTENT_TYPE, "text/plain")
                .headers(current_trace_headers())
                .body(sql.to_string());
            let response = self.send_checked(request, "CLI SQL").await?;

            response
                .text()
                .await
                .context("failed to read CLI SQL response body")
        }
        .instrument(span)
        .await
    }

    pub async fn get_step_logs(
        &self,
        trace_id: &str,
        query: &[(&str, String)],
    ) -> Result<StepLogsResponse> {
        let path = format!("/runs/{trace_id}/logs");
        self.get(&path, query).await
    }

    pub async fn get_notification_for_trace(
        &self,
        trace_id: &str,
    ) -> Result<Option<FailureNotification>> {
        let query = [("traceId", trace_id.to_string())];
        let results: Vec<FailureNotification> = self.get("/notification", &query).await?;
        Ok(results.into_iter().next())
    }

    pub async fn events_stream(
        &self,
        scope: &str,
        key: Option<&str>,
    ) -> Result<impl futures_util::Stream<Item = Result<NotifyPayload>>> {
        let mut params: Vec<(&str, &str)> = vec![("scope", scope)];
        if let Some(k) = key {
            params.push(("key", k));
        }

        let response = self
            .http
            .get(format!("{}/api/events/stream", self.base_url))
            .query(&params)
            .send()
            .await
            .context("SSE connection failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".to_string());
            return Err(http_status_error(status, text, "SSE connection"));
        }

        let stream = response
            .bytes_stream()
            .eventsource()
            .filter_map(|event| async {
                match event {
                    Ok(ev) if ev.event == "message" && !ev.data.is_empty() => {
                        match serde_json::from_str::<serde_json::Value>(&ev.data) {
                            Ok(obj) => match obj.get("type").and_then(|t| t.as_str()) {
                                Some("ping") => None,
                                Some("error") => {
                                    let msg = obj
                                        .get("message")
                                        .and_then(|m| m.as_str())
                                        .unwrap_or("unknown error");
                                    Some(Err(anyhow::anyhow!("server error: {msg}")))
                                }
                                _ => match serde_json::from_value::<NotifyPayload>(obj) {
                                    Ok(payload) => Some(Ok(payload)),
                                    Err(_) => None,
                                },
                            },
                            Err(_) => None,
                        }
                    }
                    Err(e) => Some(Err(anyhow::anyhow!("SSE stream error: {e}"))),
                    _ => None,
                }
            });

        Ok(stream)
    }

    pub async fn get_org(&self) -> Result<OrgResponse> {
        self.get("/org", &[]).await
    }

    pub async fn complete_org_onboarding(&self) -> Result<()> {
        let response = self
            .http
            .patch(format!("{}/org", self.base_endpoint))
            .send()
            .await
            .context("PATCH org onboarding request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".to_string());
            return Err(http_status_error(status, text, "PATCH org onboarding"));
        }

        Ok(())
    }

    pub async fn patch_org_name(&self, name: &str) -> Result<()> {
        let response = self
            .http
            .patch(format!("{}/org/name", self.base_endpoint))
            .json(&serde_json::json!({ "name": name }))
            .send()
            .await
            .context("PATCH org name request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".to_string());
            return Err(http_status_error(status, text, "PATCH org name"));
        }

        Ok(())
    }

    pub async fn get_repos(&self) -> Result<Vec<RepoEntry>> {
        self.get("/repos", &[]).await
    }

    pub async fn list_resources(
        &self,
        kind: Option<&str>,
        repoid: Option<&str>,
    ) -> Result<Vec<ResourceSummary>> {
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(k) = kind {
            query.push(("kind", k.to_string()));
        }
        if let Some(r) = repoid {
            query.push(("repoid", r.to_string()));
        }
        self.get("/resources", &query).await
    }

    pub async fn get_resource(
        &self,
        kind: &str,
        project: &str,
        slug: &str,
    ) -> Result<serde_json::Value> {
        self.get(&resource_path(kind, project, slug), &[]).await
    }

    /// Send a request and return the response, mapping any non-2xx status to a
    /// `http_status_error` (reading the body for the message). `context` labels
    /// the operation in the error, e.g. "delete resource".
    async fn send_checked(
        &self,
        request: reqwest::RequestBuilder,
        context: &'static str,
    ) -> Result<reqwest::Response> {
        let response = request
            .send()
            .await
            .with_context(|| format!("{context} request failed"))?;
        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".to_string());
            return Err(http_status_error(status, text, context));
        }
        Ok(response)
    }

    pub async fn delete_resource(&self, kind: &str, project: &str, slug: &str) -> Result<()> {
        let request = self.http.delete(format!(
            "{}{}",
            self.base_endpoint,
            resource_path(kind, project, slug)
        ));
        self.send_checked(request, "delete resource").await?;
        Ok(())
    }

    pub async fn adopt_resource(
        &self,
        kind: &str,
        project: &str,
        slug: &str,
        repoid: &str,
    ) -> Result<AdoptOutcome> {
        let request = self
            .http
            .post(format!(
                "{}{}/adopt",
                self.base_endpoint,
                resource_path(kind, project, slug)
            ))
            .json(&serde_json::json!({ "repoid": repoid }));
        let response = self.send_checked(request, "adopt resource").await?;
        response
            .json()
            .await
            .context("failed to decode adopt response")
    }

    /// One page of the org's alert silences, newest first.
    pub async fn list_silences(&self, query: &SilenceQuery<'_>) -> Result<Vec<Silence>> {
        let mut params = vec![
            ("limit", query.limit.to_string()),
            ("offset", query.offset.to_string()),
        ];
        if let Some(from) = query.from {
            params.push(("from", from.to_string()));
        }
        if let Some(to) = query.to {
            params.push(("to", to.to_string()));
        }
        let request = self
            .http
            .get(self.alerts_url(&["silences"])?)
            .query(&params);
        self.send_json(request, "list silences").await
    }

    pub async fn create_silence(&self, input: &SilenceInput) -> Result<Silence> {
        let request = self.http.post(self.alerts_url(&["silences"])?).json(input);
        self.send_json(request, "create silence").await
    }

    /// Close a silence's window. Expiring one that is already closed is not an
    /// error: the outcome reports that nothing changed.
    pub async fn expire_silence(&self, id: &str) -> Result<ExpireOutcome> {
        let url = self.alerts_url(&["silences", id, "expire"])?;
        let request = self.http.post(url);
        self.send_json(request, "expire silence").await
    }

    /// The org's delivery channels. Secrets come back redacted as `***`.
    pub async fn list_channels(&self) -> Result<Vec<Channel>> {
        let request = self.http.get(self.alerts_url(&["channels"])?);
        self.send_json(request, "list channels").await
    }

    pub async fn create_channel(&self, name: &str, config: &ChannelConfig) -> Result<Channel> {
        let body = ChannelWrite {
            name: Some(name),
            config: Some(config),
        };
        let request = self.http.post(self.alerts_url(&["channels"])?).json(&body);
        self.send_json(request, "create channel").await
    }

    /// Update a channel, naming only what changes. Omitting the config leaves
    /// the stored credential alone; sending one whose secret is the redaction
    /// marker does the same, for an edit that changes the rest of it.
    pub async fn update_channel(
        &self,
        name: &str,
        rename: Option<&str>,
        config: Option<&ChannelConfig>,
    ) -> Result<Channel> {
        let body = ChannelWrite {
            name: rename,
            config,
        };
        let url = self.alerts_url(&["channels", name])?;
        let request = self.http.patch(url).json(&body);
        self.send_json(request, "update channel").await
    }

    pub async fn delete_channel(&self, name: &str) -> Result<DeleteOutcome> {
        let url = self.alerts_url(&["channels", name])?;
        let request = self.http.delete(url);
        self.send_json(request, "delete channel").await
    }

    /// An /api/cli/alerts URL whose trailing segments are values, not literals:
    /// a channel name or a silence id goes through `push`, which percent-encodes
    /// it, so a name holding a slash or a space still addresses one channel.
    fn alerts_url(&self, segments: &[&str]) -> Result<reqwest::Url> {
        let mut url = reqwest::Url::parse(&format!("{}/alerts", self.base_endpoint))
            .context("CLI API endpoint is not a valid URL")?;
        {
            let mut path = url
                .path_segments_mut()
                .map_err(|()| anyhow::anyhow!("CLI API endpoint cannot have path segments"))?;
            for segment in segments {
                path.push(segment);
            }
        }
        Ok(url)
    }

    /// `send_checked` plus decoding the body, for the routes that answer with
    /// JSON rather than an empty 2xx.
    async fn send_json<T: DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
        context: &'static str,
    ) -> Result<T> {
        let response = self.send_checked(request, context).await?;
        response
            .json()
            .await
            .with_context(|| format!("failed to decode {context} response"))
    }

    /// Calls POST /api/cli/import and returns once the server acknowledges the import has started.
    pub async fn start_import_repos(&self, repos: &[String]) -> Result<()> {
        let response = self
            .http
            .post(format!("{}/import", self.base_endpoint))
            .json(&serde_json::json!({ "repos": repos }))
            .send()
            .await
            .context("import request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".to_string());
            return Err(http_status_error(status, text, "import request"));
        }

        Ok(())
    }

    async fn get_json(&self, path: &str, query: &[(&str, String)]) -> Result<Value> {
        self.get(path, query).await
    }

    async fn get<T: DeserializeOwned>(&self, path: &str, query: &[(&str, String)]) -> Result<T> {
        let response = self
            .http
            .get(format!("{}{}", self.base_endpoint, path))
            .query(query)
            .send()
            .await
            .context("CLI API request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".to_string());
            return Err(http_status_error(status, text, "CLI API request"));
        }

        response
            .json::<T>()
            .await
            .context("failed to decode CLI API response as JSON")
    }
}

/// The API path identifying one resource, shared by show/delete/adopt.
fn resource_path(kind: &str, project: &str, slug: &str) -> String {
    format!("/resources/{kind}/{project}/{slug}")
}

/// Writes W3C propagation headers (traceparent/tracestate) into a HeaderMap.
struct HeaderInjector<'a>(&'a mut HeaderMap);

impl Injector for HeaderInjector<'_> {
    fn set(&mut self, key: &str, value: String) {
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_bytes(key.as_bytes()),
            HeaderValue::from_str(&value),
        ) {
            self.0.insert(name, val);
        }
    }
}

/// Trace-propagation headers for the current span, to add to an outgoing
/// request. Empty when no tracer/propagator is installed (e.g. in tests, the
/// desktop app, or when telemetry is disabled) — the global propagator defaults
/// to a no-op, so nothing is injected and the request is unchanged.
fn current_trace_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    let context = tracing::Span::current().context();
    global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&context, &mut HeaderInjector(&mut headers));
    });
    headers
}

/// The reason a refusal gave, unwrapped from its envelope.
///
/// Every /api/cli route answers a refusal with `{ "error": ... }` (the alerting
/// ones add a `code`). Printing the envelope would put JSON in front of the
/// sentence the user needs to read. A body in any other shape, such as apply's
/// plain-text validation output, is passed through untouched.
fn refusal_text(text: String) -> String {
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|body| Some(body.get("error")?.as_str()?.to_string()))
        .unwrap_or(text)
}

fn http_status_error(status: StatusCode, text: String, context: &str) -> anyhow::Error {
    if status == StatusCode::UNAUTHORIZED {
        return anyhow::Error::new(ReauthenticationRequired);
    }

    anyhow::anyhow!("{context} failed with {status}: {}", refusal_text(text))
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct StepLogEntry {
    pub timestamp: String,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct StepLogsResponse {
    pub logs: Vec<StepLogEntry>,
    pub offset: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WatchState {
    Pending,
    Running,
    Completed,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FirstFailingStep {
    pub step_number: u32,
    pub step_name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FailingJob {
    pub id: String,
    pub name: String,
    pub first_failing_step: Option<FirstFailingStep>,
}

/// Job entry as returned by `GET /runs/{trace_id}?failed=true`.
/// The shape differs from [`FailingJob`] which comes from the status/watch endpoint.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShowJob {
    pub name: String,
    pub job_id: Option<String>,
    /// Step number of the first failing step, if any.
    pub first_failing_step: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ShowRunDetails {
    pub jobs: Vec<ShowJob>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchRun {
    pub trace_id: String,
    pub run_id: String,
    pub workflow_name: String,
    pub conclusion: Option<String>,
    pub started_at: String,
    pub duration_seconds: Option<u64>,
    pub active_jobs: Vec<String>,
    #[serde(default)]
    pub failing_jobs: Vec<FailingJob>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchResponse {
    #[serde(default)]
    pub repo: String,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub commit: String,
    pub state: WatchState,
    pub active: Vec<WatchRun>,
    pub completed: Vec<WatchRun>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeResponse {
    pub email: String,
    pub name: String,
    pub profile_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FailureNotification {
    pub dedupe_key: String,
    pub trace_id: String,
    pub repo: String,
    pub branch: String,
    pub workflow_name: String,
    pub failed_at: String,
    pub details_url: String,
    /// All failed jobs in the run with their first failing step.
    #[serde(default)]
    pub failed_jobs: Vec<FailedJobInfo>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FailedJobInfo {
    pub job_name: String,
    pub step_number: String,
    pub step_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OrgResponse {
    pub name: String,
    pub is_only_member: bool,
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default)]
    pub role: Option<String>,
}

impl OrgResponse {
    pub fn can_manage_runs_import(&self) -> bool {
        match self.role.as_deref() {
            Some("admin" | "owner") => true,
            Some(_) => false,
            None => true,
        }
    }

    pub fn can_manage_runs_import_or_default(org: Option<&Self>) -> bool {
        org.map(Self::can_manage_runs_import).unwrap_or(true)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoEntry {
    pub id: i64,
    pub full_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSummary {
    pub kind: String,
    pub project: String,
    pub slug: String,
    pub repoid: String,
    pub updated_at: String,
}

/// A matcher selects the alerts a silence withholds. Matching is exact only:
/// `eq` or `ne`, never a pattern.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Matcher {
    pub label: String,
    pub op: MatchOp,
    pub value: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MatchOp {
    Eq,
    Ne,
}

/// What a create sends. The author is not here: the server stamps it from the
/// authenticated principal, so a caller cannot name somebody else.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SilenceInput {
    pub matchers: Vec<Matcher>,
    pub starts_at: String,
    pub ends_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// Which page of silences to read, and which window they must overlap.
///
/// `from` and `to` are absolute timestamps: date math is resolved before it
/// gets here, so the request says exactly what it asked for.
#[derive(Debug, Clone, Copy, Default)]
pub struct SilenceQuery<'a> {
    pub limit: u32,
    pub offset: u32,
    pub from: Option<&'a str>,
    pub to: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Silence {
    pub id: String,
    pub matchers: Vec<Matcher>,
    pub starts_at: String,
    pub ends_at: String,
    pub comment: String,
    pub author: String,
    pub created_at: String,
    pub canceled_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
pub struct ExpireOutcome {
    pub expired: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
pub struct DeleteOutcome {
    pub deleted: bool,
}

/// A delivery channel's transport and its credentials. On read the secret half
/// is `***`; sending that back keeps whatever is stored.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ChannelConfig {
    Webhook {
        url: String,
    },
    Slack {
        url: String,
    },
    Discord {
        url: String,
    },
    Telegram {
        bot_token: String,
        chat_ids: Vec<String>,
    },
}

/// The body a create or an update sends. Both halves are optional because an
/// update names only what changes; a create fills in both.
#[derive(Debug, Serialize)]
struct ChannelWrite<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    config: Option<&'a ChannelConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub config: ChannelConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptOutcome {
    pub kind: String,
    pub project: String,
    pub slug: String,
    pub repoid: String,
    pub already_owned: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotifyPayload {
    #[serde(deserialize_with = "deserialize_string_or_number")]
    pub tenant_id: String,
    pub trace_id: String,
    pub run_id: String,
    pub sha: String,
    pub repo: String,
    pub branch: String,
    pub author_email: Option<String>,
    pub workflow_name: String,
    pub name: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub job_id: Option<i64>,
}

fn deserialize_string_or_number<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrNumber {
        String(String),
        Number(i64),
        Unsigned(u64),
    }

    match StringOrNumber::deserialize(deserializer)? {
        StringOrNumber::String(value) => Ok(value),
        StringOrNumber::Number(value) => Ok(value.to_string()),
        StringOrNumber::Unsigned(value) => Ok(value.to_string()),
    }
}

#[cfg(test)]
mod api_client_tests {
    use super::*;
    use futures_util::StreamExt;
    use futures_util::pin_mut;

    fn make_session(base_url: &str) -> crate::state::Session {
        crate::state::Session {
            api_base_url: base_url.to_string(),
            token: "test-token".to_string(),
        }
    }

    fn empty_apply_request() -> crate::apply::ApplyRequest {
        crate::apply::ApplyRequest {
            repoid: "repo-1".to_string(),
            state: crate::apply::ApplyState::default(),
            source: None,
            preview: None,
            dry_run: false,
            adopt: false,
        }
    }

    #[tokio::test]
    async fn get_org_parses_response() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/api/cli/org")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{"name":"Test Org","isOnlyMember":true,"onboardingCompleted":true,"role":"admin"}"#,
            )
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let org = client.get_org().await.unwrap();

        assert_eq!(org.name, "Test Org");
        assert!(org.is_only_member);
        assert!(org.onboarding_completed);
        assert_eq!(org.role.as_deref(), Some("admin"));
        mock.assert_async().await;
    }

    #[test]
    fn org_response_allows_imports_for_admins_and_owners() {
        for role in ["admin", "owner"] {
            let org = OrgResponse {
                name: "Acme".to_string(),
                is_only_member: false,
                onboarding_completed: false,
                role: Some(role.to_string()),
            };

            assert!(org.can_manage_runs_import());
        }
    }

    #[test]
    fn org_response_blocks_imports_for_members() {
        let org = OrgResponse {
            name: "Acme".to_string(),
            is_only_member: false,
            onboarding_completed: false,
            role: Some("member".to_string()),
        };

        assert!(!org.can_manage_runs_import());
    }

    #[tokio::test]
    async fn complete_org_onboarding_sends_patch() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("PATCH", "/api/cli/org")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"ok":true}"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        client.complete_org_onboarding().await.unwrap();

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn patch_org_name_sends_correct_body() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("PATCH", "/api/cli/org/name")
            .match_body(r#"{"name":"New Name"}"#)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"ok":true}"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        client.patch_org_name("New Name").await.unwrap();

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn get_repos_parses_response() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/api/cli/repos")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"[{"id":1,"fullName":"org/repo-a"},{"id":2,"fullName":"org/repo-b"}]"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let repos = client.get_repos().await.unwrap();

        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].full_name, "org/repo-a");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn start_import_repos_returns_ok() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/api/cli/import")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"ok":true}"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        client
            .start_import_repos(&["org/repo-a".to_string()])
            .await
            .unwrap();

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn get_repos_unauthorized_requires_reauthentication() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/api/cli/repos")
            .with_status(401)
            .with_body(r#"{"error":"expired"}"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let error = client.get_repos().await.unwrap_err();

        assert!(is_reauthentication_required(&error));
        assert_eq!(
            error.to_string(),
            "Session expired. Run `everr cloud login` to re-authenticate."
        );
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn apply_unauthorized_reports_token_error_not_reauthentication() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/api/apply")
            .with_status(401)
            .with_body(r#"{"error":"unauthorized"}"#)
            .create_async()
            .await;

        let client = ApiClient::from_token(&server.url(), "bad-token").unwrap();
        let request = empty_apply_request();
        let error = client.apply(&request).await.unwrap_err();

        // Token path: a 401 must NOT trigger the `cloud login` reauth path.
        assert!(!is_reauthentication_required(&error));
        let message = error.to_string();
        assert!(message.contains("EVERR_API_KEY"), "got: {message}");
        // Must not be the session-reauth message that *directs* a `cloud login`.
        assert!(!message.contains("Session expired"), "got: {message}");
        assert!(!message.contains("re-authenticate"), "got: {message}");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn apply_unauthorized_via_session_triggers_reauthentication() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/api/apply")
            .with_status(401)
            .with_body(r#"{"error":"Unauthenticated"}"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let request = empty_apply_request();
        let error = client.apply(&request).await.unwrap_err();

        // Session path: a 401 (after refresh) routes through the standard reauth
        // path that directs the user to `cloud login` — not the token message.
        assert!(is_reauthentication_required(&error));
        let message = error.to_string();
        assert!(message.contains("cloud login"), "got: {message}");
        assert!(!message.contains("EVERR_API_KEY"), "got: {message}");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn apply_non_auth_failure_surfaces_status_and_body() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/api/apply")
            .with_status(400)
            .with_body(r#"bad.yaml: unknown kind "Gizmo""#)
            .create_async()
            .await;

        let client = ApiClient::from_token(&server.url(), "tok").unwrap();
        let request = empty_apply_request();
        let error = client.apply(&request).await.unwrap_err();

        assert!(!is_reauthentication_required(&error));
        let message = error.to_string();
        assert!(message.contains("400"), "got: {message}");
        assert!(message.contains("Gizmo"), "got: {message}");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn events_stream_unauthorized_requires_reauthentication() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/api/events/stream")
            .match_query(mockito::Matcher::UrlEncoded(
                "scope".to_string(),
                "tenant".to_string(),
            ))
            .with_status(401)
            .with_body("expired")
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let error = match client.events_stream("tenant", None).await {
            Ok(_) => panic!("expected unauthorized SSE error"),
            Err(error) => error,
        };

        assert!(is_reauthentication_required(&error));
        assert_eq!(
            error.to_string(),
            "Session expired. Run `everr cloud login` to re-authenticate."
        );
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn events_stream_accepts_numeric_tenant_id() {
        let mut server = mockito::Server::new_async().await;
        let body = r#"event: message
data: {"tenantId":1,"traceId":"trace-1","runId":"42","sha":"deadbeef","repo":"everr-labs/everr","branch":"main","authorEmail":null,"workflowName":"CI","name":"CI","type":"run","status":"completed","conclusion":"success","jobId":null}

"#;
        let mock = server
            .mock("GET", "/api/events/stream")
            .match_query(mockito::Matcher::UrlEncoded(
                "scope".to_string(),
                "commit".to_string(),
            ))
            .match_query(mockito::Matcher::UrlEncoded(
                "key".to_string(),
                "deadbeef".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_body(body)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let stream = client
            .events_stream("commit", Some("deadbeef"))
            .await
            .expect("open SSE stream");
        pin_mut!(stream);
        let payload = stream
            .next()
            .await
            .expect("first SSE item")
            .expect("payload");

        assert_eq!(payload.tenant_id, "1");
        assert_eq!(payload.trace_id, "trace-1");
        assert_eq!(payload.event_type, "run");
        assert_eq!(payload.conclusion.as_deref(), Some("success"));
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn list_resources_parses_and_sends_filters() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/api/cli/resources")
            .match_query(mockito::Matcher::UrlEncoded("kind".into(), "runbook".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"[{"kind":"runbook","project":"default","slug":"oom","repoid":"github.com/acme/app","updatedAt":"2026-07-01T00:00:00.000Z"}]"#,
            )
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let out = client.list_resources(Some("runbook"), None).await.unwrap();

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, "runbook");
        assert_eq!(out[0].slug, "oom");
        assert_eq!(out[0].repoid, "github.com/acme/app");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn get_resource_returns_document_json() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/api/cli/resources/dashboard/default/errors")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"kind":"Dashboard","metadata":{"name":"errors"}}"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let doc = client
            .get_resource("dashboard", "default", "errors")
            .await
            .unwrap();

        assert_eq!(doc["kind"], "Dashboard");
        assert_eq!(doc["metadata"]["name"], "errors");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn delete_resource_succeeds_on_2xx() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("DELETE", "/api/cli/resources/dashboard/default/errors")
            .with_status(200)
            .with_body(r#"{"ok":true}"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        client
            .delete_resource("dashboard", "default", "errors")
            .await
            .unwrap();
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn delete_resource_surfaces_404() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("DELETE", "/api/cli/resources/dashboard/default/nope")
            .with_status(404)
            .with_body(r#"{"error":"resource not found: dashboard/default/nope"}"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let err = client
            .delete_resource("dashboard", "default", "nope")
            .await
            .unwrap_err();
        let message = err.to_string();
        assert!(message.contains("404"), "got: {message}");
        // The reason, not the envelope it arrived in.
        assert!(
            message.contains("resource not found: dashboard/default/nope"),
            "got: {message}"
        );
        assert!(!message.contains('{'), "got: {message}");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn adopt_resource_sends_repoid_and_parses_outcome() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/api/cli/resources/dashboard/default/errors/adopt")
            .match_body(r#"{"repoid":"github.com/acme/app"}"#)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{"kind":"dashboard","project":"default","slug":"errors","repoid":"github.com/acme/app","alreadyOwned":false}"#,
            )
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let outcome = client
            .adopt_resource("dashboard", "default", "errors", "github.com/acme/app")
            .await
            .unwrap();

        assert_eq!(outcome.repoid, "github.com/acme/app");
        assert!(!outcome.already_owned);
        mock.assert_async().await;
    }
    #[tokio::test]
    async fn list_silences_decodes_the_stored_window_and_matchers() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/api/cli/alerts/silences")
            .match_query(mockito::Matcher::AllOf(vec![
                mockito::Matcher::UrlEncoded("limit".into(), "20".into()),
                mockito::Matcher::UrlEncoded("offset".into(), "0".into()),
            ]))
            .with_body(
                r#"[{"id":"s-1","tenant":"org-1","matchers":[{"label":"service","op":"eq","value":"api"}],"starts_at":"2026-08-20T09:00:00.000Z","ends_at":"2026-08-20T11:00:00.000Z","comment":"deploy","author":"Ada","created_at":"2026-08-20T08:00:00.000Z","canceled_at":null}]"#,
            )
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let silences = client
            .list_silences(&SilenceQuery {
                limit: 20,
                offset: 0,
                ..SilenceQuery::default()
            })
            .await
            .unwrap();

        assert_eq!(silences.len(), 1);
        assert_eq!(silences[0].matchers[0].op, MatchOp::Eq);
        assert_eq!(silences[0].author, "Ada");
        assert_eq!(silences[0].canceled_at, None);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn create_silence_omits_a_comment_nobody_gave() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/api/cli/alerts/silences")
            .match_body(mockito::Matcher::JsonString(
                r#"{"matchers":[{"label":"service","op":"ne","value":"api"}],"starts_at":"2026-08-20T09:00:00.000Z","ends_at":"2026-08-20T11:00:00.000Z"}"#
                    .to_string(),
            ))
            .with_body(
                r#"{"id":"s-1","tenant":"org-1","matchers":[],"starts_at":"2026-08-20T09:00:00.000Z","ends_at":"2026-08-20T11:00:00.000Z","comment":"","author":"Ada","created_at":"2026-08-20T08:00:00.000Z","canceled_at":null}"#,
            )
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        client
            .create_silence(&SilenceInput {
                matchers: vec![Matcher {
                    label: "service".to_string(),
                    op: MatchOp::Ne,
                    value: "api".to_string(),
                }],
                starts_at: "2026-08-20T09:00:00.000Z".to_string(),
                ends_at: "2026-08-20T11:00:00.000Z".to_string(),
                comment: None,
            })
            .await
            .unwrap();

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn create_channel_sends_the_name_beside_its_tagged_config() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/api/cli/alerts/channels")
            .match_body(mockito::Matcher::JsonString(
                r#"{"name":"oncall","config":{"type":"telegram","bot_token":"tok","chat_ids":["1","2"]}}"#
                    .to_string(),
            ))
            .with_body(
                r#"{"id":"c-1","tenant":"org-1","name":"oncall","config":{"type":"telegram","bot_token":"***","chat_ids":["1","2"]}}"#,
            )
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let channel = client
            .create_channel(
                "oncall",
                &ChannelConfig::Telegram {
                    bot_token: "tok".to_string(),
                    chat_ids: vec!["1".to_string(), "2".to_string()],
                },
            )
            .await
            .unwrap();

        assert_eq!(
            channel.config,
            ChannelConfig::Telegram {
                bot_token: "***".to_string(),
                chat_ids: vec!["1".to_string(), "2".to_string()],
            }
        );
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn an_update_sends_only_the_half_that_changes() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("PATCH", "/api/cli/alerts/channels/oncall")
            .match_body(mockito::Matcher::JsonString(
                r#"{"name":"primary-oncall"}"#.to_string(),
            ))
            .with_body(
                r#"{"id":"c-1","tenant":"org-1","name":"primary-oncall","config":{"type":"slack","url":"***"}}"#,
            )
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        client
            .update_channel("oncall", Some("primary-oncall"), None)
            .await
            .unwrap();

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn a_channel_name_needing_escaping_still_addresses_one_channel() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("DELETE", "/api/cli/alerts/channels/team%2Foncall")
            .with_body(r#"{"deleted":true}"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let outcome = client.delete_channel("team/oncall").await.unwrap();

        assert!(outcome.deleted);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn a_refusal_reports_its_reason_not_its_envelope() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("DELETE", "/api/cli/alerts/channels/oncall")
            .with_status(409)
            .with_body(
                r#"{"error":"Channel has 2 notifications still sending; retry once they settle","code":"conflict"}"#,
            )
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let error = client.delete_channel("oncall").await.unwrap_err();

        let message = error.to_string();
        assert!(message.contains("still sending"), "got: {message}");
        assert!(!message.contains("\"code\""), "got: {message}");
        mock.assert_async().await;
    }
}
