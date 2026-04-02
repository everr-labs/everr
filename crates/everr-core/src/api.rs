use anyhow::{Context, Result, bail};
use std::time::Duration;
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::state::Session;

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
    ) -> Result<Vec<StepLogEntry>> {
        let path = format!("/runs/{trace_id}/logs");
        self.get(&path, query).await
    }

    pub async fn get_notification_for_trace(
        &self,
        trace_id: &str,
    ) -> Result<Option<FailureNotification>> {
        // TODO: remove retry once notification data is served from Postgres instead of ClickHouse.
        // See: todo/issues/notification-data-from-postgres-with-steps.md
        // The SSE event may arrive before the trace is ingested into ClickHouse,
        // so retry with exponential backoff to give ingestion time to catch up.
        let query = [("traceId", trace_id.to_string())];
        for attempt in 0..4u32 {
            if attempt > 0 {
                let delay = 2u64.pow(attempt - 1);
                tokio::time::sleep(Duration::from_secs(delay)).await;
            }
            let results: Vec<FailureNotification> = self.get("/notification", &query).await?;
            if let Some(f) = results.into_iter().next() {
                return Ok(Some(f));
            }
        }
        Ok(None)
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
            bail!("SSE connection failed with {status}: {text}");
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
