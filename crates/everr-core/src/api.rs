use std::fmt;

use anyhow::{Context, Result};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::StatusCode;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::build;
use crate::state::Session;

#[derive(Debug)]
struct ReauthenticationRequired;

impl fmt::Display for ReauthenticationRequired {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Session expired. Run `{} login` to re-authenticate.",
            build::command_name()
        )
    }
}

impl std::error::Error for ReauthenticationRequired {}

pub fn is_reauthentication_required(error: &anyhow::Error) -> bool {
    error.downcast_ref::<ReauthenticationRequired>().is_some()
}

pub struct ApiClient {
    http: reqwest::Client,
    base_url: String,
    base_endpoint: String,
}

impl ApiClient {
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
        })
    }

    pub async fn get_grep(&self, query: &[(&str, String)]) -> Result<Value> {
        self.get_json("/grep", query).await
    }

    pub async fn get_runs_list(&self, query: &[(&str, String)]) -> Result<Value> {
        self.get_json("/runs", query).await
    }

    pub async fn get_status(&self, query: &[(&str, String)]) -> Result<WatchResponse> {
        self.get("/runs/status", query).await
    }

    pub async fn get_me(&self) -> Result<MeResponse> {
        self.get("/me", &[]).await
    }

    pub async fn get_test_history(&self, query: &[(&str, String)]) -> Result<Value> {
        self.get_json("/test-history", query).await
    }

    pub async fn get_slowest_tests(&self, query: &[(&str, String)]) -> Result<Value> {
        self.get_json("/slowest-tests", query).await
    }

    pub async fn get_slowest_jobs(&self, query: &[(&str, String)]) -> Result<Value> {
        self.get_json("/slowest-jobs", query).await
    }

    pub async fn get_workflows_list(
        &self,
        query: &[(&str, String)],
    ) -> Result<WorkflowsListResponse> {
        self.get("/workflows-list", query).await
    }

    pub async fn get_run_details(&self, trace_id: &str, query: &[(&str, String)]) -> Result<Value> {
        let path = format!("/runs/{trace_id}");
        self.get_json(&path, query).await
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

fn http_status_error(status: StatusCode, text: String, context: &str) -> anyhow::Error {
    if status == StatusCode::UNAUTHORIZED {
        return anyhow::Error::new(ReauthenticationRequired);
    }

    anyhow::anyhow!("{context} failed with {status}: {text}")
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
pub struct WorkflowsListResponse {
    pub workflows: Vec<WorkflowWithJobs>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct WorkflowWithJobs {
    pub name: String,
    pub jobs: Vec<String>,
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
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoEntry {
    pub id: i64,
    pub full_name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotifyPayload {
    pub tenant_id: i64,
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

#[cfg(test)]
mod api_client_tests {
    use super::*;

    fn make_session(base_url: &str) -> crate::state::Session {
        crate::state::Session {
            api_base_url: base_url.to_string(),
            token: "test-token".to_string(),
        }
    }

    #[tokio::test]
    async fn get_org_parses_response() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/api/cli/org")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"name":"Test Org","isOnlyMember":true}"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let org = client.get_org().await.unwrap();

        assert_eq!(org.name, "Test Org");
        assert!(org.is_only_member);
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
            "Session expired. Run `everr login` to re-authenticate."
        );
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
            "Session expired. Run `everr login` to re-authenticate."
        );
        mock.assert_async().await;
    }
}
