mod support;

use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::Command;
use std::process::Stdio;
use std::time::{Duration, Instant};

use tempfile::TempDir;

#[test]
fn telemetry_query_happy_path() {
    let Some(collector_binary) = resolve_collector_binary() else {
        eprintln!(
            "skipping: collector binary not found under collector/build-local/. \
             Run `pnpm desktop:prepare:debug` to build it."
        );
        return;
    };

    let collector_home = TempDir::new().expect("create collector tempdir");
    let cli_home = TempDir::new().expect("create cli tempdir");
    let otlp_port = pick_free_port();
    let sql_port = pick_free_port();
    let health_port = pick_free_port();

    let collector_config = collector_home.path().join("collector.yaml");
    let chdb_path = collector_home.path().join("chdb");
    fs::create_dir_all(&chdb_path).expect("create chdb dir");
    fs::write(
        &collector_config,
        format!(
            r#"
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:{otlp_port}

processors:
  batch:
    timeout: 500ms

exporters:
  chdb:
    path: "{chdb_path}"
    ttl: 48h

extensions:
  health_check:
    endpoint: 127.0.0.1:{health_port}
  sqlhttp:
    endpoint: 127.0.0.1:{sql_port}
    path: "{chdb_path}"

service:
  extensions: [health_check, sqlhttp]
  pipelines:
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [chdb]
  telemetry:
    metrics:
      level: none
"#,
            otlp_port = otlp_port,
            sql_port = sql_port,
            health_port = health_port,
            chdb_path = chdb_path.display(),
        ),
    )
    .expect("write collector config");

    let mut collector_process = Command::new(&collector_binary)
        .arg("--config")
        .arg(&collector_config)
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn collector");
    let mut collector_stderr = collector_process
        .stderr
        .take()
        .expect("collector stderr");
    let mut collector = CollectorGuard::spawn(collector_process);

    if !wait_for_health(&mut collector.child, &mut collector_stderr, health_port) {
        return;
    }
    push_log(otlp_port);
    std::thread::sleep(Duration::from_secs(2));

    let cli_binary = copy_everr_dev_binary();
    let output = Command::new(&cli_binary.path)
        .env("HOME", cli_home.path())
        .env("XDG_CONFIG_HOME", cli_home.path().join("config"))
        .env("XDG_DATA_HOME", cli_home.path().join("data"))
        .env(
            "EVERR_SQL_HTTP_ORIGIN",
            format!("http://127.0.0.1:{sql_port}"),
        )
        .args([
            "telemetry",
            "query",
            "SELECT count() AS c FROM otel_logs",
            "--format",
            "ndjson",
        ])
        .output()
        .expect("run telemetry query");

    assert!(
        output.status.success(),
        "cli failed: status={:?}\nstderr={}\nstdout={}",
        output.status,
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains(r#""c":1"#),
        "unexpected stdout: {stdout}"
    );
}

fn resolve_collector_binary() -> Option<PathBuf> {
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../collector/build-local/everr-local-collector");
    candidate.exists().then_some(candidate)
}

fn copy_everr_dev_binary() -> DevBinary {
    let source = assert_cmd::cargo::cargo_bin!("everr");
    let dir = TempDir::new().expect("create cli binary tempdir");
    let target = dir.path().join("everr-dev");
    fs::copy(&source, &target).expect("copy everr binary");
    DevBinary { _dir: dir, path: target }
}

fn pick_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .expect("bind ephemeral port")
        .local_addr()
        .expect("read local addr")
        .port()
}

fn wait_for_health(
    collector: &mut std::process::Child,
    collector_stderr: &mut std::process::ChildStderr,
    port: u16,
) -> bool {
    let client = reqwest::blocking::Client::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    let urls = [
        format!("http://127.0.0.1:{port}/"),
        format!("http://127.0.0.1:{port}/health"),
    ];

    while Instant::now() < deadline {
        if let Some(status) = collector.try_wait().expect("poll collector") {
            let mut stderr = String::new();
            let _ = collector_stderr.read_to_string(&mut stderr);
            if stderr.contains("unknown type: \"chdb\"")
                || stderr.contains("unknown type: \"sqlhttp\"")
            {
                eprintln!(
                    "skipping: built collector binary does not include chdb/sqlhttp yet (exit: {status}). \
                     Rebuild collector/build-local/everr-local-collector from the current source tree."
                );
                return false;
            }
            panic!(
                "collector exited before health check succeeded: {status}\nstderr={stderr}"
            );
        }

        for url in &urls {
            if client
                .get(url)
                .send()
                .map(|resp| resp.status().is_success())
                .unwrap_or(false)
            {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    panic!("timed out waiting for collector health endpoint on port {port}");
}

fn push_log(otlp_port: u16) {
    let body = format!(
        r#"{{"resourceLogs":[{{"resource":{{"attributes":[{{"key":"service.name","value":{{"stringValue":"svc"}}}}]}},"scopeLogs":[{{"logRecords":[{{"timeUnixNano":"{}","severityText":"INFO","body":{{"stringValue":"hello"}}}}]}}]}}]}}"#,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos()
    );
    reqwest::blocking::Client::new()
        .post(format!("http://127.0.0.1:{otlp_port}/v1/logs"))
        .header("content-type", "application/json")
        .body(body)
        .send()
        .expect("send otlp log")
        .error_for_status()
        .expect("otlp response");
}

struct CollectorGuard {
    child: std::process::Child,
}

impl CollectorGuard {
    fn spawn(child: std::process::Child) -> Self {
        Self { child }
    }
}

impl Drop for CollectorGuard {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct DevBinary {
    _dir: TempDir,
    path: PathBuf,
}
