use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use everr_core::api::{AlertsUploadGitMetadata, AlertsUploadRequest, ApiClient};
use everr_core::git::{resolve_git_context, run_git};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::auth;
use crate::cli::{AlertTestArgs, AlertUploadArgs, AlertsArgs, AlertsSubcommand};
use crate::telemetry::client::QueryClient;

const MAX_EVIDENCE_ROWS: usize = 50;
const MAX_EVIDENCE_BYTES: usize = 64 * 1024;

pub async fn run(args: AlertsArgs) -> Result<()> {
    match args.command {
        AlertsSubcommand::Test(args) => test(args).await,
        AlertsSubcommand::Upload(args) => upload(args).await,
    }
}

async fn test(args: AlertTestArgs) -> Result<()> {
    let raw_yaml = read_alert_yaml(&args.path)?;

    if args.local {
        let output = tokio::task::spawn_blocking(move || test_local(&raw_yaml))
            .await
            .context("local alert test task failed")??;
        return print_json(&output);
    }

    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let output = client.test_alerts(&raw_yaml).await?;
    print_json(&output)
}

async fn upload(args: AlertUploadArgs) -> Result<()> {
    let raw_yaml = read_alert_yaml(&args.path)?;
    let git = resolve_upload_git_metadata(Path::new(&args.path));
    let request = AlertsUploadRequest {
        raw_yaml,
        source_url: args.source_url,
        git,
    };

    let session = auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    let output = client.upload_alerts(request).await?;
    print_json(&output)
}

fn read_alert_yaml(path: &str) -> Result<String> {
    fs::read_to_string(path).with_context(|| format!("failed to read alert YAML file: {path}"))
}

fn test_local(raw_yaml: &str) -> Result<AlertsTestOutput> {
    let parsed = parse_alert_yaml(raw_yaml)?;
    let client = QueryClient::new(everr_core::build::sql_http_origin());
    let mut alerts = Vec::with_capacity(parsed.alerts.len());

    for alert in parsed.alerts {
        let query = render_alert_query(&alert);
        let rows = client
            .query(&query)
            .with_context(|| format!("failed to test alert {}", alert.name))?;
        let row_count = rows.values.len();
        let bounded = bound_evidence_rows(rows.values);

        alerts.push(AlertTestResult {
            service: alert.service,
            name: alert.name,
            severity: alert.severity,
            routing: alert.routing,
            firing: row_count > 0,
            row_count,
            evidence: bounded.rows,
            truncated: bounded.truncated,
        });
    }

    Ok(AlertsTestOutput {
        filters: AlertTestFilters { target: "local" },
        alerts,
    })
}

fn parse_alert_yaml(raw_yaml: &str) -> Result<ParsedAlertFile> {
    let raw: RawAlertFile = serde_yaml::from_str(raw_yaml).context("failed to parse alert YAML")?;

    if raw.version.trim() != "everr/v1" {
        bail!("unsupported alert file version {}", raw.version);
    }
    if raw.service.trim().is_empty() {
        bail!("service is required");
    }
    if raw.alerts.is_empty() {
        bail!("at least one alert is required");
    }

    let service = raw.service.trim().to_string();
    let alerts = raw
        .alerts
        .into_iter()
        .map(|alert| parse_alert(alert, &service))
        .collect::<Result<Vec<_>>>()?;

    Ok(ParsedAlertFile { alerts })
}

fn parse_alert(raw: RawAlert, service: &str) -> Result<ParsedAlert> {
    let name = required(raw.name, "alert name")?;
    let severity = match raw.severity.trim() {
        "critical" | "warning" => raw.severity.trim().to_string(),
        _ => bail!("severity must be one of: critical, warning"),
    };
    let routing = required(raw.routing, "routing")?;
    parse_interval_seconds(&raw.evaluation_interval, "evaluationInterval")?;
    let window_seconds = parse_interval_seconds(&raw.window, "window")?;
    required(raw.summary, "summary")?;
    let query = required(raw.query, "query")?;

    Ok(ParsedAlert {
        service: service.to_string(),
        name,
        severity,
        routing,
        window_seconds,
        query,
    })
}

fn required(value: String, field: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("{field} is required");
    }
    Ok(trimmed.to_string())
}

fn parse_interval_seconds(value: &str, field: &str) -> Result<u64> {
    let trimmed = value.trim();
    let Some(unit) = trimmed.chars().last() else {
        bail!("{field} is required");
    };
    let amount = trimmed
        .get(..trimmed.len().saturating_sub(unit.len_utf8()))
        .unwrap_or_default()
        .parse::<u64>()
        .with_context(|| format!("{field} must be a duration such as 1m, 5m, or 1h"))?;
    let multiplier = match unit {
        's' => 1,
        'm' => 60,
        'h' => 60 * 60,
        'd' => 24 * 60 * 60,
        _ => bail!("{field} must use one of s, m, h, or d"),
    };
    let seconds = amount
        .checked_mul(multiplier)
        .ok_or_else(|| anyhow!("{field} is too large"))?;
    if seconds < 60 {
        bail!("{field} must be at least 1m");
    }
    Ok(seconds)
}

fn render_alert_query(alert: &ParsedAlert) -> String {
    let re = Regex::new(r"\{\{\s*window\s*\}\}").expect("valid window template regex");
    re.replace_all(&alert.query, clickhouse_interval(alert.window_seconds))
        .to_string()
}

fn clickhouse_interval(seconds: u64) -> String {
    if seconds % 86_400 == 0 {
        format!("{} DAY", seconds / 86_400)
    } else if seconds % 3_600 == 0 {
        format!("{} HOUR", seconds / 3_600)
    } else if seconds % 60 == 0 {
        format!("{} MINUTE", seconds / 60)
    } else {
        format!("{seconds} SECOND")
    }
}

fn bound_evidence_rows(rows: Vec<Value>) -> BoundedEvidence {
    let mut bounded = Vec::new();
    let mut truncated = rows.len() > MAX_EVIDENCE_ROWS;

    for row in rows {
        if bounded.len() >= MAX_EVIDENCE_ROWS {
            truncated = true;
            break;
        }

        let mut candidate = bounded.clone();
        candidate.push(row.clone());
        let bytes = serde_json::to_vec(&candidate)
            .map(|json| json.len())
            .unwrap_or(usize::MAX);
        if bytes > MAX_EVIDENCE_BYTES {
            truncated = true;
            break;
        }

        bounded.push(row);
    }

    BoundedEvidence {
        rows: bounded,
        truncated,
    }
}

fn resolve_upload_git_metadata(path: &Path) -> Option<AlertsUploadGitMetadata> {
    let cwd = std::env::current_dir().ok()?;
    let git = resolve_git_context(&cwd);
    let commit_sha = run_git(["rev-parse", "HEAD"], &cwd);
    let remote = run_git(["config", "--get", "remote.origin.url"], &cwd);
    let source_path = resolve_source_path(path, &cwd);

    let metadata = AlertsUploadGitMetadata {
        repo: git.repo,
        branch: git.branch,
        commit_sha,
        remote,
        path: source_path,
    };

    if metadata.is_empty() {
        None
    } else {
        Some(metadata)
    }
}

fn resolve_source_path(path: &Path, cwd: &Path) -> Option<String> {
    let repo_root = run_git(["rev-parse", "--show-toplevel"], cwd).map(PathBuf::from)?;
    let absolute_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    let canonical_path = absolute_path.canonicalize().unwrap_or(absolute_path);
    let relative = canonical_path.strip_prefix(repo_root).ok()?;
    Some(relative.to_string_lossy().replace('\\', "/"))
}

fn print_json<T: Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

#[derive(Debug, Deserialize)]
struct RawAlertFile {
    version: String,
    service: String,
    alerts: Vec<RawAlert>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAlert {
    name: String,
    severity: String,
    routing: String,
    evaluation_interval: String,
    window: String,
    summary: String,
    query: String,
}

#[derive(Debug)]
struct ParsedAlertFile {
    alerts: Vec<ParsedAlert>,
}

#[derive(Debug)]
struct ParsedAlert {
    service: String,
    name: String,
    severity: String,
    routing: String,
    window_seconds: u64,
    query: String,
}

struct BoundedEvidence {
    rows: Vec<Value>,
    truncated: bool,
}

#[derive(Debug, Serialize)]
struct AlertsTestOutput {
    filters: AlertTestFilters,
    alerts: Vec<AlertTestResult>,
}

#[derive(Debug, Serialize)]
struct AlertTestFilters {
    target: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AlertTestResult {
    service: String,
    name: String,
    severity: String,
    routing: String,
    firing: bool,
    row_count: usize,
    evidence: Vec<Value>,
    truncated: bool,
}
