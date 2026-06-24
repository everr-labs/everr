use std::io::Write;
use std::sync::Mutex;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tempfile::NamedTempFile;

use crate::tray::{refresh_tray_icon, refresh_update_menu_item};
use crate::{should_check_for_updates, UPDATE_AVAILABLE_EVENT, UPDATE_CHECK_INTERVAL_SECONDS};

/// A downloaded-but-not-yet-installed update. The verified artifact bytes live
/// in a temp file (auto-deleted on drop) rather than in RAM, because the app may
/// wait hours or days for the user to apply it and the macOS archive is large.
struct PendingUpdate {
    version: String,
    update: Update,
    artifact: NamedTempFile,
}

#[derive(Default)]
pub(crate) struct PendingUpdateState {
    staged: Mutex<Option<PendingUpdate>>,
    /// Dev-only: a simulated staged version set from the Developer page. Lets the
    /// update UI (sidebar control, tray badge + menu item) be exercised without a
    /// real release. Never installable — [`apply_pending_update`] only reads
    /// `staged`.
    simulated: Mutex<Option<String>>,
}

impl PendingUpdateState {
    /// The real staged version, if any. Used for idempotent re-staging.
    fn staged_version(&self) -> Option<String> {
        self.staged
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|pending| pending.version.clone()))
    }

    /// The version the update UI should reflect: a real staged update, falling
    /// back to the dev-simulated one.
    fn display_version(&self) -> Option<String> {
        self.staged_version()
            .or_else(|| self.simulated.lock().ok().and_then(|guard| guard.as_ref().cloned()))
    }
}

#[derive(Clone, Serialize)]
struct UpdateAvailablePayload {
    version: String,
}

/// The version currently staged, if any. Used by the `get_pending_update` command
/// so a window opened *after* an update was staged renders the control.
pub(crate) fn pending_update_version(app: &AppHandle) -> Option<String> {
    app.state::<PendingUpdateState>().display_version()
}

/// Reflect the current update state on every surface: the tray menu item, the
/// tray icon badge, and the main window (via [`UPDATE_AVAILABLE_EVENT`]). The
/// single definition of "which surfaces show update state", so the real-staging
/// and dev-simulate paths can't drift. Reads the authoritative display version
/// itself, so callers don't have to pass it.
fn refresh_update_surfaces(app: &AppHandle) {
    let display = pending_update_version(app);
    refresh_update_menu_item(app, display.as_deref());
    refresh_tray_icon(app, display.is_some());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(
            UPDATE_AVAILABLE_EVENT,
            UpdateAvailablePayload {
                version: display.unwrap_or_default(),
            },
        );
    }
}

/// Dev-only: set or clear a simulated staged update, then refresh every surface
/// that reflects update state. No-op in release builds — the simulated state must
/// never appear to real users.
pub(crate) fn set_simulated_update(app: &AppHandle, version: Option<String>) {
    if !tauri::is_dev() {
        return;
    }

    if let Ok(mut guard) = app.state::<PendingUpdateState>().simulated.lock() {
        *guard = version;
    }

    refresh_update_surfaces(app);
}

pub(crate) fn start_update_check_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(error) = stage_update_if_available(&app).await {
                crate::crash_log::log_error("update check", &error);
            }

            tokio::time::sleep(Duration::from_secs(UPDATE_CHECK_INTERVAL_SECONDS)).await;
        }
    });
}

/// Detect + download + stage the latest update. Never installs. Idempotent: if
/// the latest available version is already staged, it does nothing (the updater
/// keeps reporting the new version while we still run the old binary).
async fn stage_update_if_available(app: &AppHandle) -> Result<()> {
    if !should_check_for_updates() {
        return Ok(());
    }

    let updater = app.updater()?;
    let Some(update) = updater.check().await? else {
        return Ok(());
    };

    if app.state::<PendingUpdateState>().staged_version().as_deref() == Some(update.version.as_str())
    {
        return Ok(());
    }

    let bytes = update.download(|_, _| {}, || {}).await?;

    let mut artifact = NamedTempFile::new().context("failed to create update temp file")?;
    artifact
        .write_all(&bytes)
        .context("failed to write update artifact")?;
    artifact.flush().context("failed to flush update artifact")?;

    log_app_update_staged(&update);

    {
        let state = app.state::<PendingUpdateState>();
        let mut guard = state
            .staged
            .lock()
            .map_err(|_| anyhow!("pending update state poisoned"))?;
        // Replacing an older staged update drops its temp file (deleting it).
        *guard = Some(PendingUpdate {
            version: update.version.clone(),
            update,
            artifact,
        });
    }

    refresh_update_surfaces(app);

    Ok(())
}

/// Install the staged update and restart. Shared by the tray menu handler and
/// the `install_pending_update` command.
///
/// `install()` is synchronous and, in a protected install location, dispatches
/// an admin-prompt AppleScript onto the **main thread** and blocks until it
/// finishes. It must therefore run off the main thread (via `spawn_blocking`) or
/// it would deadlock when triggered from the tray menu handler (which runs on
/// the main thread). A failed *install* never loses the download — the staged
/// state is cleared only on success. The exception is a vanished artifact (e.g.
/// the OS temp cleaner removed the temp file): that entry is dropped and a fresh
/// download is kicked off in the background so the user can retry.
///
/// Benign race: if the check loop restages a newer version between the snapshot
/// below and the install, the user simply gets the newer (or a one-cycle-stale)
/// build. Not worth holding the lock across the blocking install to prevent.
pub(crate) async fn apply_pending_update(app: AppHandle, trigger: &'static str) -> Result<()> {
    let read = {
        let state = app.state::<PendingUpdateState>();
        let guard = state
            .staged
            .lock()
            .map_err(|_| anyhow!("pending update state poisoned"))?;
        let Some(pending) = guard.as_ref() else {
            return Ok(());
        };
        std::fs::read(pending.artifact.path()).map(|bytes| (pending.update.clone(), bytes))
    };

    let (update, bytes) = match read {
        Ok(staged) => staged,
        Err(error) => {
            // The staged artifact is gone (most likely the OS temp cleaner
            // removed it during a long wait). Drop the now-unusable entry and
            // refresh surfaces so the stale "update available" indicator clears,
            // then re-download in the background so the user can retry without
            // waiting for the next check cycle.
            log_app_update_artifact_missing(trigger, &error);
            clear_staged(&app);
            refresh_update_surfaces(&app);
            let restage_app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = stage_update_if_available(&restage_app).await {
                    crate::crash_log::log_error("re-stage after missing artifact", &error);
                }
            });
            return Err(anyhow::Error::new(error)
                .context("staged update artifact missing; re-downloading, please retry shortly"));
        }
    };

    tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .context("install task panicked")?
        .context("failed to install update")?;

    clear_staged(&app);

    log_app_update_executed(trigger);
    app.request_restart();
    Ok(())
}

/// Drops the staged update, if any. Best-effort — a poisoned lock is ignored.
fn clear_staged(app: &AppHandle) {
    if let Ok(mut guard) = app.state::<PendingUpdateState>().staged.lock() {
        *guard = None;
    }
}

fn log_app_update_staged(update: &Update) {
    tracing::event!(
        target: "everr.app.update",
        tracing::Level::INFO,
        {
            event.name = "everr.app.update.staged",
            everr.app.update.current_version = update.current_version.as_str(),
            everr.app.update.version = update.version.as_str(),
            everr.app.update.target = update.target.as_str(),
        },
        "everr.app.update.staged"
    );
}

fn log_app_update_executed(trigger: &str) {
    tracing::event!(
        target: "everr.app.update",
        tracing::Level::INFO,
        {
            event.name = "everr.app.update.executed",
            everr.app.update.trigger = trigger,
        },
        "everr.app.update.executed"
    );
}

/// The staged artifact vanished from disk (e.g. OS temp cleanup) when the user
/// triggered an install; the entry was dropped and a fresh download kicked off.
fn log_app_update_artifact_missing(trigger: &str, error: &std::io::Error) {
    tracing::event!(
        target: "everr.app.update",
        tracing::Level::WARN,
        {
            event.name = "everr.app.update.artifact_missing",
            everr.app.update.trigger = trigger,
            everr.app.update.error = %error,
        },
        "everr.app.update.artifact_missing"
    );
}
