use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use nix::errno::Errno;
use nix::sys::signal::{Signal, kill, killpg};
use nix::unistd::Pid;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::watch;
use tokio::time::{sleep, timeout};

use crate::telemetry::ports::{HEALTHCHECK_PORT, OTLP_HTTP_PORT};

#[derive(Debug, Clone)]
pub enum TelemetryState {
    Starting,
    Ready { otlp_endpoint: String },
    Disabled { reason: String },
}

pub struct Sidecar {
    child: std::sync::Arc<std::sync::Mutex<Option<Child>>>,
    state_tx: watch::Sender<TelemetryState>,
    state_rx: watch::Receiver<TelemetryState>,
}

impl Sidecar {
    pub fn state(&self) -> watch::Receiver<TelemetryState> {
        self.state_rx.clone()
    }

    /// Starts the collector from inside Tauri's `setup()` callback.
    pub async fn start(app: &AppHandle) -> Self {
        kill_orphaned_collector();

        let cli_path = match crate::cli::bundled_cli_path(app) {
            Ok(path) => path,
            Err(err) => {
                return Self::disabled(format!("bundled CLI: {err}"));
            }
        };

        let (tx, rx) = watch::channel(TelemetryState::Starting);
        let child = match spawn_cli_collector(&cli_path).await {
            Ok(child) => child,
            Err(err) => {
                return Self::disabled(format!("CLI collector spawn: {err}"));
            }
        };
        let child = std::sync::Arc::new(std::sync::Mutex::new(Some(child)));

        tokio::spawn(monitor_child(child.clone(), tx.clone()));
        tokio::spawn(monitor_readiness(tx.clone(), tx.subscribe()));

        Self {
            child,
            state_tx: tx,
            state_rx: rx,
        }
    }

    fn disabled(reason: String) -> Self {
        let (tx, rx) = watch::channel(TelemetryState::Disabled {
            reason: reason.clone(),
        });
        Self {
            child: std::sync::Arc::new(std::sync::Mutex::new(None)),
            state_tx: tx,
            state_rx: rx,
        }
    }

    pub async fn shutdown(&self) {
        let Some(mut child) = self.child.lock().unwrap().take() else {
            return;
        };
        let Some(pid) = child.id() else {
            let _ = child.kill().await;
            return;
        };

        let process_group = Pid::from_raw(pid as i32);
        match killpg(process_group, Signal::SIGTERM) {
            Ok(()) => {}
            Err(Errno::ESRCH) => {
                let _ = self.state_tx.send(TelemetryState::Disabled {
                    reason: "shutdown".into(),
                });
                return;
            }
            Err(err) => {
                eprintln!("[collector] SIGTERM failed: {err}; hard-killing process group");
                hard_kill_process_group(process_group, &mut child).await;
                let _ = self.state_tx.send(TelemetryState::Disabled {
                    reason: "shutdown".into(),
                });
                return;
            }
        }

        let deadline = Duration::from_secs(3);
        match timeout(deadline, child.wait()).await {
            Ok(Ok(_)) => { /* clean exit */ }
            Ok(Err(err)) => {
                eprintln!("[collector] wait after SIGTERM failed: {err}");
            }
            Err(_) => {
                eprintln!(
                    "[collector] did not exit within 3s of SIGTERM; hard-killing process group"
                );
                hard_kill_process_group(process_group, &mut child).await;
            }
        }

        let _ = self.state_tx.send(TelemetryState::Disabled {
            reason: "shutdown".into(),
        });
    }
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
    let output = match std::process::Command::new("lsof")
        .args(["-ti", &format!("tcp:{HEALTHCHECK_PORT}")])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };
    let pids = String::from_utf8_lossy(&output.stdout);
    for token in pids.split_whitespace() {
        if let Ok(pid) = token.parse::<i32>() {
            eprintln!("[collector] killing orphaned process {pid} on port {HEALTHCHECK_PORT}");
            let _ = kill(Pid::from_raw(pid), Signal::SIGKILL);
        }
    }
}

pub async fn wait_healthcheck(endpoint: &str, deadline: Duration) -> bool {
    let start = Instant::now();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .expect("reqwest client");
    while start.elapsed() < deadline {
        if let Ok(resp) = client.get(endpoint).send().await {
            if resp.status().is_success() {
                return true;
            }
        }
        sleep(Duration::from_millis(100)).await;
    }
    false
}

pub async fn wait_for_disabled_state(
    mut state_rx: watch::Receiver<TelemetryState>,
    deadline: Duration,
) -> bool {
    if matches!(&*state_rx.borrow(), TelemetryState::Disabled { .. }) {
        return true;
    }

    let start = Instant::now();
    loop {
        let Some(remaining) = deadline.checked_sub(start.elapsed()) else {
            return matches!(&*state_rx.borrow(), TelemetryState::Disabled { .. });
        };

        match timeout(remaining, state_rx.changed()).await {
            Ok(Ok(())) => {
                if matches!(
                    &*state_rx.borrow_and_update(),
                    TelemetryState::Disabled { .. }
                ) {
                    return true;
                }
            }
            Ok(Err(_)) => return matches!(&*state_rx.borrow(), TelemetryState::Disabled { .. }),
            Err(_) => return matches!(&*state_rx.borrow(), TelemetryState::Disabled { .. }),
        }
    }
}

async fn monitor_child(
    child: std::sync::Arc<std::sync::Mutex<Option<Child>>>,
    state_tx: watch::Sender<TelemetryState>,
) {
    loop {
        let status = {
            let mut guard = child.lock().unwrap();
            let Some(child) = guard.as_mut() else {
                break;
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    guard.take();
                    Some(Ok(status))
                }
                Ok(None) => None,
                Err(err) => Some(Err(err)),
            }
        };

        match status {
            Some(Ok(status)) => {
                let _ = state_tx.send(TelemetryState::Disabled {
                    reason: format!("collector CLI terminated: {status}"),
                });
                break;
            }
            Some(Err(err)) => {
                let _ = state_tx.send(TelemetryState::Disabled {
                    reason: format!("collector CLI wait failed: {err}"),
                });
                break;
            }
            None => sleep(Duration::from_millis(250)).await,
        }
    }
}

async fn monitor_readiness(
    state_tx: watch::Sender<TelemetryState>,
    state_rx: watch::Receiver<TelemetryState>,
) {
    let endpoint = format!("http://127.0.0.1:{HEALTHCHECK_PORT}/");
    loop {
        if wait_healthcheck(&endpoint, Duration::from_secs(3)).await {
            let _ = state_tx.send(TelemetryState::Ready {
                otlp_endpoint: format!("http://127.0.0.1:{OTLP_HTTP_PORT}"),
            });
            break;
        }

        if matches!(*state_rx.borrow(), TelemetryState::Disabled { .. }) {
            break;
        }

        eprintln!("[collector] healthcheck not ready after 3s; continuing background wait");
        sleep(Duration::from_secs(1)).await;
    }
}

/// Test helper that spawns the collector without requiring a Tauri AppHandle.
pub async fn spawn_cli_collector_detached(binary: &Path) -> std::io::Result<DetachedSidecar> {
    let child = spawn_cli_collector(binary).await?;
    let child = std::sync::Arc::new(std::sync::Mutex::new(Some(child)));
    let (tx, rx) = watch::channel(TelemetryState::Starting);
    tokio::spawn(monitor_child(child.clone(), tx.clone()));
    Ok(DetachedSidecar {
        inner: Sidecar {
            child,
            state_tx: tx,
            state_rx: rx,
        },
    })
}

async fn spawn_cli_collector(binary: &Path) -> std::io::Result<Child> {
    let mut command = Command::new(binary);
    command
        .args(["telemetry", "start", "--quiet"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command.process_group(0);

    let mut child = command.spawn()?;

    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(forward_output(stdout, "[collector stdout]"));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(forward_output(stderr, "[collector stderr]"));
    }

    Ok(child)
}

pub struct DetachedSidecar {
    inner: Sidecar,
}

impl DetachedSidecar {
    pub async fn wait_ready(&self) -> TelemetryState {
        let endpoint = format!("http://127.0.0.1:{HEALTHCHECK_PORT}/");
        if wait_healthcheck(&endpoint, Duration::from_secs(10)).await {
            let otlp = format!("http://127.0.0.1:{OTLP_HTTP_PORT}");
            let state = TelemetryState::Ready {
                otlp_endpoint: otlp,
            };
            let _ = self.inner.state_tx.send(state.clone());
            state
        } else {
            let state = TelemetryState::Disabled {
                reason: "healthcheck timeout".into(),
            };
            let _ = self.inner.state_tx.send(state.clone());
            state
        }
    }

    pub async fn shutdown(&self) {
        self.inner.shutdown().await;
    }
}

async fn forward_output<R: tokio::io::AsyncRead + Unpin>(reader: R, prefix: &'static str) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        eprintln!("{prefix} {line}");
    }
}
