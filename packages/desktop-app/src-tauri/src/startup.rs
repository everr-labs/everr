use std::time::Duration;

use anyhow::Result;
use everr_core::{assistant, build};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_updater::UpdaterExt;

use crate::cli::sync_installed_cli;
use crate::settings::{emit_auth_changed, emit_settings_changed};
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

pub(crate) fn start_session_poll_loop(app: AppHandle, state: RuntimeState) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;

            let Ok(file_state) = state.store.load_state() else {
                continue;
            };

            let (session_changed, emails_changed) = {
                let Ok(mut persisted) = state.persisted.lock() else {
                    continue;
                };

                let session_changed = file_state.session != persisted.session;
                let emails_changed = file_state.settings.notification_emails
                    != persisted.settings.notification_emails;

                if session_changed || emails_changed {
                    *persisted = file_state;
                }

                (session_changed, emails_changed)
            };

            if session_changed {
                state.session_changed.notify_one();
                emit_auth_changed(&app);
            }

            if emails_changed {
                state.emails_changed.notify_one();
                emit_settings_changed(&app);
            }
        }
    });
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
