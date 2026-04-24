use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use nix::errno::Errno;
use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::watch;
use tokio::time::{sleep, timeout};

use crate::telemetry::ports::{HEALTHCHECK_PORT, OTLP_HTTP_PORT, SQL_HTTP_PORT};

const CONFIG_TEMPLATE: &str = include_str!("collector.yaml.tmpl");

#[derive(Debug, Clone)]
pub enum TelemetryState {
    Starting,
    Ready { otlp_endpoint: String },
    Disabled { reason: String },
}

pub struct Sidecar {
    child: std::sync::Mutex<Option<Child>>,
    command_child: std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
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

        let telemetry_dir = match everr_core::build::telemetry_dir() {
            Ok(dir) => dir,
            Err(err) => {
                return Self::disabled(format!("telemetry_dir(): {err}"));
            }
        };
        let config_path = match write_config(&telemetry_dir) {
            Ok(p) => p,
            Err(err) => {
                return Self::disabled(format!("write collector config: {err}"));
            }
        };
        let (chdb_env_name, chdb_env_value) = match chdb_lib_env_from_app(app) {
            Ok(env) => env,
            Err(err) => {
                return Self::disabled(err);
            }
        };

        let (tx, rx) = watch::channel(TelemetryState::Starting);

        let (receiver, cmd_child) =
            match app.shell().sidecar("everr-local-collector").and_then(|s| {
                s.args(["--config", &config_path.display().to_string()])
                    .env(chdb_env_name, chdb_env_value)
                    .spawn()
            }) {
                Ok(pair) => pair,
                Err(err) => {
                    return Self::disabled(format!("sidecar spawn: {err}"));
                }
            };

        tokio::spawn(forward_receiver(receiver, tx.clone()));
        tokio::spawn(monitor_readiness(tx.clone(), tx.subscribe()));

        Self {
            child: std::sync::Mutex::new(None),
            state_tx: tx,
            state_rx: rx,
            command_child: std::sync::Mutex::new(Some(cmd_child)),
        }
    }

    fn disabled(reason: String) -> Self {
        let (tx, rx) = watch::channel(TelemetryState::Disabled {
            reason: reason.clone(),
        });
        Self {
            child: std::sync::Mutex::new(None),
            state_tx: tx,
            state_rx: rx,
            command_child: std::sync::Mutex::new(None),
        }
    }

    pub async fn shutdown(&self) {
        // Try command_child first (Tauri sidecar path)
        if let Some(cmd_child) = self.command_child.lock().unwrap().take() {
            let pid = Pid::from_raw(cmd_child.pid() as i32);
            match kill(pid, Signal::SIGTERM) {
                Ok(()) => {
                    if !wait_for_disabled_state(self.state(), Duration::from_secs(3)).await {
                        eprintln!(
                            "[collector] did not report exit within 3s of SIGTERM; hard-killing"
                        );
                        let _ = cmd_child.kill();
                    }
                }
                Err(Errno::ESRCH) => {}
                Err(err) => {
                    eprintln!("[collector] SIGTERM failed: {err}; hard-killing");
                    let _ = cmd_child.kill();
                }
            }

            let _ = self.state_tx.send(TelemetryState::Disabled {
                reason: "shutdown".into(),
            });
            return;
        }

        // Fall back to tokio Child (detached/test path)
        let Some(mut child) = self.child.lock().unwrap().take() else {
            return;
        };
        let Some(pid) = child.id() else {
            let _ = child.kill().await;
            return;
        };

        match kill(Pid::from_raw(pid as i32), Signal::SIGTERM) {
            Ok(()) => {}
            Err(Errno::ESRCH) => {
                let _ = self.state_tx.send(TelemetryState::Disabled {
                    reason: "shutdown".into(),
                });
                return;
            }
            Err(err) => {
                eprintln!("[collector] SIGTERM failed: {err}; hard-killing");
                let _ = child.kill().await;
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
                eprintln!("[collector] did not exit within 3s of SIGTERM; hard-killing");
                let _ = child.kill().await;
            }
        }

        let _ = self.state_tx.send(TelemetryState::Disabled {
            reason: "shutdown".into(),
        });
    }
}

pub fn resolve_chdb_lib_path(resource_dir: &Path) -> std::io::Result<PathBuf> {
    let lib = resource_dir.join("libchdb.so");
    if lib.is_file() {
        return Ok(lib);
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!(
            "bundled chDB resource not found at {}; run pnpm desktop:prepare:debug",
            lib.display()
        ),
    ))
}

pub fn chdb_lib_env(resource_dir: &Path) -> std::io::Result<(&'static str, PathBuf)> {
    Ok(("CHDB_LIB_PATH", resolve_chdb_lib_path(resource_dir)?))
}

fn resource_dir_for_detached_sidecar(binary: &Path) -> PathBuf {
    let Some(sidecar_dir) = binary.parent() else {
        return PathBuf::from(".");
    };
    if sidecar_dir.file_name().and_then(|name| name.to_str()) == Some("desktop-sidecars") {
        if let Some(target_dir) = sidecar_dir.parent() {
            return target_dir.join("desktop-resources");
        }
    }

    sidecar_dir.to_path_buf()
}

fn chdb_lib_env_from_app(app: &AppHandle) -> Result<(&'static str, PathBuf), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|err| format!("failed to resolve app resource directory: {err}"))?;
    chdb_lib_env(&resource_dir).map_err(|err| err.to_string())
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

fn render_config(telemetry_dir: &Path) -> String {
    CONFIG_TEMPLATE
        .replace("{OTLP_PORT}", &OTLP_HTTP_PORT.to_string())
        .replace("{HEALTH_PORT}", &HEALTHCHECK_PORT.to_string())
        .replace("{SQL_HTTP_PORT}", &SQL_HTTP_PORT.to_string())
        .replace("{TELEMETRY_DIR}", &telemetry_dir.display().to_string())
}

fn write_config(telemetry_dir: &Path) -> std::io::Result<PathBuf> {
    fs::create_dir_all(telemetry_dir)?;
    let config_path = telemetry_dir.join(".collector.yaml");
    fs::write(&config_path, render_config(telemetry_dir))?;
    Ok(config_path)
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

async fn forward_receiver(
    mut receiver: tauri::async_runtime::Receiver<tauri_plugin_shell::process::CommandEvent>,
    state_tx: watch::Sender<TelemetryState>,
) {
    use tauri_plugin_shell::process::CommandEvent;
    while let Some(event) = receiver.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                eprintln!("[collector stdout] {}", String::from_utf8_lossy(&bytes));
            }
            CommandEvent::Stderr(bytes) => {
                eprintln!("[collector stderr] {}", String::from_utf8_lossy(&bytes));
            }
            CommandEvent::Error(err) => eprintln!("[collector] error: {err}"),
            CommandEvent::Terminated(payload) => {
                eprintln!("[collector] terminated: {payload:?}");
                let _ = state_tx.send(TelemetryState::Disabled {
                    reason: format!("collector terminated: {payload:?}"),
                });
                break;
            }
            _ => {}
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
pub async fn spawn_collector_detached(
    binary: &Path,
    telemetry_dir: &Path,
) -> std::io::Result<DetachedSidecar> {
    let config_path = write_config(telemetry_dir)?;
    let resource_dir = resource_dir_for_detached_sidecar(binary);
    let (chdb_env_name, chdb_env_value) = chdb_lib_env(&resource_dir)?;
    let mut child = Command::new(binary)
        .arg("--config")
        .arg(&config_path)
        .env(chdb_env_name, chdb_env_value)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(forward_output(stdout, "[collector stdout]"));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(forward_output(stderr, "[collector stderr]"));
    }

    let (tx, rx) = watch::channel(TelemetryState::Starting);
    Ok(DetachedSidecar {
        inner: Sidecar {
            child: std::sync::Mutex::new(Some(child)),
            command_child: std::sync::Mutex::new(None),
            state_tx: tx,
            state_rx: rx,
        },
    })
}

pub struct DetachedSidecar {
    inner: Sidecar,
}

impl DetachedSidecar {
    pub async fn wait_ready(&self) -> TelemetryState {
        let endpoint = format!("http://127.0.0.1:{HEALTHCHECK_PORT}/");
        if wait_healthcheck(&endpoint, Duration::from_secs(3)).await {
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
