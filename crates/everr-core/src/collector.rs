use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::time::sleep;

#[cfg(unix)]
use nix::sys::signal::{Signal, kill};
#[cfg(unix)]
use nix::unistd::Pid;

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

pub async fn forward_output<R: tokio::io::AsyncRead + Unpin>(reader: R, prefix: &'static str) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        eprintln!("{prefix} {line}");
    }
}

#[cfg(unix)]
pub fn kill_processes_on_port(port: u16, label: &str) {
    let output = match std::process::Command::new("lsof")
        .args(["-ti", &format!("tcp:{port}")])
        .output()
    {
        Ok(o) => o,
        Err(_) => return,
    };
    let pids = String::from_utf8_lossy(&output.stdout);
    for token in pids.split_whitespace() {
        if let Ok(pid) = token.parse::<i32>() {
            eprintln!("[collector] killing {label} {pid} on port {port}");
            let _ = kill(Pid::from_raw(pid), Signal::SIGKILL);
        }
    }
}

#[cfg(not(unix))]
pub fn kill_processes_on_port(_port: u16, _label: &str) {}
