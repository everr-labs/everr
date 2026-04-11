use std::time::Duration;

use anyhow::Result;
use everr_core::state_watcher::StateChange;
use everr_core::{assistant, build};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::broadcast;

use crate::cli::sync_installed_cli;
use crate::notifications::reset_notification_state;
use crate::settings::{current_app_state, emit_auth_changed, emit_settings_changed, update_settings};
use crate::{should_check_for_updates, RuntimeState, UPDATE_CHECK_INTERVAL_SECONDS};

pub(crate) fn run_local_startup_maintenance(app: &AppHandle) {
    if let Err(error) = sync_installed_cli(app) {
        crate::crash_log::log_error("sync installed CLI", &error);
    }

    if let Err(error) = ensure_background_launch(app) {
        crate::crash_log::log_error("enable background launch", &error);
    }

    if let Err(error) = assistant::refresh_existing_managed_prompts(build::command_name()) {
        crate::crash_log::log_error("refresh assistant instructions", &error);
    }
}

fn ensure_background_launch(app: &AppHandle) -> Result<()> {
    if tauri::is_dev() {
        return Ok(());
    }

    let autostart = app.autolaunch();
    if !autostart.is_enabled()? {
        autostart.enable()?;
    }

    Ok(())
}

pub(crate) fn start_state_change_loop(app: AppHandle, state: RuntimeState) {
    tauri::async_runtime::spawn(async move {
        cache_user_profile_if_needed(&state).await;

        let mut rx = state.watcher.subscribe();
        loop {
            match rx.recv().await {
                Ok(change) => {
                    if matches!(change, StateChange::SessionChanged) {
                        cache_user_profile_if_needed(&state).await;
                    }
                    handle_state_change(&app, &state, change);
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    crate::crash_log::log_error(
                        "state change loop",
                        &anyhow::anyhow!("lagged {n} events, re-syncing"),
                    );
                    cache_user_profile_if_needed(&state).await;
                    handle_state_change(&app, &state, StateChange::SessionChanged);
                    handle_state_change(&app, &state, StateChange::SettingsChanged);
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

async fn cache_user_profile_if_needed(state: &RuntimeState) {
    let Ok(current) = current_app_state(state) else {
        return;
    };
    if current.settings.user_profile.is_some() {
        return;
    }
    let Some(session) = current.session else {
        return;
    };
    let Ok(client) = everr_core::api::ApiClient::from_session(&session) else {
        return;
    };
    let Ok(me) = client.get_me().await else {
        return;
    };
    let _ = update_settings(state, |settings| {
        settings.user_profile = Some(everr_core::state::UserProfile {
            email: me.email,
            name: me.name,
            profile_url: me.profile_url,
        });
    });
}

fn handle_state_change(app: &AppHandle, state: &RuntimeState, change: StateChange) {
    match change {
        StateChange::SessionChanged => {
            if let Err(error) = reset_notification_state(app, state) {
                crate::crash_log::log_error("reset notification state", &error);
            }
            emit_auth_changed(app);
        }
        StateChange::SettingsChanged => {
            emit_settings_changed(app);
        }
        StateChange::EmailsChanged => {
            // Handled by notifier loop's own subscriber
        }
    }
}

pub(crate) fn start_update_check_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let settings_open = app
                .get_webview_window("main")
                .and_then(|window| window.is_visible().ok())
                .unwrap_or(false);

            if !settings_open {
                let update_installed = match install_update_if_available(&app).await {
                    Ok(installed) => installed,
                    Err(error) => {
                        crate::crash_log::log_error("update check", &error);
                        false
                    }
                };

                if update_installed {
                    app.request_restart();
                }
            }

            tokio::time::sleep(Duration::from_secs(UPDATE_CHECK_INTERVAL_SECONDS)).await;
        }
    });
}

async fn install_update_if_available(app: &AppHandle) -> Result<bool> {
    if !should_check_for_updates() {
        return Ok(false);
    }

    let updater = app.updater()?;

    let Some(update) = updater.check().await? else {
        return Ok(false);
    };

    update.download_and_install(|_, _| {}, || {}).await?;
    Ok(true)
}
