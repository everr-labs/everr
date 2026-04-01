use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use arboard::Clipboard;
use everr_core::api::{ApiClient, FailureNotification};
use futures_util::StreamExt;
use everr_core::git::resolve_git_context;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
use tauri::Emitter;
use tauri::{AppHandle, LogicalPosition, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::auto_fix_prompt::build_notification_auto_fix_prompt;
use crate::settings::current_app_state;
use crate::tray::{
    build_tray_snapshot, tray_auto_fix_prompt, update_tray_snapshot,
};
use crate::{
    current_base_url, NotificationQueue, RuntimeState, NOTIFICATION_CHANGED_EVENT,
    NOTIFICATION_HOVER_EVENT, NOTIFICATION_WINDOW_HEIGHT, NOTIFICATION_WINDOW_INSET,
    NOTIFICATION_WINDOW_LABEL, NOTIFICATION_WINDOW_MARGIN, NOTIFICATION_WINDOW_WIDTH,
    POLL_INTERVAL_SECONDS,
};

pub(crate) fn start_notifier_loop(app: AppHandle, state: RuntimeState) {
    tauri::async_runtime::spawn(async move {
        let mut backoff = Duration::from_secs(1);
        let max_backoff = Duration::from_secs(30);

        loop {
            match run_sse_notifier(&app, &state).await {
                Ok(()) => {
                    // Stream ended cleanly (e.g., server closed) — reconnect immediately
                    backoff = Duration::from_secs(1);
                }
                Err(error) => {
                    crate::crash_log::log_error("notifier SSE", &error);
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(max_backoff);
                }
            }
        }
    });
}

pub(crate) fn active_notification_auto_fix_prompt(queue: &NotificationQueue) -> Option<String> {
    queue.active().map(build_notification_auto_fix_prompt)
}

pub(crate) fn copy_notification_auto_fix_prompt_inner(state: &RuntimeState) -> Result<()> {
    let notification_prompt = {
        let notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        active_notification_auto_fix_prompt(&notifier.queue)
    };

    let prompt = if let Some(prompt) = notification_prompt {
        Some(prompt)
    } else {
        let tray = state
            .tray
            .lock()
            .map_err(|_| anyhow!("failed to lock tray state"))?;
        tray_auto_fix_prompt(&tray.snapshot)
    };

    let Some(prompt) = prompt else {
        return Ok(());
    };

    let mut clipboard = Clipboard::new().context("failed to access clipboard")?;
    clipboard
        .set_text(prompt)
        .context("failed to copy notification auto-fix prompt")?;
    Ok(())
}

pub(crate) async fn load_owned_failures_for_current_repo(
    state: &RuntimeState,
) -> Result<Option<(Vec<FailureNotification>, Option<String>, Option<String>)>> {
    let Some(session) = current_app_state(state)?.session else {
        return Ok(None);
    };
    if session.api_base_url.trim_end_matches('/') != current_base_url().trim_end_matches('/') {
        return Ok(None);
    }

    let current_dir = std::env::current_dir().context("failed to resolve cwd")?;
    let git = resolve_git_context(&current_dir);
    let Some(git_email) = git.email.as_deref() else {
        return Ok(None);
    };

    let client = ApiClient::from_session(&session)?;
    let failures = client
        .get_owned_failures(git_email, git.repo.as_deref(), git.branch.as_deref())
        .await?;

    Ok(Some((failures, git.repo, git.branch)))
}

pub(crate) fn build_test_notification() -> Result<FailureNotification> {
    let now = OffsetDateTime::now_utc();
    let timestamp = now
        .format(&Rfc3339)
        .context("failed to format test notification timestamp")?;
    let nonce = now.unix_timestamp_nanos();
    let trace_id = format!("trace-dev-settings-test-{nonce}");
    let job_id = format!("job-dev-settings-test-{nonce}");
    let (repo, branch) = match std::env::current_dir()
        .ok()
        .map(|cwd| resolve_git_context(&cwd))
    {
        Some(git) => (
            git.repo.unwrap_or_else(|| "local repository".to_string()),
            git.branch.unwrap_or_else(|| "current branch".to_string()),
        ),
        None => ("local repository".to_string(), "current branch".to_string()),
    };
    let details_url = format!(
        "{}/runs/{trace_id}/jobs/{job_id}/steps/1",
        current_base_url().trim_end_matches('/')
    );

    Ok(FailureNotification {
        dedupe_key: format!("dev-settings-test-{nonce}"),
        trace_id,
        repo,
        branch,
        workflow_name: "Test notification".to_string(),
        failed_at: timestamp,
        details_url,
        job_name: Some("Developer settings".to_string()),
        step_number: Some("1".to_string()),
        step_name: Some("Preview desktop notification".to_string()),
    })
}

async fn run_sse_notifier(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    let Some(session) = current_app_state(state)?.session else {
        // Not logged in — wait and retry
        tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECONDS)).await;
        return Ok(());
    };
    if session.api_base_url.trim_end_matches('/') != current_base_url().trim_end_matches('/') {
        tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECONDS)).await;
        return Ok(());
    }

    let current_dir = std::env::current_dir().context("failed to resolve cwd")?;
    let git = resolve_git_context(&current_dir);
    let Some(git_email) = git.email else {
        tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECONDS)).await;
        return Ok(());
    };

    let client = ApiClient::from_session(&session)?;
    let stream = client.failures_sse(&git_email).await?;

    // Accumulate all failures received during this SSE session for tray snapshot
    let mut all_failures: Vec<FailureNotification> = Vec::new();

    tokio::pin!(stream);
    while let Some(event) = stream.next().await {
        let event = event?;
        all_failures.extend(event.failures.iter().cloned());
        handle_failure_event(app, state, &all_failures, event.failures, git.repo.as_deref(), git.branch.as_deref())?;
    }

    Ok(())
}

fn handle_failure_event(
    app: &AppHandle,
    state: &RuntimeState,
    all_failures: &[FailureNotification],
    new_failures: Vec<FailureNotification>,
    repo: Option<&str>,
    branch: Option<&str>,
) -> Result<()> {
    // Tray always shows the full accumulated set of failures
    update_tray_snapshot(
        app,
        state,
        build_tray_snapshot(all_failures, repo, branch),
    )?;

    let fresh = {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.tracker.retain_new(new_failures)
    };

    for failure in fresh {
        enqueue_notification(app, state, failure)?;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("everr://notifier-checked", ());
    }
    Ok(())
}

fn enqueue_notification(
    app: &AppHandle,
    state: &RuntimeState,
    notification: FailureNotification,
) -> Result<()> {
    let active_changed = {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.queue.enqueue(notification)
    };

    if active_changed {
        sync_notification_window(app, state)?;
    }

    Ok(())
}

pub(crate) fn dismiss_active_notification_inner(
    app: &AppHandle,
    state: &RuntimeState,
) -> Result<()> {
    let active_changed = {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.queue.advance()
    };

    if active_changed {
        sync_notification_window(app, state)?;
    }

    Ok(())
}

pub(crate) fn open_notification_target_inner(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    let target = {
        let notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier
            .queue
            .active()
            .map(|notification| notification.details_url.clone())
    };

    let Some(target) = target else {
        return Ok(());
    };

    webbrowser::open(&target)
        .with_context(|| format!("failed to open notification target {target}"))?;
    dismiss_active_notification_inner(app, state)
}

pub(crate) fn sync_notification_window(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    let has_active_notification = {
        let notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.queue.active().is_some()
    };

    if has_active_notification {
        show_notification_window(app)?;
    } else {
        hide_notification_window(app)?;
    }

    app.emit(NOTIFICATION_CHANGED_EVENT, ())
        .context("failed to emit notification update")
}

fn show_notification_window(app: &AppHandle) -> Result<()> {
    let window = ensure_notification_window(app)?;
    let was_visible = window.is_visible().unwrap_or(false);
    configure_notification_window_for_fullscreen(&window)?;
    position_notification_window(app, &window)?;
    show_without_focus(&window)?;
    if !was_visible {
        start_notification_hover_polling(app);
    }
    Ok(())
}

fn show_without_focus(window: &WebviewWindow) -> Result<()> {
    let window_for_closure = window.clone();
    window
        .run_on_main_thread(move || {
            let Ok(ns_window) = window_for_closure.ns_window() else {
                return;
            };
            let ns_window: &NSWindow = unsafe { &*ns_window.cast() };
            ns_window.orderFront(None);
        })
        .context("failed to show notification window without focus")
}

fn start_notification_hover_polling(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut was_hovering = false;
        loop {
            tokio::time::sleep(Duration::from_millis(50)).await;

            let Some(window) = app.get_webview_window(NOTIFICATION_WINDOW_LABEL) else {
                break;
            };

            if !window.is_visible().unwrap_or(false) {
                break;
            }

            let is_hovering = cursor_is_over_notification_window(&app, &window);
            if is_hovering != was_hovering {
                was_hovering = is_hovering;
                let _ = window.emit(NOTIFICATION_HOVER_EVENT, is_hovering);
            }
        }
    });
}

fn cursor_is_over_notification_window(app: &AppHandle, window: &WebviewWindow) -> bool {
    let Ok(cursor) = app.cursor_position() else {
        return false;
    };
    let Ok(pos) = window.outer_position() else {
        return false;
    };
    let Ok(size) = window.outer_size() else {
        return false;
    };
    cursor.x >= pos.x as f64
        && cursor.x < pos.x as f64 + size.width as f64
        && cursor.y >= pos.y as f64
        && cursor.y < pos.y as f64 + size.height as f64
}

fn hide_notification_window(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window(NOTIFICATION_WINDOW_LABEL) {
        window
            .hide()
            .context("failed to hide notification window")?;
    }
    Ok(())
}

fn ensure_notification_window(app: &AppHandle) -> Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(NOTIFICATION_WINDOW_LABEL) {
        return Ok(window);
    }

    let mut builder = WebviewWindowBuilder::new(
        app,
        NOTIFICATION_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Everr Notification")
    .inner_size(
        NOTIFICATION_WINDOW_WIDTH + NOTIFICATION_WINDOW_INSET,
        NOTIFICATION_WINDOW_HEIGHT + NOTIFICATION_WINDOW_INSET,
    )
    .min_inner_size(
        NOTIFICATION_WINDOW_WIDTH + NOTIFICATION_WINDOW_INSET,
        NOTIFICATION_WINDOW_HEIGHT + NOTIFICATION_WINDOW_INSET,
    )
    .max_inner_size(
        NOTIFICATION_WINDOW_WIDTH + NOTIFICATION_WINDOW_INSET,
        NOTIFICATION_WINDOW_HEIGHT + NOTIFICATION_WINDOW_INSET,
    )
    .prevent_overflow()
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .visible(false)
    .focused(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .shadow(true)
    .accept_first_mouse(true);

    if let Ok((x, y)) = notification_window_position(app) {
        builder = builder.position(x, y);
    }

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon)?;
    }

    builder
        .build()
        .context("failed to build notification window")
}

#[cfg(target_os = "macos")]
fn configure_notification_window_for_fullscreen(window: &WebviewWindow) -> Result<()> {
    let window_for_closure = window.clone();
    window
        .run_on_main_thread(move || {
            let Ok(ns_window) = window_for_closure.ns_window() else {
                return;
            };

            let ns_window: &NSWindow = unsafe { &*ns_window.cast() };
            let behavior = ns_window.collectionBehavior()
                | NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary;
            ns_window.setCollectionBehavior(behavior);
            ns_window.setAcceptsMouseMovedEvents(true);
        })
        .context("failed to configure notification window")
}

#[cfg(not(target_os = "macos"))]
fn configure_notification_window_for_fullscreen(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

fn position_notification_window(app: &AppHandle, window: &WebviewWindow) -> Result<()> {
    let (x, y) = notification_window_position(app)?;
    window
        .set_position(LogicalPosition::new(x, y))
        .context("failed to position notification window")
}

fn notification_window_position(app: &AppHandle) -> Result<(f64, f64)> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| anyhow!("failed to resolve notification monitor"))?;
    let work_area = monitor.work_area();
    let scale_factor = monitor.scale_factor();
    let width =
        ((NOTIFICATION_WINDOW_WIDTH + NOTIFICATION_WINDOW_INSET) * scale_factor).round() as i32;
    let inset = (NOTIFICATION_WINDOW_INSET * scale_factor).round() as i32;
    let margin = (NOTIFICATION_WINDOW_MARGIN * scale_factor).round() as i32;
    let x = work_area.position.x + work_area.size.width as i32 - width - margin / 2;
    let y = work_area.position.y + margin - inset;

    Ok((x as f64 / scale_factor, y as f64 / scale_factor))
}
