use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use chrono::{DateTime, NaiveDateTime};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::time::sleep;

use crate::api::ApiClient;
use crate::auth;
use crate::cli::NotifyDaemonArgs;
use crate::daemon;
use crate::notifications;

#[derive(Debug, Deserialize)]
struct RunsListResponse {
    runs: Vec<RunItem>,
}

#[derive(Debug, Deserialize)]
struct RunItem {
    #[serde(rename = "runId")]
    run_id: String,
    #[serde(rename = "traceId")]
    trace_id: String,
    #[serde(rename = "workflowName")]
    workflow_name: String,
    repo: String,
    branch: String,
    conclusion: String,
    timestamp: String,
    #[serde(rename = "headSha")]
    head_sha: String,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct NotifyState {
    last_alert_key: Option<String>,
    last_alert_at_unix: Option<u64>,
    last_poll_at_unix: Option<u64>,
}

pub async fn run_daemon(args: NotifyDaemonArgs) -> Result<()> {
    if args.interval_seconds == 0 {
        bail!("--interval-seconds must be greater than 0");
    }

    let session = auth::require_session()?;
    let client = ApiClient::from_session(&session)?;

    loop {
        run_poll_cycle(&client).await?;
        if args.once {
            break;
        }
        sleep(Duration::from_secs(args.interval_seconds)).await;
    }

    Ok(())
}

pub fn status() -> Result<()> {
    let service_installed = daemon::is_service_installed()?;
    let service_path = daemon::service_path()?;
    let state = load_state().unwrap_or_default();

    let output = json!({
        "serviceInstalled": service_installed,
        "servicePath": service_path.display().to_string(),
        "state": state,
    });
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}

async fn run_poll_cycle(client: &ApiClient) -> Result<()> {
    let mut state = load_state().unwrap_or_default();
    let poll_started_unix = now_unix();
    let last_poll_unix = state.last_poll_at_unix.unwrap_or(poll_started_unix);

    let from_expr = relative_from_expr(last_poll_unix, poll_started_unix);
    let payload = client
        .get_runs_list(&[
            ("page", "1".to_string()),
            ("from", from_expr),
            ("to", "now".to_string()),
        ])
        .await?;

    let parsed: RunsListResponse =
        serde_json::from_value(payload).context("failed to decode list_runs output")?;
    for run in parsed.runs.iter().filter(|r| r.conclusion == "failure") {
        let run_ts = parse_run_timestamp_unix(&run.timestamp).unwrap_or(0);
        if run_ts < last_poll_unix {
            continue;
        }

        let authored_commit_match = is_commit_authored_by_current_user(&run.head_sha)?;

        if !authored_commit_match {
            continue;
        }

        let key = format!("{}|{}|{}|failure", run.repo, run.branch, run.run_id);
        if state.last_alert_key.as_deref() == Some(key.as_str()) {
            continue;
        }

        send_failure_notification(run);
        state.last_alert_key = Some(key);
        state.last_alert_at_unix = Some(now_unix());
        break;
    }

    state.last_poll_at_unix = Some(now_unix());
    save_state(&state)?;
    Ok(())
}

fn load_state() -> Result<NotifyState> {
    let path = state_file_path()?;
    if !path.exists() {
        return Ok(NotifyState::default());
    }
    let raw =
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))?;
    let state =
        serde_json::from_str::<NotifyState>(&raw).context("failed to parse notify state JSON")?;
    Ok(state)
}

fn save_state(state: &NotifyState) -> Result<()> {
    let path = state_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let body = serde_json::to_string_pretty(state).context("failed to encode notify state")?;
    fs::write(&path, body).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn state_file_path() -> Result<PathBuf> {
    let config = dirs::config_dir().context("failed to resolve config dir")?;
    Ok(config.join("everr").join("notify-state.json"))
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn parse_run_timestamp_unix(raw: &str) -> Option<u64> {
    parse_datetime_unix(raw)
}

fn relative_from_expr(last_poll_unix: u64, now_unix: u64) -> String {
    if last_poll_unix >= now_unix {
        return "now".to_string();
    }
    let delta = now_unix - last_poll_unix;
    format!("now-{delta}s")
}

fn is_commit_authored_by_current_user(sha: &str) -> Result<bool> {
    if sha.trim().is_empty() {
        return Ok(false);
    }

    let user_email = run_git_global(["config", "--global", "--get", "user.email"])
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty());
    let Some(user_email) = user_email else {
        return Ok(false);
    };

    let output = Command::new("git")
        .args(["show", "-s", "--format=%ae%n%ce", sha])
        .output()
        .context("failed to inspect commit author")?;
    if !output.status.success() {
        return Ok(false);
    }

    let stdout = String::from_utf8(output.stdout).context("git show output was not UTF-8")?;
    let matches = stdout.lines().any(|line| {
        let email = line.trim().to_ascii_lowercase();
        !email.is_empty() && email == user_email
    });
    Ok(matches)
}

fn run_git_global<const N: usize>(args: [&str; N]) -> Option<String> {
    let output = Command::new("git").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_datetime_unix(raw: &str) -> Option<u64> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Some(dt.timestamp() as u64);
    }
    let formats = ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%d %H:%M:%S"];
    for fmt in formats {
        if let Ok(dt) = NaiveDateTime::parse_from_str(raw, fmt) {
            return Some(dt.and_utc().timestamp() as u64);
        }
    }
    None
}

fn send_failure_notification(run: &RunItem) {
    #[cfg(target_os = "macos")]
    {
        let _ = notifications::send(
            "Everr: Failing pipeline",
            &format!("{} ({})", run.repo, run.branch),
            &format!(
                "{} failed (run {}, trace {}).",
                run.workflow_name, run.run_id, run.trace_id
            ),
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = run;
    }
}
