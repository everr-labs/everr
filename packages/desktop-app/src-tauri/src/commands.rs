use anyhow::{Context, Result};
use everr_core::api::{ApiClient, FailureNotification};
use everr_core::skills::{self as core_skills, SkillOperationOptions, SkillProvider, SkillScope};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::auth::{
    auth_status_response, clear_pending_auth, open_sign_in_browser_inner, pending_auth_response,
    poll_sign_in_inner, start_sign_in_inner,
};
use crate::auto_fix_prompt::build_notification_auto_fix_prompt;
use crate::notifications::{
    build_test_notification, copy_notification_auto_fix_prompt_inner,
    dismiss_active_notification_inner, enqueue_notification, open_notification_target_inner,
    reset_notification_state,
};
use crate::settings::{
    current_app_state, emit_auth_changed, emit_settings_changed, update_persisted_state,
    update_settings, wizard_status_response,
};
use crate::telemetry::sidecar::{CollectorStatusResponse, Sidecar};
use crate::update::{apply_pending_update, pending_update_version};
use crate::{
    current_base_url, AuthStatusResponse, CommandResult, IntoCommandResult, PendingAuthResponse,
    RuntimeState, SignInResponse, TestNotificationResponse, WizardStatusResponse,
};

#[tauri::command]
pub(crate) async fn get_auth_status(
    state: State<'_, RuntimeState>,
) -> CommandResult<AuthStatusResponse> {
    let state = state.inner().clone();
    run_blocking_command(move || auth_status_response(&state)).await
}

#[tauri::command]
pub(crate) async fn get_wizard_status(
    state: State<'_, RuntimeState>,
) -> CommandResult<WizardStatusResponse> {
    let state = state.inner().clone();
    run_blocking_command(move || wizard_status_response(&state)).await
}

#[tauri::command]
pub(crate) fn get_active_notification(
    state: State<'_, RuntimeState>,
) -> CommandResult<Option<FailureNotification>> {
    let notifier = state
        .notifier
        .lock()
        .map_err(|_| "failed to lock notifier state".to_string())?;
    Ok(notifier.queue.active().cloned())
}

#[tauri::command]
pub(crate) async fn start_sign_in(state: State<'_, RuntimeState>) -> CommandResult<SignInResponse> {
    let state = state.inner().clone();
    start_sign_in_inner(state).await.into_command_result()
}

#[tauri::command]
pub(crate) fn get_pending_sign_in(
    state: State<'_, RuntimeState>,
) -> CommandResult<Option<PendingAuthResponse>> {
    pending_auth_response(state.inner()).into_command_result()
}

#[tauri::command]
pub(crate) async fn poll_sign_in(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<SignInResponse> {
    let runtime = state.inner().clone();
    poll_sign_in_inner(app, runtime).await.into_command_result()
}

#[tauri::command]
pub(crate) fn open_sign_in_browser(state: State<'_, RuntimeState>) -> CommandResult<()> {
    open_sign_in_browser_inner(state.inner()).into_command_result()
}

#[tauri::command]
pub(crate) async fn sign_out(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<AuthStatusResponse> {
    let runtime = state.inner().clone();
    let runtime_for_command = runtime.clone();
    let response = run_blocking_command(move || {
        update_persisted_state(&runtime_for_command, |persisted| {
            persisted.session = None;
        })?;
        auth_status_response(&runtime_for_command)
    })
    .await?;

    clear_pending_auth(&runtime).into_command_result()?;

    reset_notification_state(&app, state.inner()).into_command_result()?;
    emit_auth_changed(&app);

    Ok(response)
}

#[tauri::command]
pub(crate) async fn get_notification_emails(
    state: State<'_, RuntimeState>,
) -> CommandResult<Vec<String>> {
    let state = state.inner().clone();
    run_blocking_command(move || Ok(current_app_state(&state)?.settings.notification_emails)).await
}

#[tauri::command]
pub(crate) async fn set_notification_emails(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    emails: Vec<String>,
) -> CommandResult<()> {
    let runtime = state.inner().clone();
    run_blocking_command(move || {
        update_settings(&runtime, |settings| {
            settings.notification_emails = emails;
        })
    })
    .await?;
    emit_settings_changed(&app);
    Ok(())
}

#[derive(Serialize)]
pub(crate) struct SkillProviderState {
    pub provider: String,
    pub display_name: String,
    pub detected: bool,
    pub installed: bool,
}

fn parse_skill_provider(value: &str) -> Result<SkillProvider> {
    SkillProvider::ALL
        .into_iter()
        .find(|provider| provider.as_str() == value)
        .with_context(|| format!("unknown skill provider: {value}"))
}

#[tauri::command]
pub(crate) async fn get_skills_status() -> CommandResult<Vec<SkillProviderState>> {
    run_blocking_command(move || {
        let home_dir = dirs::home_dir().context("failed to resolve home directory")?;
        let bundled = core_skills::bundled_skills()?;
        let states = core_skills::provider_statuses(&home_dir)
            .into_iter()
            .map(|status| {
                let provider_dir = std::path::PathBuf::from(&status.path);
                let installed = bundled
                    .iter()
                    .any(|skill| provider_dir.join(&skill.name).join("SKILL.md").is_file());
                SkillProviderState {
                    provider: status.provider.as_str().to_string(),
                    display_name: status.provider.display_name().to_string(),
                    detected: status.detected,
                    installed,
                }
            })
            .collect();
        Ok(states)
    })
    .await
}

#[tauri::command]
pub(crate) async fn install_skills(app: AppHandle, providers: Vec<String>) -> CommandResult<()> {
    run_blocking_command(move || {
        let home_dir = dirs::home_dir().context("failed to resolve home directory")?;
        let cwd = std::env::current_dir().context("could not determine current directory")?;
        let providers = providers
            .iter()
            .map(|value| parse_skill_provider(value))
            .collect::<Result<Vec<_>>>()?;
        let options = SkillOperationOptions {
            scope: SkillScope::Global,
            cwd,
            home_dir,
            providers,
            skill_names: Vec::new(),
            all: true,
            dry_run: false,
        };
        core_skills::install_bundled_skills(&options)?;
        Ok(())
    })
    .await?;
    emit_settings_changed(&app);
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct UserProfileResponse {
    pub email: String,
    pub name: String,
    pub profile_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct BuildInfoResponse {
    pub platform_version: &'static str,
    pub release_sha: &'static str,
    pub release_short_sha: &'static str,
}

#[tauri::command]
pub(crate) fn get_build_info() -> CommandResult<BuildInfoResponse> {
    Ok(BuildInfoResponse {
        platform_version: env!("EVERR_VERSION"),
        release_sha: env!("EVERR_RELEASE_SHA"),
        release_short_sha: env!("EVERR_RELEASE_SHORT_SHA"),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct PendingUpdateResponse {
    pub version: String,
}

#[tauri::command]
pub(crate) fn get_pending_update(app: AppHandle) -> CommandResult<Option<PendingUpdateResponse>> {
    Ok(pending_update_version(&app).map(|version| PendingUpdateResponse { version }))
}

#[tauri::command]
pub(crate) async fn install_pending_update(app: AppHandle) -> CommandResult<()> {
    apply_pending_update(app, "sidebar")
        .await
        .into_command_result()
}

/// Dev-only: simulate or clear a staged update so the update UI can be exercised
/// without a real release. `version: None` clears it. No-op in release builds.
#[tauri::command]
pub(crate) fn set_simulated_update(app: AppHandle, version: Option<String>) -> CommandResult<()> {
    crate::update::set_simulated_update(&app, version);
    Ok(())
}

#[tauri::command]
pub(crate) fn get_collector_status(
    sidecar: State<'_, Sidecar>,
) -> CommandResult<CollectorStatusResponse> {
    Ok(sidecar.status())
}

#[tauri::command]
pub(crate) async fn restart_collector(
    sidecar: State<'_, Sidecar>,
) -> CommandResult<CollectorStatusResponse> {
    Ok(sidecar.restart().await)
}

#[tauri::command]
pub(crate) async fn get_user_profile(
    state: State<'_, RuntimeState>,
) -> CommandResult<Option<UserProfileResponse>> {
    let state = state.inner().clone();
    run_blocking_command(move || {
        let profile = current_app_state(&state)?.settings.user_profile;
        Ok(profile.map(|p| UserProfileResponse {
            email: p.email,
            name: p.name,
            profile_url: p.profile_url,
        }))
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct OrgInfoResponse {
    pub name: String,
}

#[tauri::command]
pub(crate) async fn get_org(
    state: State<'_, RuntimeState>,
) -> CommandResult<Option<OrgInfoResponse>> {
    let state = state.inner().clone();
    let app_state = current_app_state(&state).into_command_result()?;
    let Some(session) = app_state.session else {
        return Ok(None);
    };
    let client = ApiClient::from_session(&session).into_command_result()?;
    let org = client.get_org().await.into_command_result()?;

    Ok(Some(OrgInfoResponse { name: org.name }))
}

#[tauri::command]
pub(crate) fn dismiss_active_notification(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<()> {
    dismiss_active_notification_inner(&app, state.inner()).into_command_result()
}

#[tauri::command]
pub(crate) fn open_notification_target(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<()> {
    open_notification_target_inner(&app, state.inner()).into_command_result()
}

#[tauri::command]
pub(crate) fn copy_notification_auto_fix_prompt(
    state: State<'_, RuntimeState>,
) -> CommandResult<()> {
    copy_notification_auto_fix_prompt_inner(state.inner()).into_command_result()
}

#[tauri::command]
pub(crate) fn trigger_test_notification(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<TestNotificationResponse> {
    let notification = build_test_notification().into_command_result()?;
    enqueue_notification(&app, state.inner(), notification).into_command_result()?;

    Ok(TestNotificationResponse { status: "queued" })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunListItem {
    pub trace_id: String,
    pub run_id: String,
    pub run_attempt: u32,
    pub workflow_name: String,
    pub repo: String,
    pub branch: String,
    pub conclusion: String,
    pub duration: u64,
    pub timestamp: String,
    pub sender: String,
    pub display_title: Option<String>,
    pub head_sha: Option<String>,
    pub running_since: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunsListApiResponse {
    runs: Vec<RunListItem>,
    #[serde(default)]
    total_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunsListResponse {
    pub runs: Vec<RunListItem>,
    pub total_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunHistogramBucket {
    pub timestamp: String,
    pub end_timestamp: String,
    pub total: u64,
    pub success: u64,
    pub failure: u64,
    pub cancellation: u64,
    pub other: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunFilterOptions {
    pub repos: Vec<String>,
    pub branches: Vec<String>,
    pub workflow_names: Vec<String>,
}

/// Resolve the author emails used to scope runs to the signed-in user.
/// Reuses the notification-emails / profile-email preference order.
fn author_emails_from_settings(settings: &everr_core::state::AppSettings) -> Vec<String> {
    if !settings.notification_emails.is_empty() {
        settings.notification_emails.clone()
    } else if let Some(profile) = &settings.user_profile {
        vec![profile.email.clone()]
    } else {
        vec![]
    }
}

/// Append `authorEmails` query pairs only when scoping to the current user.
fn push_author_filter(
    query: &mut Vec<(&'static str, String)>,
    settings: &everr_core::state::AppSettings,
    only_mine: bool,
) {
    if !only_mine {
        return;
    }
    for email in author_emails_from_settings(settings) {
        query.push(("authorEmails", email));
    }
}

/// Append one query pair per value for a repeated plural filter.
fn push_repeated(
    query: &mut Vec<(&'static str, String)>,
    key: &'static str,
    values: &Option<Vec<String>>,
) {
    if let Some(values) = values {
        for value in values {
            query.push((key, value.clone()));
        }
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn get_runs_list(
    state: State<'_, RuntimeState>,
    from: String,
    to: String,
    limit: Option<u32>,
    offset: Option<u32>,
    repos: Option<Vec<String>>,
    branches: Option<Vec<String>>,
    conclusions: Option<Vec<String>>,
    workflow_names: Option<Vec<String>>,
    run_id: Option<String>,
    only_mine: bool,
    include_total_count: Option<bool>,
) -> CommandResult<RunsListResponse> {
    let state = state.inner().clone();
    let app_state = current_app_state(&state).into_command_result()?;
    let session = app_state
        .session
        .clone()
        .ok_or_else(|| "not signed in".to_string())?;
    let client = ApiClient::from_session(&session).into_command_result()?;

    let mut query: Vec<(&'static str, String)> = Vec::new();
    query.push(("from", from));
    if !to.is_empty() {
        query.push(("to", to));
    }
    push_author_filter(&mut query, &app_state.settings, only_mine);
    if let Some(limit) = limit {
        query.push(("limit", limit.to_string()));
    }
    if let Some(offset) = offset {
        query.push(("offset", offset.to_string()));
    }
    push_repeated(&mut query, "repos", &repos);
    push_repeated(&mut query, "branches", &branches);
    push_repeated(&mut query, "conclusions", &conclusions);
    push_repeated(&mut query, "workflowNames", &workflow_names);
    if let Some(run_id) = run_id {
        query.push(("runId", run_id));
    }
    if let Some(include_total_count) = include_total_count {
        query.push((
            "includeTotalCount",
            if include_total_count { "true" } else { "false" }.to_string(),
        ));
    }

    let value = client.get_runs_list(&query).await.into_command_result()?;
    let response: RunsListApiResponse = serde_json::from_value(value)
        .context("failed to parse runs list response")
        .into_command_result()?;

    Ok(RunsListResponse {
        runs: response.runs,
        total_count: response.total_count,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn get_runs_histogram(
    state: State<'_, RuntimeState>,
    from: String,
    to: String,
    repos: Option<Vec<String>>,
    branches: Option<Vec<String>>,
    conclusions: Option<Vec<String>>,
    workflow_names: Option<Vec<String>>,
    run_id: Option<String>,
    only_mine: bool,
    histogram_buckets: Option<u32>,
) -> CommandResult<Vec<RunHistogramBucket>> {
    let state = state.inner().clone();
    let app_state = current_app_state(&state).into_command_result()?;
    let session = app_state
        .session
        .clone()
        .ok_or_else(|| "not signed in".to_string())?;
    let client = ApiClient::from_session(&session).into_command_result()?;

    let mut query: Vec<(&'static str, String)> = Vec::new();
    query.push(("from", from));
    if !to.is_empty() {
        query.push(("to", to));
    }
    push_author_filter(&mut query, &app_state.settings, only_mine);
    push_repeated(&mut query, "repos", &repos);
    push_repeated(&mut query, "branches", &branches);
    push_repeated(&mut query, "conclusions", &conclusions);
    push_repeated(&mut query, "workflowNames", &workflow_names);
    if let Some(run_id) = run_id {
        query.push(("runId", run_id));
    }
    if let Some(histogram_buckets) = histogram_buckets {
        query.push(("histogramBuckets", histogram_buckets.to_string()));
    }

    let value = client
        .get_runs_histogram(&query)
        .await
        .into_command_result()?;
    let buckets: Vec<RunHistogramBucket> = serde_json::from_value(value)
        .context("failed to parse runs histogram response")
        .into_command_result()?;

    Ok(buckets)
}

#[tauri::command]
pub(crate) async fn get_run_filter_options(
    state: State<'_, RuntimeState>,
    from: String,
    to: String,
) -> CommandResult<RunFilterOptions> {
    let state = state.inner().clone();
    let app_state = current_app_state(&state).into_command_result()?;
    let session = app_state
        .session
        .clone()
        .ok_or_else(|| "not signed in".to_string())?;
    let client = ApiClient::from_session(&session).into_command_result()?;

    let mut query: Vec<(&'static str, String)> = Vec::new();
    query.push(("from", from));
    if !to.is_empty() {
        query.push(("to", to));
    }

    let value = client
        .get_run_filter_options(&query)
        .await
        .into_command_result()?;
    let options: RunFilterOptions = serde_json::from_value(value)
        .context("failed to parse run filter options response")
        .into_command_result()?;

    Ok(options)
}

#[tauri::command]
pub(crate) async fn open_run_in_browser(trace_id: String) -> CommandResult<()> {
    let base_url = current_base_url().trim_end_matches('/');
    let url = format!("{}/runs/{}", base_url, trace_id);
    webbrowser::open(&url).map_err(|e| format!("failed to open browser: {e}"))?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn copy_run_auto_fix_prompt(
    state: State<'_, RuntimeState>,
    trace_id: String,
) -> CommandResult<()> {
    let state_clone = state.inner().clone();
    let app_state = current_app_state(&state_clone).into_command_result()?;
    let session = app_state
        .session
        .ok_or_else(|| "not signed in".to_string())?;
    let client = ApiClient::from_session(&session).into_command_result()?;

    let failure = client
        .get_notification_for_trace(&trace_id)
        .await
        .into_command_result()?
        .ok_or_else(|| "run not found".to_string())?;

    let prompt = build_notification_auto_fix_prompt(&failure);
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("failed to access clipboard: {e}"))?;
    clipboard
        .set_text(prompt)
        .map_err(|e| format!("failed to copy to clipboard: {e}"))?;

    Ok(())
}

async fn run_blocking_command<T, F>(operation: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| error.to_string())?
        .into_command_result()
}
