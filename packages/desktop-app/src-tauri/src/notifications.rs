use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use arboard::Clipboard;
use everr_core::api::{
    ApiClient, FailureNotification, NotifyPayload, is_reauthentication_required,
};
use everr_core::git::resolve_git_context;
use futures_util::StreamExt;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
use tauri::Emitter;
use tauri::{AppHandle, LogicalPosition, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::auto_fix_prompt::build_notification_auto_fix_prompt;
use crate::settings::{current_app_state, emit_auth_changed, update_persisted_state};
use crate::tray::{
    build_tray_snapshot, clear_tray_snapshot, tray_auto_fix_prompt, update_tray_snapshot,
};
use crate::{
    NotifierState, NotificationQueue, RuntimeState, TRAY_FAILURES_WINDOW_MINUTES,
    NOTIFICATION_CHANGED_EVENT, NOTIFICATION_HOVER_EVENT, NOTIFICATION_WINDOW_HEIGHT,
    NOTIFICATION_WINDOW_INSET, NOTIFICATION_WINDOW_LABEL, NOTIFICATION_WINDOW_MARGIN,
    NOTIFICATION_WINDOW_WIDTH, current_base_url,
};

macro_rules! dbg_notifier {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[notifier] {}", format_args!($($arg)*));
        }
    };
}

pub(crate) fn start_notifier_loop(app: AppHandle, state: RuntimeState) {
    tauri::async_runtime::spawn(async move {
        let mut backoff = Duration::from_secs(1);
        let max_backoff = Duration::from_secs(30);

        loop {
            match run_sse_notifier(&app, &state).await {
                Ok(()) => {
                    // Stream ended cleanly (e.g., server closed) — brief pause before reconnect
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    backoff = Duration::from_secs(1);
                }
                Err(error) => {
                    if is_reauthentication_required(&error) {
                        crate::crash_log::log_error("notifier SSE auth", &error);
                        if let Err(reset_error) = handle_notifier_auth_failure(&app, &state) {
                            crate::crash_log::log_error(
                                "notifier auth reset",
                                &reset_error,
                            );
                        }
                        backoff = Duration::from_secs(1);
                        continue;
                    }

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

pub(crate) fn reset_notifier_runtime_state(notifier: &mut NotifierState) {
    *notifier = NotifierState::default();
}

pub(crate) fn reset_notification_state(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    let needs_reset = {
        let notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.queue.active().is_some() || !notifier.queue.pending.is_empty()
    };

    let tray_has_data = {
        let tray = state
            .tray
            .lock()
            .map_err(|_| anyhow!("failed to lock tray state"))?;
        !tray.snapshot.failures.is_empty()
    };

    if !needs_reset && !tray_has_data {
        return Ok(());
    }

    {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        reset_notifier_runtime_state(&mut notifier);
    }

    clear_tray_snapshot(app, state)?;
    sync_notification_window(app, state)
}

async fn run_sse_notifier(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    use everr_core::state_watcher::StateChange;

    let mut rx = state.watcher.subscribe();

    let Some(session) = current_app_state(state)?.session else {
        reset_notification_state(app, state)?;
        wait_for_change(&mut rx, &[StateChange::SessionChanged]).await;
        return Ok(());
    };
    if session.api_base_url.trim_end_matches('/') != current_base_url().trim_end_matches('/') {
        reset_notification_state(app, state)?;
        wait_for_change(&mut rx, &[StateChange::SessionChanged]).await;
        return Ok(());
    }

    // Build email filter set: configured list, falling back to cached profile email
    let email_set: std::collections::HashSet<String> = {
        let settings = current_app_state(state)?.settings;
        if !settings.notification_emails.is_empty() {
            settings.notification_emails.into_iter().collect()
        } else if let Some(profile) = settings.user_profile {
            std::iter::once(profile.email).collect()
        } else {
            // No emails configured and no profile cached — wait for session or filter changes.
            reset_notification_state(app, state)?;
            wait_for_change(&mut rx, &[StateChange::SessionChanged, StateChange::EmailsChanged]).await;
            return Ok(());
        }
    };

    // Resolve git context for repo/branch scoping (still used by handle_notify_event)
    let current_dir = std::env::current_dir().context("failed to resolve cwd")?;
    let git = resolve_git_context(&current_dir);

    let client = ApiClient::from_session(&session)?;
    let stream = client.events_stream("tenant", None).await?;

    // Known failures accumulated this session, keyed by traceId
    let mut known_failures: std::collections::HashMap<String, FailureNotification> =
        std::collections::HashMap::new();

    tokio::pin!(stream);
    loop {
        tokio::select! {
            event = stream.next() => {
                match event {
                    Some(Ok(payload)) => {
                        // Filter client-side by configured emails
                        if let Some(ref author_email) = payload.author_email {
                            if !email_set.contains(author_email) {
                                continue;
                            }
                        }
                        handle_notify_event(
                            app,
                            state,
                            &client,
                            &mut known_failures,
                            payload,
                            git.repo.as_deref(),
                            git.branch.as_deref(),
                        ).await?;
                    }
                    Some(Err(e)) => return Err(e),
                    None => break,
                }
            }
            change = rx.recv() => {
                match change {
                    Ok(StateChange::SessionChanged) | Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        dbg_notifier!("session changed — restarting SSE loop");
                        break;
                    }
                    Ok(StateChange::EmailsChanged) => {
                        dbg_notifier!("notification emails changed — restarting SSE loop");
                        break;
                    }
                    Ok(StateChange::SettingsChanged) => {
                        // Settings changes without email changes don't require SSE restart
                        continue;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        dbg_notifier!("lagged state changes — restarting SSE loop");
                        break;
                    }
                }
            }
        }
    }

    Ok(())
}

async fn wait_for_change(
    rx: &mut tokio::sync::broadcast::Receiver<everr_core::state_watcher::StateChange>,
    expected: &[everr_core::state_watcher::StateChange],
) {
    loop {
        match rx.recv().await {
            Ok(change) if expected.contains(&change) => return,
            Ok(_) => continue,
            Err(_) => return,
        }
    }
}

fn handle_notifier_auth_failure(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    update_persisted_state(state, |persisted| {
        persisted.session = None;
    })?;
    reset_notification_state(app, state)?;
    emit_auth_changed(app);
    Ok(())
}

async fn handle_notify_event(
    app: &AppHandle,
    state: &RuntimeState,
    client: &ApiClient,
    known_failures: &mut std::collections::HashMap<String, FailureNotification>,
    event: NotifyPayload,
    repo: Option<&str>,
    branch: Option<&str>,
) -> Result<()> {
    dbg_notifier!(
        "event: type={} status={} conclusion={:?} trace={} branch={} workflow={}",
        event.event_type,
        event.status,
        event.conclusion,
        event.trace_id,
        event.branch,
        event.workflow_name,
    );

    if event.event_type != "run" {
        return Ok(());
    }

    match event.conclusion.as_deref() {
        Some("failure") | Some("timed_out") | Some("startup_failure") | Some("action_required") => {
            if known_failures.contains_key(&event.trace_id) {
                return Ok(());
            }
            let Some(failure) = client.get_notification_for_trace(&event.trace_id).await? else {
                dbg_notifier!("failure not found in ClickHouse after all retries, dropping event");
                return Ok(());
            };
            let fresh = {
                let mut notifier = state
                    .notifier
                    .lock()
                    .map_err(|_| anyhow!("failed to lock notifier state"))?;
                notifier.tracker.retain_new(vec![failure.clone()])
            };
            known_failures.insert(event.trace_id.clone(), failure);
            expire_old_failures(known_failures);
            update_tray_snapshot(
                app,
                state,
                build_tray_snapshot(
                    &known_failures.values().cloned().collect::<Vec<_>>(),
                    repo,
                    branch,
                ),
            )?;
            for f in fresh {
                enqueue_notification(app, state, f)?;
            }
        }
        Some("success") => {
            // Remove the specific trace and any other failures for the same branch/workflow —
            // a successful run supersedes prior failures on that workflow.
            known_failures.retain(|_, f| {
                !(f.repo == event.repo
                    && f.branch == event.branch
                    && f.workflow_name == event.workflow_name)
            });
            expire_old_failures(known_failures);
            update_tray_snapshot(
                app,
                state,
                build_tray_snapshot(
                    &known_failures.values().cloned().collect::<Vec<_>>(),
                    repo,
                    branch,
                ),
            )?;
        }
        _ => {}
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("everr://notifier-checked", ());
    }

    Ok(())
}

fn expire_old_failures(
    known_failures: &mut std::collections::HashMap<String, FailureNotification>,
) {
    let cutoff = OffsetDateTime::now_utc()
        - time::Duration::minutes(TRAY_FAILURES_WINDOW_MINUTES as i64);
    known_failures.retain(|_, f| {
        OffsetDateTime::parse(&f.failed_at, &Rfc3339)
            .map(|t| t > cutoff)
            .unwrap_or(true)
    });
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
        app.emit(NOTIFICATION_CHANGED_EVENT, ())
            .context("failed to emit notification update")
    } else {
        // Slide-out first, then emit the changed event + hide once animation completes.
        // This keeps the card content visible during the exit animation.
        hide_notification_window(app)
    }
}

fn show_notification_window(app: &AppHandle) -> Result<()> {
    let window = ensure_notification_window(app)?;
    let was_visible = window.is_visible().unwrap_or(false);
    configure_notification_window_for_fullscreen(&window)?;

    if !was_visible {
        // Start off-screen to the right, then animate to final position
        let (final_x, final_y) = notification_window_position(app)?;
        let off_screen_x = final_x + NOTIFICATION_WINDOW_WIDTH + NOTIFICATION_WINDOW_INSET + 24.0;
        window
            .set_position(LogicalPosition::new(off_screen_x, final_y))
            .context("failed to set initial off-screen position")?;
        show_without_focus(&window)?;
        animate_window_slide(app, final_x, final_y, false);
        start_notification_hover_polling(app);
    } else {
        position_notification_window(app, &window)?;
    }

    Ok(())
}

fn show_without_focus(window: &WebviewWindow) -> Result<()> {
    window
        .show()
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
        if window.is_visible().unwrap_or(false) {
            if let Ok((final_x, final_y)) = notification_window_position(app) {
                let off_screen_x =
                    final_x + NOTIFICATION_WINDOW_WIDTH + NOTIFICATION_WINDOW_INSET + 24.0;
                animate_window_slide(app, off_screen_x, final_y, true);
                return Ok(());
            }
        }
        window
            .hide()
            .context("failed to hide notification window")?;
    }
    app.emit(NOTIFICATION_CHANGED_EVENT, ())
        .context("failed to emit notification update")
}

/// Smoothly slides the notification window to `(target_x, target_y)`.
/// When `hide_after` is true the window is hidden once the animation completes.
fn animate_window_slide(app: &AppHandle, target_x: f64, target_y: f64, hide_after: bool) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        const DURATION_MS: u64 = 200;
        const FRAME_MS: u64 = 6;
        let steps = DURATION_MS / FRAME_MS;

        let Some(window) = app.get_webview_window(NOTIFICATION_WINDOW_LABEL) else {
            return;
        };
        let Ok(start_pos) = window.outer_position() else {
            return;
        };
        let scale = app
            .cursor_position()
            .ok()
            .and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten())
            .or_else(|| app.primary_monitor().ok().flatten())
            .map(|m| m.scale_factor())
            .unwrap_or(1.0);
        let start_x = start_pos.x as f64 / scale;
        let start_y = start_pos.y as f64 / scale;

        for i in 1..=steps {
            let t = i as f64 / steps as f64;
            // ease-out cubic for slide-in, ease-in cubic for slide-out
            let eased = if hide_after {
                t * t * t
            } else {
                1.0 - (1.0 - t).powi(3)
            };
            let x = start_x + (target_x - start_x) * eased;
            let y = start_y + (target_y - start_y) * eased;
            let _ = window.set_position(LogicalPosition::new(x, y));
            tokio::time::sleep(Duration::from_millis(FRAME_MS)).await;
        }

        if hide_after {
            let _ = app.emit(NOTIFICATION_CHANGED_EVENT, ());
            let _ = window.hide();
        }
    });
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
    .focusable(false)
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
