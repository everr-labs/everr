use anyhow::{Context, Result, bail};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::state::Session;

pub struct ApiClient {
    http: reqwest::Client,
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
        let base_endpoint = format!("{}/api/cli", session.api_base_url.trim_end_matches('/'));

        Ok(Self {
            http,
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

    pub async fn watch_sse(
        &self,
        query: &[(&str, String)],
    ) -> Result<impl futures_util::Stream<Item = Result<WatchResponse>>> {
        let response = self
            .http
            .get(format!("{}/runs/watch", self.base_endpoint))
            .query(query)
            .send()
            .await
            .context("SSE connection failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".to_string());
            bail!("SSE connection failed with {status}: {text}");
        }

        let stream = response
            .bytes_stream()
            .eventsource()
            .filter_map(|event| async {
                match event {
                    Ok(ev) if ev.event == "message" && !ev.data.is_empty() => {
                        // Check for server-side error events before deserializing
                        if let Ok(obj) = serde_json::from_str::<serde_json::Value>(&ev.data) {
                            if obj.get("type").and_then(|t| t.as_str()) == Some("error") {
                                let msg = obj.get("message").and_then(|m| m.as_str()).unwrap_or("unknown error");
                                return Some(Err(anyhow::anyhow!("server error: {msg}")));
                            }
                        }
                        match serde_json::from_str::<WatchResponse>(&ev.data) {
                            Ok(response) => Some(Ok(response)),
                            Err(_) => None,
                        }
                    }
                    Err(e) => Some(Err(anyhow::anyhow!("SSE stream error: {e}"))),
                    _ => None,
                }
            });

        Ok(stream)
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

    pub async fn get_workflows_list(&self, query: &[(&str, String)]) -> Result<WorkflowsListResponse> {
        self.get("/workflows-list", query).await
    }

    pub async fn get_run_details(
        &self,
        trace_id: &str,
        query: &[(&str, String)],
    ) -> Result<Value> {
        let path = format!("/runs/{trace_id}");
        self.get_json(&path, query).await
    }

    pub async fn get_step_logs(
        &self,
        trace_id: &str,
        query: &[(&str, String)],
    ) -> Result<Vec<StepLogEntry>> {
        let path = format!("/runs/{trace_id}/logs");
        self.get(&path, query).await
    }

    pub async fn get_owned_failures(
        &self,
        git_email: &str,
        repo: Option<&str>,
        branch: Option<&str>,
    ) -> Result<Vec<FailureNotification>> {
        let mut query = vec![("gitEmail", git_email.to_string())];
        if let Some(value) = repo {
            query.push(("repo", value.to_string()));
        }
        if let Some(value) = branch {
            query.push(("branch", value.to_string()));
        }

        self.get("/notifier/failures", &query).await
    }

    pub async fn failures_sse(
        &self,
        git_email: &str,
    ) -> Result<impl futures_util::Stream<Item = Result<FailureStreamEvent>>> {
        let response = self
            .http
            .get(format!("{}/notifier/failures/stream", self.base_endpoint))
            .query(&[("gitEmail", git_email)])
            .send()
            .await
            .context("SSE connection failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".to_string());
            bail!("SSE connection failed with {status}: {text}");
        }

        let stream = response
            .bytes_stream()
            .eventsource()
            .filter_map(|event| async {
                match event {
                    Ok(ev) if ev.event == "message" && !ev.data.is_empty() => {
                        if let Ok(obj) = serde_json::from_str::<serde_json::Value>(&ev.data) {
                            if obj.get("type").and_then(|t| t.as_str()) == Some("ping") {
                                return None;
                            }
                        }
                        match serde_json::from_str::<FailureStreamEvent>(&ev.data) {
                            Ok(event) => Some(Ok(event)),
                            Err(_) => None,
                        }
                    }
                    Err(e) => Some(Err(anyhow::anyhow!("SSE stream error: {e}"))),
                    _ => None,
                }
            });

        Ok(stream)
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
            bail!("CLI API request failed with {status}: {text}");
        }

        response
            .json::<T>()
            .await
            .context("failed to decode CLI API response as JSON")
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct StepLogEntry {
    pub timestamp: String,
    pub body: String,
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
pub struct WatchRun {
    pub trace_id: String,
    pub run_id: String,
    pub workflow_name: String,
    pub conclusion: Option<String>,
    pub started_at: String,
    pub duration_seconds: Option<u64>,
    pub expected_duration_seconds: Option<u64>,
    pub active_jobs: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchResponse {
    pub state: WatchState,
    pub active: Vec<WatchRun>,
    pub completed: Vec<WatchRun>,
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
    pub job_name: Option<String>,
    pub step_number: Option<String>,
    pub step_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct FailureStreamEvent {
    pub failures: Vec<FailureNotification>,
}
