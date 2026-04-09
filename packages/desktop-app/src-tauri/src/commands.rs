use anyhow::{anyhow, Context, Result};
use everr_core::api::{ApiClient, FailureNotification};
use everr_core::assistant::{self, AssistantKind};
use everr_core::build;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::auth::{
    auth_status_response, clear_pending_auth, open_sign_in_browser_inner, pending_auth_response,
    poll_sign_in_inner, start_sign_in_inner,
};
use crate::auto_fix_prompt::build_notification_auto_fix_prompt;
use crate::notifications::{
    build_test_notification, copy_notification_auto_fix_prompt_inner,
    dismiss_active_notification_inner, open_notification_target_inner, sync_notification_window,
};
use crate::settings::{
    assistant_setup_response, current_app_state, emit_auth_changed, emit_settings_changed,
    has_active_session_for_current_base_url, reset_dev_onboarding_inner, update_persisted_state,
    update_settings, wizard_status_response,
};
use crate::{
    current_base_url, AssistantSetupResponse, AuthStatusResponse, CommandResult, DevResetResponse,
    IntoCommandResult, PendingAuthResponse, RuntimeState, SignInResponse, TestNotificationResponse,
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
pub(crate) async fn get_assistant_setup(
    state: State<'_, RuntimeState>,
) -> CommandResult<AssistantSetupResponse> {
    let state = state.inner().clone();
    run_blocking_command(move || assistant_setup_response(&state)).await
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

    emit_auth_changed(&app);
    emit_settings_changed(&app);

    Ok(response)
}

#[tauri::command]
pub(crate) async fn configure_assistants(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    assistants: Vec<AssistantKind>,
) -> CommandResult<AssistantSetupResponse> {
    let runtime = state.inner().clone();
    let response = run_blocking_command(move || {
        assistant::sync_discovery_assistants(&assistants, build::command_name())?;
        assistant_setup_response(&runtime)
    })
    .await?;

    emit_settings_changed(&app);

    Ok(response)
}
#[tauri::command]
pub(crate) async fn get_notification_emails(
    state: State<'_, RuntimeState>,
) -> CommandResult<Vec<String>> {
    let state = state.inner().clone();
    run_blocking_command(move || {
        Ok(current_app_state(&state)?.settings.notification_emails)
    })
    .await
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
pub(crate) async fn complete_setup_wizard(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<WizardStatusResponse> {
    let runtime = state.inner().clone();

    // Silently cache user profile for the desktop app settings UI
    if let Ok(current) = current_app_state(&runtime) {
        if current.settings.user_profile.is_none() {
            if let Some(session) = current.session {
                if let Ok(client) = everr_core::api::ApiClient::from_session(&session) {
                    if let Ok(me) = client.get_me().await {
                        let _ = run_blocking_command({
                            let runtime = runtime.clone();
                            move || {
                                update_settings(&runtime, |settings| {
                                    settings.user_profile =
                                        Some(everr_core::state::UserProfile {
                                            email: me.email,
                                            name: me.name,
                                            profile_url: me.profile_url,
                                        });
                                })
                            }
                        })
                        .await;
                    }
                }
            }
        }
    }

    let response = run_blocking_command(move || {
        if !has_active_session_for_current_base_url(&runtime)? {
            return Err(anyhow!("Sign in before finishing setup."));
        }
        update_settings(&runtime, |settings| {
            settings.mark_setup_complete(build::default_api_base_url());
        })?;
        wizard_status_response(&runtime)
    })
    .await?;

    emit_settings_changed(&app);
    Ok(response)
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

    state
        .seen_runs
        .add(&notification.trace_id)
        .into_command_result()?;
    let _ = app.emit(SEEN_RUNS_CHANGED_EVENT, ());

    let shown = {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| "failed to lock notifier state".to_string())?;
        notifier.queue.enqueue(notification)
    };

    if shown {
        sync_notification_window(&app, state.inner()).into_command_result()?;
    }

    Ok(TestNotificationResponse {
        status: if shown { "shown" } else { "queued" },
    })
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

    let mut all_runs: Vec<RunListItem> = Vec::new();
    let mut seen_trace_ids: std::collections::HashSet<String> =
        std::collections::HashSet::new();

    for email in &emails {
        let query = vec![("authorEmail".to_string(), email.clone())];
        let query_refs: Vec<(&str, String)> = query
            .iter()
            .map(|(k, v)| (k.as_str(), v.clone()))
            .collect();
        let value = client.get_runs_list(&query_refs).await.into_command_result()?;
        let response: RunsListApiResponse = serde_json::from_value(value)
            .context("failed to parse runs list response")
            .into_command_result()?;
        for run in response.runs {
            if seen_trace_ids.insert(run.trace_id.clone()) {
                all_runs.push(run);
            }
        }
    }

    // Sort by timestamp descending
    all_runs.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(all_runs)
}

#[tauri::command]
pub(crate) fn get_unseen_trace_ids(
    state: State<'_, RuntimeState>,
) -> CommandResult<Vec<String>> {
    state.seen_runs.unseen_trace_ids().into_command_result()
}

#[tauri::command]
pub(crate) fn mark_run_seen(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    trace_id: String,
) -> CommandResult<()> {
    state
        .seen_runs
        .mark_seen(&trace_id)
        .into_command_result()?;
    let _ = app.emit(SEEN_RUNS_CHANGED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub(crate) fn mark_all_runs_seen(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<()> {
    state.seen_runs.mark_all_seen().into_command_result()?;
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
    let url = format!("{}/trace/{}", base_url, trace_id);
    webbrowser::open(&url).map_err(|e| format!("failed to open browser: {e}"))?;

    state
        .seen_runs
        .mark_seen(&trace_id)
        .into_command_result()?;
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

    state
        .seen_runs
        .mark_seen(&trace_id)
        .into_command_result()?;
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
