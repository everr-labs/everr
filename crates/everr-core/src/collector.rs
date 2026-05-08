use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::time::sleep;

use crate::build::{HEALTHCHECK_PORT, OTLP_HTTP_PORT, SQL_HTTP_PORT};

#[cfg(unix)]
use nix::sys::signal::{Signal, kill};
#[cfg(unix)]
use nix::unistd::Pid;

const CONFIG_TEMPLATE: &str = include_str!("../assets/collector.yaml.tmpl");

pub fn render_config(telemetry_dir: &Path) -> String {
    CONFIG_TEMPLATE
        .replace("{OTLP_PORT}", &OTLP_HTTP_PORT.to_string())
        .replace("{HEALTH_PORT}", &HEALTHCHECK_PORT.to_string())
        .replace("{SQL_HTTP_PORT}", &SQL_HTTP_PORT.to_string())
        .replace(
            "{TELEMETRY_DIR}",
            &escape_yaml_double_quoted(&telemetry_dir.display().to_string()),
        )
}

pub fn write_config(telemetry_dir: &Path) -> std::io::Result<PathBuf> {
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

fn escape_yaml_double_quoted(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_config_substitutes_runtime_values() {
        let rendered = render_config(Path::new("/tmp/everr local"));

        assert!(rendered.contains(&format!("127.0.0.1:{OTLP_HTTP_PORT}")));
        assert!(rendered.contains(&format!("127.0.0.1:{HEALTHCHECK_PORT}")));
        assert!(rendered.contains(&format!("127.0.0.1:{SQL_HTTP_PORT}")));
        assert!(rendered.contains(r#""/tmp/everr local/chdb""#));
        assert!(!rendered.contains("{TELEMETRY_DIR}"));
    }

    #[test]
    fn render_config_escapes_yaml_double_quoted_paths() {
        let rendered = render_config(Path::new("/tmp/everr \"quoted\" \\ path"));

        assert!(rendered.contains(r#""/tmp/everr \"quoted\" \\ path/chdb""#));
    }

    #[test]
    fn write_config_creates_telemetry_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        let telemetry_dir = dir.path().join("telemetry");

        let path = write_config(&telemetry_dir).expect("write config");

        assert_eq!(path, telemetry_dir.join(".collector.yaml"));
        assert!(path.is_file());
    }
}
