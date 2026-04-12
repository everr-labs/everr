mod support;

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

fn collector_binary() -> Option<PathBuf> {
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .find(|p| p.join("target").is_dir())?
        .to_path_buf();
    let triple = format!("{}-apple-darwin", std::env::consts::ARCH);
    let candidate = workspace_root
        .join("target")
        .join("desktop-sidecars")
        .join(format!("everr-local-collector-{triple}"));
    candidate.exists().then_some(candidate)
}

#[test]
fn collector_writes_files_that_cli_can_query() {
    let Some(binary) = collector_binary() else {
        eprintln!(
            "skipping: collector binary not at target/desktop-sidecars/. \
             Run `pnpm desktop:prepare:debug` to build it."
        );
        return;
    };

    let env = support::CliTestEnv::new();
    let telemetry_dir = env.telemetry_dir();
    std::fs::create_dir_all(&telemetry_dir).expect("mkdir");

    let config_path = telemetry_dir.join(".collector.yaml");
    let config = format!(
        r#"
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:54330
processors:
  batch:
    timeout: 1s
exporters:
  file:
    path: "{}/otlp.json"
    format: json
extensions:
  health_check:
    endpoint: 127.0.0.1:54331
service:
  extensions: [health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [file]
  telemetry:
    metrics:
      level: none
    logs:
      level: warn
"#,
        telemetry_dir.display()
    );
    std::fs::write(&config_path, config).expect("write config");

    let mut child = Command::new(&binary)
        .arg("--config")
        .arg(&config_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn collector");

    // Wait for healthcheck.
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(200))
        .build()
        .unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let mut ready = false;
    while std::time::Instant::now() < deadline {
        // Check if the process exited early (config error, port conflict, etc.).
        if let Some(status) = child.try_wait().expect("try_wait") {
            let stderr = child.stderr.take().map(|mut s| {
                let mut buf = String::new();
                std::io::Read::read_to_string(&mut s, &mut buf).ok();
                buf
            });
            panic!(
                "collector exited early with {status}. stderr:\n{}",
                stderr.unwrap_or_default()
            );
        }
        if let Ok(resp) = client.get("http://127.0.0.1:54331/").send() {
            if resp.status().is_success() {
                ready = true;
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(ready, "healthcheck timed out after 10s");

    // POST a realistic OTLP traces payload with a recent timestamp.
    let now_ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let start_ns = now_ns.to_string();
    let end_ns = (now_ns + 100_000_000).to_string(); // +100ms
    let payload = serde_json::json!({
        "resourceSpans": [{
            "resource": { "attributes": [
                { "key": "service.name", "value": { "stringValue": "e2e-test" } }
            ]},
            "scopeSpans": [{
                "scope": { "name": "e2e" },
                "spans": [{
                    "traceId": "00112233445566778899aabbccddeeff",
                    "spanId": "0011223344556677",
                    "name": "e2e.span.one",
                    "kind": 1,
                    "startTimeUnixNano": start_ns,
                    "endTimeUnixNano": end_ns,
                    "status": { "code": 1 }
                }]
            }]
        }]
    });
    let resp = client
        .post("http://127.0.0.1:54330/v1/traces")
        .header("content-type", "application/json")
        .body(payload.to_string())
        .send()
        .expect("POST OTLP");
    assert!(
        resp.status().is_success(),
        "OTLP POST failed: {}",
        resp.status()
    );

    // Wait for the batchprocessor to flush (1s config + margin).
    std::thread::sleep(Duration::from_secs(2));

    // Verify the file was written.
    let otlp_file = telemetry_dir.join("otlp.json");
    assert!(
        otlp_file.exists(),
        "otlp.json not found at {}. Contents of {}: {:?}",
        otlp_file.display(),
        telemetry_dir.display(),
        std::fs::read_dir(&telemetry_dir)
            .map(|rd| rd
                .filter_map(|e| e.ok().map(|e| e.file_name()))
                .collect::<Vec<_>>())
            .unwrap_or_default()
    );
    // Query via the CLI.
    let output = env
        .command()
        .args([
            "telemetry",
            "traces",
            "--telemetry-dir",
            telemetry_dir.to_str().unwrap(),
            "--since",
            "100d",
            "--format",
            "json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let json = support::parse_stdout_json(&output);
    let rows = json["rows"].as_array().expect("rows is array");
    let names: Vec<_> = rows
        .iter()
        .filter_map(|r| r.get("name").and_then(|n| n.as_str()))
        .collect();
    assert!(
        names.iter().any(|n| *n == "e2e.span.one"),
        "expected e2e.span.one in rows: {names:?}"
    );

    // Graceful shutdown.
    unsafe {
        libc::kill(child.id() as i32, libc::SIGTERM);
    }
    let _ = child.wait();
}
