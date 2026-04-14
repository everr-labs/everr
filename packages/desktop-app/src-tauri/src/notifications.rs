use std::sync::Mutex;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use arboard::Clipboard;
use everr_core::api::{
    is_reauthentication_required, ApiClient, FailureNotification, NotifyPayload,
};
use everr_core::git::resolve_git_context;
use futures_util::StreamExt;
#[cfg(target_os = "macos")]
use objc2::{rc::Retained, MainThreadMarker, MainThreadOnly};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSBackingStoreType, NSColor, NSEvent, NSPanel, NSStatusWindowLevel,
    NSView, NSWindow, NSWindowAnimationBehavior, NSWindowCollectionBehavior, NSWindowStyleMask,
};

use tauri::Emitter;
use tauri::{
    AppHandle, LogicalPosition, Manager, Position, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::auto_fix_prompt::build_notification_auto_fix_prompt;
use crate::settings::{current_app_state, emit_auth_changed, update_persisted_state};
use crate::{
    current_base_url, NotificationQueue, NotifierState, RuntimeState, NOTIFICATION_CHANGED_EVENT,
    NOTIFICATION_EXIT_EVENT, NOTIFICATION_HOVER_EVENT, NOTIFICATION_WINDOW_HEIGHT,
    NOTIFICATION_WINDOW_INSET, NOTIFICATION_WINDOW_LABEL, NOTIFICATION_WINDOW_MARGIN,
    NOTIFICATION_WINDOW_WIDTH, SEEN_RUNS_CHANGED_EVENT,
};

macro_rules! dbg_notifier {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            tracing::debug!(target: "notifier", $($arg)*);
        }
    };
}

#[cfg(test)]
pub(crate) fn notification_window_uses_native_panel() -> bool {
    cfg!(target_os = "macos")
}

pub(crate) fn notification_hover_uses_native_panel_geometry() -> bool {
    cfg!(target_os = "macos")
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
                            crate::crash_log::log_error("notifier auth reset", &reset_error);
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
    let prompt = {
        let notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        active_notification_auto_fix_prompt(&notifier.queue)
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
        failed_jobs: vec![everr_core::api::FailedJobInfo {
            job_name: "Developer settings".to_string(),
            step_number: "1".to_string(),
            step_name: Some("Preview desktop notification".to_string()),
        }],
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

    if !needs_reset {
        return Ok(());
    }

    {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        reset_notifier_runtime_state(&mut notifier);
    }

    sync_notification_window(app, state)
}

async fn run_sse_notifier(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    use everr_core::state_watcher::StateChange;

    let mut rx = state.watcher.subscribe();

    let Some(session) = current_app_state(state)?.session else {
        wait_for_change(&mut rx, &[StateChange::SessionChanged]).await;
        return Ok(());
    };
    if session.api_base_url.trim_end_matches('/') != current_base_url().trim_end_matches('/') {
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
            wait_for_change(&mut rx, &[StateChange::EmailsChanged]).await;
            return Ok(());
        }
    };

    let client = ApiClient::from_session(&session)?;
    let stream = client.events_stream("tenant", None).await?;

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
                            payload,
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
    emit_auth_changed(app);
    Ok(())
}

async fn handle_notify_event(
    app: &AppHandle,
    state: &RuntimeState,
    client: &ApiClient,
    event: NotifyPayload,
) -> Result<()> {
    dbg_notifier!(
        event_type = %event.event_type,
        status = %event.status,
        conclusion = ?event.conclusion,
        trace_id = %event.trace_id,
        branch = %event.branch,
        workflow = %event.workflow_name,
        "event received"
    );

    if event.event_type != "run" {
        return Ok(());
    }

    match event.conclusion.as_deref() {
        Some("failure") | Some("timed_out") | Some("startup_failure") | Some("action_required") => {
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
            for f in fresh {
                enqueue_notification(app, state, f)?;
            }
        }
        _ => {}
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("everr://notifier-checked", ());
    }

    Ok(())
}

pub(crate) fn enqueue_notification(
    app: &AppHandle,
    state: &RuntimeState,
    notification: FailureNotification,
) -> Result<()> {
    dbg_notifier!(
        trace_id = %notification.trace_id,
        repo = %notification.repo,
        workflow = %notification.workflow_name,
        "notification fired"
    );
    crate::seen_runs::add_seen_run(state, &notification.trace_id)?;
    let _ = app.emit(SEEN_RUNS_CHANGED_EVENT, ());

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
    let dismissed_trace_id = {
        let notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.queue.active().map(|n| n.trace_id.clone())
    };

    if let Some(trace_id) = &dismissed_trace_id {
        let _ = crate::seen_runs::mark_seen(state, trace_id);
        let _ = app.emit(SEEN_RUNS_CHANGED_EVENT, ());
    }

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
    position_notification_window(app, &window)?;
    let was_visible = notification_window_is_visible(&window)?;

    if !was_visible {
        show_notification_window_host(&window)?;
        start_notification_hover_polling(app);
    }

    Ok(())
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

            if !notification_window_is_visible(&window).unwrap_or(false) {
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
    #[cfg(target_os = "macos")]
    if notification_hover_uses_native_panel_geometry() {
        return with_notification_native_objects(window, |ns_window, _| {
            let frame = notification_panel()
                .map(|panel| panel.frame())
                .unwrap_or_else(|| ns_window.frame());
            let cursor = NSEvent::mouseLocation();
            Ok(point_is_inside_notification_frame(
                cursor.x,
                cursor.y,
                frame.origin.x,
                frame.origin.y,
                frame.size.width,
                frame.size.height,
            ))
        })
        .unwrap_or(false);
    }

    let Ok(cursor) = app.cursor_position() else {
        return false;
    };
    let Ok(pos) = window.outer_position() else {
        return false;
    };
    let Ok(size) = window.outer_size() else {
        return false;
    };
    point_is_inside_notification_frame(
        cursor.x,
        cursor.y,
        pos.x as f64,
        pos.y as f64,
        size.width as f64,
        size.height as f64,
    )
}

fn point_is_inside_notification_frame(
    cursor_x: f64,
    cursor_y: f64,
    frame_x: f64,
    frame_y: f64,
    frame_width: f64,
    frame_height: f64,
) -> bool {
    cursor_x >= frame_x
        && cursor_x < frame_x + frame_width
        && cursor_y >= frame_y
        && cursor_y < frame_y + frame_height
}

fn hide_notification_window(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window(NOTIFICATION_WINDOW_LABEL) {
        if notification_window_is_visible(&window).unwrap_or(false) {
            // Tell the frontend to play the CSS exit animation, then hide after it completes.
            let _ = window.emit(NOTIFICATION_EXIT_EVENT, ());
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(200)).await;
                if let Some(w) = app.get_webview_window(NOTIFICATION_WINDOW_LABEL) {
                    let _ = hide_notification_window_host(&w);
                    // Once the panel releases the webview back to the backing Tauri window,
                    // keep that owner hidden between notifications.
                    #[cfg(target_os = "macos")]
                    let _ = w.hide();
                }
                let _ = app.emit(NOTIFICATION_CHANGED_EVENT, ());
            });
            return Ok(());
        }
        hide_notification_window_host(&window)?;
        // The native panel is only the temporary presenter. After hide, the webview
        // is reattached to the hidden Tauri window, so hide that owner as well.
        #[cfg(target_os = "macos")]
        window
            .hide()
            .context("failed to hide notification window")?;
    }
    app.emit(NOTIFICATION_CHANGED_EVENT, ())
        .context("failed to emit notification update")
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
        NOTIFICATION_WINDOW_WIDTH + NOTIFICATION_WINDOW_INSET + NOTIFICATION_WINDOW_MARGIN,
        NOTIFICATION_WINDOW_HEIGHT + NOTIFICATION_WINDOW_INSET,
    )
    .min_inner_size(
        NOTIFICATION_WINDOW_WIDTH + NOTIFICATION_WINDOW_INSET + NOTIFICATION_WINDOW_MARGIN,
        NOTIFICATION_WINDOW_HEIGHT + NOTIFICATION_WINDOW_INSET,
    )
    .max_inner_size(
        NOTIFICATION_WINDOW_WIDTH + NOTIFICATION_WINDOW_INSET + NOTIFICATION_WINDOW_MARGIN,
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

fn notification_window_is_visible(window: &WebviewWindow) -> Result<bool> {
    #[cfg(target_os = "macos")]
    {
        return with_notification_native_objects(window, |_, _| {
            Ok(notification_panel()
                .map(|p| p.isVisible())
                .unwrap_or(false))
        });
    }

    #[cfg(not(target_os = "macos"))]
    Ok(window.is_visible().unwrap_or(false))
}

fn show_notification_window_host(window: &WebviewWindow) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        return show_notification_panel(window);
    }

    #[cfg(not(target_os = "macos"))]
    {
        window.show().context("failed to show notification window")
    }
}

fn hide_notification_window_host(window: &WebviewWindow) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        return hide_notification_panel(window);
    }

    #[cfg(not(target_os = "macos"))]
    window.hide().context("failed to hide notification window")
}

fn position_notification_window(app: &AppHandle, window: &WebviewWindow) -> Result<()> {
    let Ok((x, y)) = notification_window_position(app) else {
        return Ok(());
    };

    window
        .set_position(Position::Logical(LogicalPosition::new(x, y)))
        .context("failed to position notification window")?;

    #[cfg(target_os = "macos")]
    {
        return with_notification_native_objects(window, |ns_window, _| {
            if let Some(panel) = notification_panel() {
                panel.setFrame_display(ns_window.frame(), false);
            }
            Ok(())
        });
    }

    #[cfg(not(target_os = "macos"))]
    Ok(())
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
    let full_width =
        ((NOTIFICATION_WINDOW_WIDTH + NOTIFICATION_WINDOW_INSET + NOTIFICATION_WINDOW_MARGIN)
            * scale_factor)
            .round() as i32;
    let inset = (NOTIFICATION_WINDOW_INSET * scale_factor).round() as i32;
    let margin = (NOTIFICATION_WINDOW_MARGIN * scale_factor).round() as i32;
    // Window right edge is flush with the work-area edge.
    // The margin between the card and screen edge is handled by CSS padding-right.
    let x = work_area.position.x + work_area.size.width as i32 - full_width;
    let y = work_area.position.y + margin - inset;

    Ok((x as f64 / scale_factor, y as f64 / scale_factor))
}

/// Raw pointer to the singleton NSPanel used for notifications.
/// Only accessed on the main thread (inside `with_notification_native_objects`).
#[cfg(target_os = "macos")]
struct SendPtr(*mut objc2::runtime::AnyObject);
#[cfg(target_os = "macos")]
// SAFETY: the pointer is only dereferenced on the main thread.
unsafe impl Send for SendPtr {}
#[cfg(target_os = "macos")]
// SAFETY: access is synchronized by the Mutex.
unsafe impl Sync for SendPtr {}
#[cfg(target_os = "macos")]
static NOTIFICATION_PANEL_PTR: Mutex<Option<SendPtr>> = Mutex::new(None);

#[cfg(target_os = "macos")]
fn show_notification_panel(window: &WebviewWindow) -> Result<()> {
    with_notification_native_objects(window, |ns_window, webview_view| {
        let panel = ensure_notification_panel(ns_window, webview_view)?;
        panel.setFrame_display(ns_window.frame(), false);
        panel.orderFrontRegardless();
        Ok(())
    })
}

#[cfg(target_os = "macos")]
fn hide_notification_panel(window: &WebviewWindow) -> Result<()> {
    with_notification_native_objects(window, |ns_window, webview_view| {
        attach_notification_webview_to_backing_window(ns_window, webview_view)?;
        if let Some(panel) = notification_panel() {
            panel.orderOut(None);
        }
        Ok(())
    })
}

#[cfg(target_os = "macos")]
fn with_notification_native_objects<T, F>(window: &WebviewWindow, f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&NSWindow, &NSView) -> Result<T> + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    window
        .with_webview(move |webview| {
            let result = (|| {
                let ns_window: &NSWindow = unsafe { &*webview.ns_window().cast() };
                let webview_view: &NSView = unsafe { &*webview.inner().cast() };
                f(ns_window, webview_view)
            })();
            let _ = tx.send(result);
        })
        .context("failed to access native notification webview")?;

    rx.recv()
        .map_err(|_| anyhow!("failed to receive native notification result"))?
}

#[cfg(target_os = "macos")]
fn ensure_notification_panel(
    ns_window: &NSWindow,
    webview_view: &NSView,
) -> Result<Retained<NSPanel>> {
    if let Some(panel) = notification_panel() {
        attach_notification_webview_to_panel(&panel, webview_view)?;
        return Ok(panel);
    }

    let mtm =
        MainThreadMarker::new().expect("notification panel must be created on the main thread");
    let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
        NSPanel::alloc(mtm),
        ns_window.frame(),
        NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
        NSBackingStoreType::Buffered,
        false,
    );

    panel.setFloatingPanel(true);
    panel.setBecomesKeyOnlyIfNeeded(true);
    panel.setWorksWhenModal(true);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::CanJoinAllSpaces,
    );
    panel.setAnimationBehavior(NSWindowAnimationBehavior::None);
    panel.setLevel(NSStatusWindowLevel);
    panel.setOpaque(false);
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.setHasShadow(true);
    panel.setHidesOnDeactivate(false);
    panel.setExcludedFromWindowsMenu(true);
    panel.setAcceptsMouseMovedEvents(true);
    panel.setIgnoresMouseEvents(false);

    // Transfer one retain count into the static so the panel stays alive.
    *NOTIFICATION_PANEL_PTR
        .lock()
        .map_err(|_| anyhow!("failed to lock notification panel"))? =
        Some(SendPtr(Retained::into_raw(panel.clone()).cast()));

    attach_notification_webview_to_panel(&panel, webview_view)?;

    Ok(panel)
}

#[cfg(target_os = "macos")]
fn notification_panel() -> Option<Retained<NSPanel>> {
    let guard = NOTIFICATION_PANEL_PTR.lock().ok()?;
    let ptr = guard.as_ref()?.0;
    // SAFETY: the pointer was stored by `ensure_notification_panel` on the main thread
    // and we only call this from `with_notification_native_objects` which also runs on
    // the main thread. The panel is retained by the Retained we create here.
    unsafe { Retained::retain(ptr.cast()) }
}

#[cfg(target_os = "macos")]
fn attach_notification_webview_to_panel(panel: &NSPanel, webview_view: &NSView) -> Result<()> {
    let content_view = panel
        .contentView()
        .ok_or_else(|| anyhow!("notification panel is missing a content view"))?;
    attach_notification_webview(content_view.as_ref(), webview_view);
    Ok(())
}

#[cfg(target_os = "macos")]
fn attach_notification_webview_to_backing_window(
    ns_window: &NSWindow,
    webview_view: &NSView,
) -> Result<()> {
    let content_view = ns_window
        .contentView()
        .ok_or_else(|| anyhow!("notification window is missing a content view"))?;
    attach_notification_webview(content_view.as_ref(), webview_view);
    Ok(())
}

#[cfg(target_os = "macos")]
fn attach_notification_webview(content_view: &NSView, webview_view: &NSView) {
    webview_view.removeFromSuperview();
    webview_view.setFrame(content_view.bounds());
    webview_view.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    content_view.addSubview(webview_view);
}
