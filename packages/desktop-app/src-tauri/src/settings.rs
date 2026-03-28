use anyhow::{anyhow, Result};
use everr_core::assistant::{self, AssistantStatus};
use everr_core::state::{AppSettings, AppState, WizardState};
use tauri::{AppHandle, Emitter, Manager};

use crate::auth::{auth_status_response, clear_pending_auth};
use crate::{
    current_base_url, AssistantSetupResponse, DevResetResponse, RuntimeState, WizardStatusResponse,
    AUTH_CHANGED_EVENT, SETTINGS_CHANGED_EVENT,
};

pub(crate) fn assistant_setup_response(_state: &RuntimeState) -> Result<AssistantSetupResponse> {
    Ok(build_assistant_setup_response(
        assistant::assistant_statuses()?,
    ))
}

pub(crate) fn build_assistant_setup_response(
    assistant_statuses: Vec<AssistantStatus>,
) -> AssistantSetupResponse {
    AssistantSetupResponse { assistant_statuses }
}

pub(crate) fn wizard_status_response(state: &RuntimeState) -> Result<WizardStatusResponse> {
    let wizard_state = current_settings(state)?.wizard_state;

    Ok(build_wizard_status_response(wizard_state))
}

pub(crate) fn build_wizard_status_response(wizard_state: WizardState) -> WizardStatusResponse {
    WizardStatusResponse {
        wizard_completed: wizard_state.wizard_completed,
    }
}

pub(crate) fn current_app_state(state: &RuntimeState) -> Result<AppState> {
    state
        .persisted
        .lock()
        .map_err(|_| anyhow!("failed to lock persisted app state"))
        .map(|persisted| persisted.clone())
}

pub(crate) fn current_settings(state: &RuntimeState) -> Result<AppSettings> {
    Ok(current_app_state(state)?.settings)
}

pub(crate) fn update_persisted_state<F>(state: &RuntimeState, mutate: F) -> Result<()>
where
    F: FnOnce(&mut AppState),
{
    let mut persisted = state
        .persisted
        .lock()
        .map_err(|_| anyhow!("failed to lock persisted app state"))?;
    let mut next = persisted.clone();
    mutate(&mut next);
    state.store.save_state(&next)?;
    *persisted = next;
    Ok(())
}

pub(crate) fn update_settings<F>(state: &RuntimeState, mutate: F) -> Result<()>
where
    F: FnOnce(&mut AppSettings),
{
    update_persisted_state(state, |persisted| mutate(&mut persisted.settings))
}

pub(crate) fn replace_persisted_state(state: &RuntimeState, next: AppState) -> Result<()> {
    let mut persisted = state
        .persisted
        .lock()
        .map_err(|_| anyhow!("failed to lock persisted app state"))?;
    state.store.save_state(&next)?;
    *persisted = next;
    Ok(())
}

pub(crate) fn has_active_session_for_current_base_url(state: &RuntimeState) -> Result<bool> {
    Ok(current_app_state(state)?.session.is_some_and(|session| {
        session.api_base_url.trim_end_matches('/') == current_base_url().trim_end_matches('/')
    }))
}

pub(crate) fn emit_settings_changed(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(SETTINGS_CHANGED_EVENT, ());
    }
}

pub(crate) fn emit_auth_changed(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(AUTH_CHANGED_EVENT, ());
    }
}

pub(crate) fn wizard_incomplete(state: &RuntimeState) -> Result<bool> {
    Ok(!current_settings(state)?.wizard_state.wizard_completed)
}

pub(crate) fn reset_dev_onboarding_inner(state: &RuntimeState) -> Result<DevResetResponse> {
    clear_pending_auth(state)?;
    replace_persisted_state(state, AppState::default())?;

    Ok(DevResetResponse {
        auth_status: auth_status_response(state)?,
        wizard_status: wizard_status_response(state)?,
    })
}

pub(crate) fn open_settings_window(app: &AppHandle) -> Result<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| anyhow!("settings window not found"))?;

    window.show()?;
    window.set_focus()?;

    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    Ok(())
}
