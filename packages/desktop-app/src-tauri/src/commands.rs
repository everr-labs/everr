use anyhow::{Context, Result};
use everr_core::api::{ApiClient, FailureNotification};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

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
use crate::seen_runs;
use crate::settings::{
    current_app_state, emit_auth_changed, emit_settings_changed, reset_dev_onboarding_inner,
    update_persisted_state, update_settings, wizard_status_response,
};
use crate::{
    current_base_url, AuthStatusResponse, CommandResult, DevResetResponse, IntoCommandResult,
    PendingAuthResponse, RuntimeState, SignInResponse, TestNotificationResponse,
    WizardStatusResponse, SEEN_RUNS_CHANGED_EVENT,
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
pub(crate) async fn reset_dev_onboarding(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<DevResetResponse> {
    if !tauri::is_dev() {
        return Err("developer reset is only available in dev builds".to_string());
    }

    let runtime = state.inner().clone();
    let response = run_blocking_command(move || reset_dev_onboarding_inner(&runtime)).await?;

    reset_notification_state(&app, state.inner()).into_command_result()?;
    emit_auth_changed(&app);
    emit_settings_changed(&app);

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
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunsListApiResponse {
    runs: Vec<RunListItem>,
    #[allow(dead_code)]
    total_count: u64,
}

#[tauri::command]
pub(crate) async fn get_runs_list(
    state: State<'_, RuntimeState>,
    from: String,
    to: String,
) -> CommandResult<Vec<RunListItem>> {
    let state = state.inner().clone();
    let app_state = current_app_state(&state).into_command_result()?;
    let session = app_state
        .session
        .ok_or_else(|| "not signed in".to_string())?;
    let client = ApiClient::from_session(&session).into_command_result()?;

    let emails: Vec<String> = {
        let settings = app_state.settings;
        if !settings.notification_emails.is_empty() {
            settings.notification_emails
        } else if let Some(profile) = settings.user_profile {
            vec![profile.email]
        } else {
            vec![]
        }
    };

    let mut query: Vec<(&str, String)> = emails
        .iter()
        .map(|email| ("authorEmails", email.clone()))
        .collect();
    query.push(("from", from));
    if !to.is_empty() {
        query.push(("to", to));
    }

    let value = client.get_runs_list(&query).await.into_command_result()?;
    let response: RunsListApiResponse = serde_json::from_value(value)
        .context("failed to parse runs list response")
        .into_command_result()?;

    Ok(response.runs)
}

#[tauri::command]
pub(crate) fn get_unseen_trace_ids(state: State<'_, RuntimeState>) -> CommandResult<Vec<String>> {
    seen_runs::unseen_trace_ids(state.inner()).into_command_result()
}

#[tauri::command]
pub(crate) fn mark_run_seen(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    trace_id: String,
) -> CommandResult<()> {
    seen_runs::mark_seen(state.inner(), &trace_id).into_command_result()?;
    let _ = app.emit(SEEN_RUNS_CHANGED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub(crate) fn mark_all_runs_seen(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<()> {
    seen_runs::mark_all_seen(state.inner()).into_command_result()?;
    let _ = app.emit(SEEN_RUNS_CHANGED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_run_in_browser(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    trace_id: String,
) -> CommandResult<()> {
    let base_url = current_base_url().trim_end_matches('/');
    let url = format!("{}/runs/{}", base_url, trace_id);
    webbrowser::open(&url).map_err(|e| format!("failed to open browser: {e}"))?;

    seen_runs::mark_seen(state.inner(), &trace_id).into_command_result()?;
    let _ = app.emit(SEEN_RUNS_CHANGED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub(crate) async fn copy_run_auto_fix_prompt(
    app: AppHandle,
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

    seen_runs::mark_seen(state.inner(), &trace_id).into_command_result()?;
    let _ = app.emit(SEEN_RUNS_CHANGED_EVENT, ());
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
