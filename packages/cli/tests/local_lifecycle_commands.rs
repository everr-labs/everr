#![cfg(all(everr_embedded_collector_assets, everr_embedded_local_ui))]

use std::{
    net::{TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

use serde_json::{Value, json};

struct Instance {
    data: tempfile::TempDir,
    origins: Vec<String>,
}

impl Instance {
    fn new() -> Self {
        let ports: Vec<_> = (0..3)
            .map(|_| TcpListener::bind("127.0.0.1:0").unwrap())
            .collect();
        Self {
            data: tempfile::tempdir().unwrap(),
            origins: ports
                .iter()
                .map(|p| format!("http://{}", p.local_addr().unwrap()))
                .collect(),
        }
    }

    fn command(&self) -> Command {
        let mut command = Command::new(assert_cmd::cargo::cargo_bin!("everr"));
        command
            .env("EVERR_SQL_HTTP_ORIGIN", &self.origins[0])
            .env("EVERR_OTLP_HTTP_ORIGIN", &self.origins[1])
            .env("EVERR_LOCAL_UI_ORIGIN", &self.origins[2])
            .env("EVERR_TELEMETRY_DIR", self.data.path())
            .env("EVERR_LOCAL_LOG_DIR", self.data.path().join("logs"))
            .env("OTEL_EXPORTER_OTLP_ENDPOINT", &self.origins[1]);
        command
    }

    fn run(&self, args: &[&str]) -> String {
        let mut command = assert_cmd::Command::from_std(self.command());
        let output = command
            .args(args)
            .timeout(Duration::from_secs(30))
            .assert()
            .success()
            .get_output()
            .clone();
        String::from_utf8(output.stdout).unwrap()
    }

    fn identity(&self) -> Value {
        reqwest::blocking::get(format!("{}/health", self.origins[2]))
            .unwrap()
            .json()
            .unwrap()
    }

    fn wait_ready(&self) {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            let output = self.command().args(["local", "status"]).output().unwrap();
            if output.status.success() {
                return;
            }
            assert!(Instant::now() < deadline, "instance did not become ready");
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn wait_log(&self, marker: &str) {
        let sql = format!(
            "SELECT Body FROM logs WHERE Timestamp > now() - INTERVAL 10 MINUTE AND ServiceName = 'local-detach-test' AND Body = '{marker}' LIMIT 1"
        );
        let deadline = Instant::now() + Duration::from_secs(10);
        while !self
            .run(&["local", "query", &sql, "--format", "ndjson"])
            .contains(marker)
        {
            assert!(Instant::now() < deadline, "fresh test log not ingested");
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn assert_stopped(&self) {
        let output = self.command().args(["local", "status"]).output().unwrap();
        assert_eq!(output.status.code(), Some(2));
        for origin in &self.origins {
            assert!(TcpStream::connect(origin.trim_start_matches("http://")).is_err());
        }
    }
}

impl Drop for Instance {
    fn drop(&mut self) {
        let _ = self.command().args(["local", "stop"]).output();
    }
}

struct Foreground(Child);
impl Drop for Foreground {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn detached_and_foreground_instances_share_the_full_lifecycle() {
    let instance = Instance::new();
    let log_dir = instance.data.path().join("logs");
    std::fs::create_dir(&log_dir).unwrap();
    // Force rotation from real supervisor output, without restarting it.
    let seed = vec![b'x'; 5 * 1024 * 1024 - 64];
    std::fs::write(log_dir.join("local.log"), &seed).unwrap();
    let output = instance.run(&["local", "start", "-d", "--no-open"]);
    let endpoints = format!(
        "otlp: {}\nsql: {}\nui: {}\n",
        instance.origins[1], instance.origins[0], instance.origins[2]
    );
    assert_eq!(
        output,
        format!("{endpoints}log: {}\n", log_dir.join("local.log").display())
    );
    let identity = instance.identity();
    assert_eq!(
        instance.run(&["local", "start", "--detach", "--no-open"]),
        endpoints
    );
    assert_eq!(instance.identity(), identity);

    let marker = format!(
        "detach-{}",
        instance.data.path().file_name().unwrap().to_string_lossy()
    );
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
        .to_string();
    reqwest::blocking::Client::new().post(format!("{}/v1/logs",instance.origins[1]))
        .json(&json!({"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"local-detach-test"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":now,"severityNumber":9,"severityText":"INFO","body":{"stringValue":marker}}]}]}]}))
        .send().unwrap().error_for_status().unwrap();
    instance.wait_log(&marker);
    let restarted: Value = reqwest::blocking::Client::new()
        .post(format!(
            "{}/api/commands/restart_collector",
            instance.origins[2]
        ))
        .header("origin", &instance.origins[2])
        .header("x-everr-local", "1")
        .json(&json!({}))
        .send()
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(restarted["status"], "running");
    assert_eq!(instance.identity(), identity);
    instance.wait_log(&marker);

    assert!(instance.run(&["local", "stop"]).contains("Everr stopped"));
    instance.assert_stopped();
    let archived = std::fs::read(log_dir.join("local.log.1")).unwrap();
    assert_eq!(archived.len(), 5 * 1024 * 1024);
    assert!(archived.starts_with(&seed));
    let log = std::fs::read_to_string(log_dir.join("local.log")).unwrap();
    let output = format!(
        "{}{}",
        String::from_utf8_lossy(&archived[seed.len()..]),
        log
    );
    assert!(output.contains(&endpoints), "captured output: {output}");
    assert!(!instance.data.path().join("local.log").exists());
    assert!(instance.run(&["local", "stop"]).contains("already stopped"));

    let mut foreground = Foreground(
        instance
            .command()
            .args(["local", "start", "--no-open"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    instance.wait_ready();
    assert_ne!(instance.identity()["instance_id"], identity["instance_id"]);
    instance.wait_log(&marker);
    instance.run(&["local", "stop"]);
    assert!(foreground.0.wait().unwrap().success());
    instance.assert_stopped();
    assert!(
        instance
            .data
            .path()
            .join("logs/local.log")
            .metadata()
            .unwrap()
            .len()
            > 0
    );
}

#[test]
fn unavailable_log_directory_does_not_start_a_supervisor() {
    let instance = Instance::new();
    let blocker = instance.data.path().join("not-a-directory");
    std::fs::write(&blocker, "blocked").unwrap();
    let mut command = instance.command();
    command.env("EVERR_LOCAL_LOG_DIR", &blocker);
    let mut command = assert_cmd::Command::from_std(command);
    let assertion = command
        .args(["local", "start", "-d", "--no-open"])
        .timeout(Duration::from_secs(30))
        .assert()
        .failure();
    let error = String::from_utf8_lossy(&assertion.get_output().stderr);
    assert!(
        error.contains("background process exited") && error.contains("create local log directory"),
        "{error}"
    );
    instance.assert_stopped();
}

#[test]
fn failed_detached_start_cleans_up_and_reports_its_log() {
    let instance = Instance::new();
    let blocker = TcpListener::bind(instance.origins[1].trim_start_matches("http://")).unwrap();
    let mut command = assert_cmd::Command::from_std(instance.command());
    let assertion = command
        .args(["local", "start", "-d", "--no-open"])
        .timeout(Duration::from_secs(30))
        .assert()
        .failure();
    let error = String::from_utf8_lossy(&assertion.get_output().stderr);
    assert!(
        error.contains("background process exited")
            && error.contains("local.log")
            && error.contains("is unavailable"),
        "{error}"
    );
    assert!(TcpStream::connect(instance.origins[2].trim_start_matches("http://")).is_err());
    assert!(
        std::fs::read_to_string(instance.data.path().join("logs/local.log"))
            .unwrap()
            .contains("is unavailable")
    );
    drop(blocker);
    assert_eq!(instance.run(&["local", "start", "-d", "--quiet"]), "");
    instance.run(&["local", "stop"]);
    instance.assert_stopped();
}
