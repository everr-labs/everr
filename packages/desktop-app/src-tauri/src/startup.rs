use std::path::Path;

use anyhow::{Context, Result};
use everr_core::skills::{self as core_skills, SkillOperationOptions, SkillProvider, SkillScope};
use everr_core::state_watcher::StateChange;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tokio::sync::broadcast;

use crate::cli::sync_installed_cli;
use crate::notifications::reset_notification_state;
use crate::settings::{
    current_app_state, emit_auth_changed, emit_settings_changed, update_settings,
};
use crate::RuntimeState;

pub(crate) fn run_local_startup_maintenance(app: &AppHandle) {
    if let Err(error) = sync_installed_cli(app) {
        crate::crash_log::log_error("sync installed CLI", &error);
    }

    if let Err(error) = sync_installed_global_skills() {
        crate::crash_log::log_error("sync installed skills", &error);
    }

    if let Err(error) = ensure_background_launch(app) {
        crate::crash_log::log_error("enable background launch", &error);
    }
}

pub(crate) fn sync_installed_global_skills() -> Result<bool> {
    let home_dir = dirs::home_dir().context("failed to resolve home directory")?;
    let cwd = std::env::current_dir().context("could not determine current directory")?;
    sync_installed_global_skills_from_paths(&home_dir, &cwd)
}

pub(crate) fn sync_installed_global_skills_from_paths(home_dir: &Path, cwd: &Path) -> Result<bool> {
    let probe_options = SkillOperationOptions {
        scope: SkillScope::Global,
        cwd: cwd.to_path_buf(),
        home_dir: home_dir.to_path_buf(),
        providers: SkillProvider::ALL.to_vec(),
        skill_names: Vec::new(),
        all: false,
        dry_run: false,
    };
    if !core_skills::has_installed_bundled_skill(&probe_options)? {
        return Ok(false);
    }

    let summary = core_skills::update_bundled_skills(&probe_options)?;
    Ok(summary.changes.iter().any(|change| {
        !matches!(
            change.action,
            core_skills::SkillPathAction::Unchanged | core_skills::SkillPathAction::Missing
        )
    }))
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
