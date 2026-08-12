use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use nix::errno::Errno;
use nix::sys::signal::{killpg, Signal};
use nix::unistd::Pid;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::{JoinError, JoinHandle};
use tokio::time::{sleep, timeout};

use crate::telemetry::ports::{HEALTHCHECK_PORT, OTLP_HTTP_PORT};

pub const COLLECTOR_START_ARGS: [&str; 3] = ["local", "start", "--quiet"];
pub const COLLECTOR_CHANGED_EVENT: &str = "everr://collector-changed";

#[derive(Debug, Clone)]
pub enum TelemetryState {
    Starting,
    Ready {
        otlp_endpoint: String,
    },
    /// Intentionally stopped (app shutdown).
    Stopped,
    /// Failed to start or exited unexpectedly.
    Disabled {
        reason: String,
    },
}

struct CollectorFailureException {
    exception_type: &'static str,
    exception_message: &'static str,
    reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectorStatusResponse {
    pub status: &'static str,
    pub reason: Option<String>,
    pub otlp_endpoint: String,
    pub sql_endpoint: String,
    pub health_endpoint: String,
    pub telemetry_dir: Option<String>,
}

/// Commands sent to the supervisor task that owns the collector process.
enum SupervisorCommand {
    Restart(oneshot::Sender<CollectorStatusResponse>),
    Shutdown(oneshot::Sender<()>),
}

/// Handle to the collector supervisor. All process state lives in the
/// supervisor task; this struct only carries channels to talk to it, so there
/// is no shared mutable process state to guard.
pub struct Sidecar {
    cmd_tx: mpsc::Sender<SupervisorCommand>,
    state_rx: watch::Receiver<TelemetryState>,
}

impl Sidecar {
    pub fn state(&self) -> watch::Receiver<TelemetryState> {
        self.state_rx.clone()
    }

    pub fn status(&self) -> CollectorStatusResponse {
        status_response(&self.state_rx.borrow())
    }

    /// Starts the collector from inside Tauri's `setup()` callback.
    pub async fn start(app: &AppHandle) -> Self {
        let (state_tx, state_rx) = watch::channel(TelemetryState::Starting);
        let (cmd_tx, cmd_rx) = mpsc::channel(8);

        // Spawn the first generation up front so an immediate failure surfaces
        // as `Disabled` before we hand the supervisor over.
        kill_orphaned_collector();
        let child = match spawn_collector(app).await {
            Ok(child) => Some(child),
            Err(reason) => {
                set_collector_state(&state_tx, TelemetryState::Disabled { reason });
                None
            }
        };

        let supervisor = Supervisor {
            app: app.clone(),
            state_tx,
            child,
            readiness: None,
        };
        // `tauri::async_runtime::spawn` works regardless of the current runtime
        // context (`start` runs inside Tauri's synchronous `setup`).
        tauri::async_runtime::spawn(supervisor.run(cmd_rx));

        Self { cmd_tx, state_rx }
    }

    pub async fn restart(&self) -> CollectorStatusResponse {
        let (reply_tx, reply_rx) = oneshot::channel();
        if self
            .cmd_tx
            .send(SupervisorCommand::Restart(reply_tx))
            .await
            .is_err()
        {
            return self.status();
        }
        reply_rx.await.unwrap_or_else(|_| self.status())
    }

    pub async fn shutdown(&self) {
        let (reply_tx, reply_rx) = oneshot::channel();
        if self
            .cmd_tx
            .send(SupervisorCommand::Shutdown(reply_tx))
            .await
            .is_ok()
        {
            let _ = reply_rx.await;
        }
    }
}

/// Owns the collector `Child` and its readiness probe, and is the single writer
/// of `TelemetryState`. Because everything lives in one task, restarts and
/// shutdowns are serialized for free and no stale generation can race the
/// current one.
struct Supervisor {
    app: AppHandle,
    state_tx: watch::Sender<TelemetryState>,
    child: Option<Child>,
    readiness: Option<JoinHandle<String>>,
}

impl Supervisor {
    async fn run(mut self, mut cmd_rx: mpsc::Receiver<SupervisorCommand>) {
        if self.child.is_some() {
            self.readiness = Some(tokio::spawn(probe_ready()));
        }

        loop {
            tokio::select! {
                // The collector exited on its own.
                res = wait_child(&mut self.child), if self.child.is_some() => {
                    self.abort_readiness();
                    self.child = None;
                    set_collector_state(&self.state_tx, TelemetryState::Disabled {
                        reason: exit_reason(res),
                    });
                }
                // The readiness probe for the current generation passed.
                res = wait_handle(&mut self.readiness), if self.readiness.is_some() => {
                    self.readiness = None;
                    if let Ok(otlp_endpoint) = res {
                        set_collector_state(&self.state_tx, TelemetryState::Ready { otlp_endpoint });
                    }
                }
                cmd = cmd_rx.recv() => match cmd {
                    Some(SupervisorCommand::Restart(reply)) => self.handle_restart(reply).await,
                    Some(SupervisorCommand::Shutdown(reply)) => {
                        self.teardown().await;
                        set_collector_state(&self.state_tx, TelemetryState::Stopped);
                        let _ = reply.send(());
                        return;
                    }
                    None => {
                        self.teardown().await;
                        return;
                    }
                },
            }
        }
    }

    async fn handle_restart(&mut self, reply: oneshot::Sender<CollectorStatusResponse>) {
        self.teardown().await;
        kill_orphaned_collector();

        match spawn_collector(&self.app).await {
            Ok(child) => {
                self.child = Some(child);
                self.readiness = Some(tokio::spawn(probe_ready()));
                set_collector_state(&self.state_tx, TelemetryState::Starting);
            }
            Err(reason) => {
                set_collector_state(&self.state_tx, TelemetryState::Disabled { reason });
            }
        }

        // Reply once the new generation settles. The waiter only observes the
        // state channel — the main loop keeps driving the transitions — so it
        // can't deadlock against this task.
        let state_rx = self.state_tx.subscribe();
        tokio::spawn(async move {
            let status = wait_until_settled(state_rx, Duration::from_secs(12)).await;
            let _ = reply.send(status);
        });
    }

    /// Stops the current collector and cancels its readiness probe, leaving the
    /// supervisor with no live generation.
    async fn teardown(&mut self) {
        self.abort_readiness();
        stop_child(&mut self.child).await;
    }

    fn abort_readiness(&mut self) {
        if let Some(handle) = self.readiness.take() {
            handle.abort();
        }
    }
}

/// Awaits the child's exit, or pends forever when there is no child.
async fn wait_child(child: &mut Option<Child>) -> std::io::Result<std::process::ExitStatus> {
    match child {
        Some(child) => child.wait().await,
        None => std::future::pending().await,
    }
}

/// Awaits the readiness probe handle, or pends forever when there is none.
async fn wait_handle(handle: &mut Option<JoinHandle<String>>) -> Result<String, JoinError> {
    match handle {
        Some(handle) => handle.await,
        None => std::future::pending().await,
    }
}

fn exit_reason(res: std::io::Result<std::process::ExitStatus>) -> String {
    match res {
        Ok(status) => format!("collector CLI terminated: {status}"),
        Err(err) => format!("collector CLI wait failed: {err}"),
    }
}

fn set_collector_state(state_tx: &watch::Sender<TelemetryState>, state: TelemetryState) {
    let previous = state_tx.borrow().clone();
    log_collector_status_change(Some(&previous), &state);
    let _ = state_tx.send(state);
}

fn log_collector_status_change(previous: Option<&TelemetryState>, next: &TelemetryState) {
    let previous_status = previous.map(collector_status_name).unwrap_or("unknown");
    let status = collector_status_name(next);
    let Some(event_name) = collector_status_event_name(status) else {
        return;
    };

    if let Some(exception) = collector_failure_exception_for_state(next) {
        tracing::event!(
            target: "everr.collector",
            tracing::Level::ERROR,
            {
                event.name = event_name,
                everr.collector.previous_status = previous_status,
                everr.collector.status = status,
                exception.type = exception.exception_type,
                exception.message = exception.exception_message,
                everr.collector.failure_reason = exception.reason.as_str(),
            },
            "{}",
            event_name
        );
        return;
    }

    tracing::event!(
        target: "everr.collector",
        tracing::Level::INFO,
        {
            event.name = event_name,
            everr.collector.previous_status = previous_status,
            everr.collector.status = status,
        },
        "{}",
        event_name
    );
}

fn collector_status_event_name(status: &str) -> Option<&'static str> {
    match status {
        "running" => Some("everr.collector.status.running"),
        "failed" => Some("everr.collector.status.failed"),
        "stopped" => Some("everr.collector.status.stopped"),
        _ => None,
    }
}

fn collector_status_name(state: &TelemetryState) -> &'static str {
    match state {
        TelemetryState::Starting => "starting",
        TelemetryState::Ready { .. } => "running",
        TelemetryState::Stopped => "stopped",
        TelemetryState::Disabled { .. } => "failed",
    }
}

fn collector_failure_exception_for_state(
    state: &TelemetryState,
) -> Option<CollectorFailureException> {
    let TelemetryState::Disabled { reason } = state else {
        return None;
    };

    Some(collector_failure_exception(reason))
}

fn collector_failure_exception(reason: &str) -> CollectorFailureException {
    if reason.starts_with("collector CLI terminated:") {
        return CollectorFailureException {
            exception_type: "CollectorExitError",
            exception_message: "collector exited unexpectedly",
            reason: reason.to_owned(),
        };
    }

    if reason.starts_with("collector CLI wait failed:") {
        return CollectorFailureException {
            exception_type: "CollectorWaitError",
            exception_message: "collector process wait failed",
            reason: reason.to_owned(),
        };
    }

    CollectorFailureException {
        exception_type: "CollectorStartError",
        exception_message: "collector failed to start",
        reason: reason.to_owned(),
    }
}

/// Polls the collector healthcheck until it passes, returning the OTLP endpoint.
async fn probe_ready() -> String {
    let endpoint = format!("http://127.0.0.1:{HEALTHCHECK_PORT}/");
    loop {
        if everr_core::collector::wait_healthcheck(&endpoint, Duration::from_secs(3)).await {
            return format!("http://127.0.0.1:{OTLP_HTTP_PORT}");
        }
        eprintln!("[collector] healthcheck not ready after 3s; continuing background wait");
        sleep(Duration::from_secs(1)).await;
    }
}

async fn spawn_collector(app: &AppHandle) -> Result<Child, String> {
    let cli_path =
        crate::cli::bundled_cli_path(app).map_err(|err| format!("bundled CLI: {err}"))?;
    spawn_cli_collector(&cli_path)
        .await
        .map_err(|err| format!("CLI collector spawn: {err}"))
}

/// Terminates the collector process group (SIGTERM, then SIGKILL on timeout)
/// and clears the slot.
async fn stop_child(slot: &mut Option<Child>) {
    let Some(mut child) = slot.take() else {
        return;
    };
    let Some(pid) = child.id() else {
        let _ = child.kill().await;
        return;
    };

    let process_group = Pid::from_raw(pid as i32);
    match killpg(process_group, Signal::SIGTERM) {
        Ok(()) => {}
        Err(Errno::ESRCH) => return,
        Err(err) => {
            eprintln!("[collector] SIGTERM failed: {err}; hard-killing process group");
            hard_kill_process_group(process_group, &mut child).await;
            return;
        }
    }

    match timeout(Duration::from_secs(3), child.wait()).await {
        Ok(Ok(_)) => { /* clean exit */ }
        Ok(Err(err)) => eprintln!("[collector] wait after SIGTERM failed: {err}"),
        Err(_) => {
            eprintln!("[collector] did not exit within 3s of SIGTERM; hard-killing process group");
            hard_kill_process_group(process_group, &mut child).await;
        }
    }
}

fn status_response(state: &TelemetryState) -> CollectorStatusResponse {
    let otlp_endpoint = match state {
        TelemetryState::Ready { otlp_endpoint } => otlp_endpoint.clone(),
        _ => everr_core::build::otlp_http_origin(),
    };
    let (status, reason) = match state {
        TelemetryState::Starting => ("starting", None),
        TelemetryState::Ready { .. } => ("running", None),
        TelemetryState::Stopped => ("stopped", None),
        TelemetryState::Disabled { reason } => ("failed", Some(reason.clone())),
    };

    CollectorStatusResponse {
        status,
        reason,
        otlp_endpoint,
        sql_endpoint: everr_core::build::sql_http_origin(),
        health_endpoint: everr_core::build::healthcheck_origin(),
        telemetry_dir: everr_core::build::telemetry_dir()
            .ok()
            .map(|path| path.display().to_string()),
    }
}

pub fn start_collector_state_event_loop(
    app: AppHandle,
    mut state_rx: watch::Receiver<TelemetryState>,
) {
    // Called from Tauri's synchronous `setup()` (outside a Tokio runtime
    // context), so use the Tauri runtime spawner rather than `tokio::spawn`.
    tauri::async_runtime::spawn(async move {
        let _ = app.emit(COLLECTOR_CHANGED_EVENT, status_response(&state_rx.borrow()));
        while state_rx.changed().await.is_ok() {
            let status = status_response(&state_rx.borrow_and_update());
            let _ = app.emit(COLLECTOR_CHANGED_EVENT, status);
        }
    });
}

async fn hard_kill_process_group(process_group: Pid, child: &mut Child) {
    match killpg(process_group, Signal::SIGKILL) {
        Ok(()) | Err(Errno::ESRCH) => {}
        Err(err) => {
            eprintln!("[collector] SIGKILL process group failed: {err}; hard-killing CLI child");
            let _ = child.kill().await;
            return;
        }
    }

    if timeout(Duration::from_secs(1), child.wait()).await.is_err() {
        let _ = child.kill().await;
    }
}

/// Kill any orphaned collector still holding the health-check port from a
/// previous run (common during Tauri dev hot-reload).
fn kill_orphaned_collector() {
    everr_core::collector::kill_processes_on_port(HEALTHCHECK_PORT, "orphaned collector process");
}

/// Waits until the collector leaves the `Starting` state (or the deadline
/// elapses), returning the resulting status snapshot.
async fn wait_until_settled(
    mut state_rx: watch::Receiver<TelemetryState>,
    deadline: Duration,
) -> CollectorStatusResponse {
    let start = Instant::now();
    loop {
        if !matches!(&*state_rx.borrow(), TelemetryState::Starting) {
            return status_response(&state_rx.borrow());
        }
        let Some(remaining) = deadline.checked_sub(start.elapsed()) else {
            return status_response(&state_rx.borrow());
        };
        if timeout(remaining, state_rx.changed()).await.is_err() {
            return status_response(&state_rx.borrow());
        }
        if state_rx.has_changed().is_err() {
            return status_response(&state_rx.borrow());
        }
    }
}

pub async fn wait_for_disabled_state(
    mut state_rx: watch::Receiver<TelemetryState>,
    deadline: Duration,
) -> bool {
    let is_disabled = |state: &TelemetryState| matches!(state, TelemetryState::Disabled { .. });
    if is_disabled(&state_rx.borrow()) {
        return true;
    }

    let start = Instant::now();
    loop {
        let Some(remaining) = deadline.checked_sub(start.elapsed()) else {
            return is_disabled(&state_rx.borrow());
        };
        match timeout(remaining, state_rx.changed()).await {
            Ok(Ok(())) => {
                if is_disabled(&state_rx.borrow_and_update()) {
                    return true;
                }
            }
            Ok(Err(_)) | Err(_) => return is_disabled(&state_rx.borrow()),
        }
    }
}

/// Test helper that spawns the collector without requiring a Tauri AppHandle.
pub async fn spawn_cli_collector_detached(
    binary: &Path,
    telemetry_dir: &Path,
) -> std::io::Result<DetachedSidecar> {
    let child = spawn_cli_collector_with(binary, |command| {
        command
            .env("EVERR_TELEMETRY_DIR", telemetry_dir)
            .env("EVERR_SKIP_ORPHANED_COLLECTOR_KILL", "1");
    })
    .await?;
    Ok(DetachedSidecar {
        child: tokio::sync::Mutex::new(Some(child)),
    })
}

async fn spawn_cli_collector(binary: &Path) -> std::io::Result<Child> {
    spawn_cli_collector_with(binary, |_| {}).await
}

async fn spawn_cli_collector_with(
    binary: &Path,
    configure: impl FnOnce(&mut Command),
) -> std::io::Result<Child> {
    let mut command = Command::new(binary);
    command
        .args(COLLECTOR_START_ARGS)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command.process_group(0);
    configure(&mut command);

    let mut child = command.spawn()?;

    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(everr_core::collector::forward_output(
            stdout,
            "[collector stdout]",
        ));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(everr_core::collector::forward_output(
            stderr,
            "[collector stderr]",
        ));
    }

    Ok(child)
}

/// A standalone collector process used by tests. Owns its `Child` directly and
/// drives readiness on demand via [`DetachedSidecar::wait_ready`].
pub struct DetachedSidecar {
    child: tokio::sync::Mutex<Option<Child>>,
}

impl DetachedSidecar {
    pub async fn wait_ready(&self) -> TelemetryState {
        let endpoint = format!("http://127.0.0.1:{HEALTHCHECK_PORT}/");
        if everr_core::collector::wait_healthcheck(&endpoint, Duration::from_secs(10)).await {
            TelemetryState::Ready {
                otlp_endpoint: format!("http://127.0.0.1:{OTLP_HTTP_PORT}"),
            }
        } else {
            TelemetryState::Disabled {
                reason: "healthcheck timeout".into(),
            }
        }
    }

    pub async fn shutdown(&self) {
        let mut guard = self.child.lock().await;
        stop_child(&mut guard).await;
    }
}

#[cfg(test)]
mod tests {
    use super::{collector_failure_exception, status_response, TelemetryState};

    #[test]
    fn collector_status_response_matches_api_statuses() {
        assert_eq!(
            status_response(&TelemetryState::Starting).status,
            "starting"
        );
        assert_eq!(
            status_response(&TelemetryState::Ready {
                otlp_endpoint: "http://127.0.0.1:54318".into(),
            })
            .status,
            "running"
        );
        assert_eq!(status_response(&TelemetryState::Stopped).status, "stopped");
        assert_eq!(
            status_response(&TelemetryState::Disabled {
                reason: "test".into(),
            })
            .status,
            "failed"
        );
    }

    #[test]
    fn collector_failures_are_reported_as_sanitized_exceptions() {
        let exit = collector_failure_exception("collector CLI terminated: exit status: 1");
        assert_eq!(exit.exception_type, "CollectorExitError");
        assert_eq!(exit.exception_message, "collector exited unexpectedly");
        assert_eq!(exit.reason, "collector CLI terminated: exit status: 1");

        let spawn =
            collector_failure_exception("CLI collector spawn: /Users/alice/secret/path missing");
        assert_eq!(spawn.exception_type, "CollectorStartError");
        assert_eq!(spawn.exception_message, "collector failed to start");
        assert!(!spawn.exception_message.contains("/Users/alice"));
        assert_eq!(
            spawn.reason,
            "CLI collector spawn: /Users/alice/secret/path missing"
        );
    }
}
