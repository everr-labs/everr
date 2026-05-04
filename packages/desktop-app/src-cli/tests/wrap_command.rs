mod support;

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command as ProcessCommand, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use predicates::str::{contains, diff};
use support::CliTestEnv;

#[test]
fn wrap_preserves_output_and_sends_logs_to_collector() {
    let collector = OtlpLogServer::start();
    let env = CliTestEnv::new();

    env.command()
        .env("EVERR_OTLP_HTTP_ORIGIN", collector.origin())
        .args([
            "wrap",
            "--",
            "sh",
            "-c",
            "printf 'hello stdout\\n'; printf 'hello stderr\\n' >&2",
        ])
        .assert()
        .success()
        .stdout(diff("hello stdout\n"))
        .stderr(diff("hello stderr\n"));

    let bodies = collector.bodies();
    assert!(
        bodies.iter().any(|body| body.contains("hello stdout")),
        "expected stdout log in OTLP payloads, got: {bodies:#?}"
    );
    assert!(
        bodies.iter().any(|body| body.contains("hello stderr")),
        "expected stderr log in OTLP payloads, got: {bodies:#?}"
    );
    assert!(
        bodies
            .iter()
            .any(|body| body.contains(r#""everr.wrap.stream""#) && body.contains("stdout")),
        "expected stdout stream attribute, got: {bodies:#?}"
    );
    assert!(
        bodies
            .iter()
            .any(|body| body.contains(r#""everr.wrap.stream""#) && body.contains("stderr")),
        "expected stderr stream attribute, got: {bodies:#?}"
    );
    assert!(
        bodies
            .iter()
            .any(|body| body.contains(r#""service.name""#) && body.contains("everr-wrap-sh")),
        "expected command-specific service name, got: {bodies:#?}"
    );
}

#[test]
fn wrap_forwards_partial_output_before_newline() {
    let collector = OtlpLogServer::start();
    let env = CliTestEnv::new();
    let mut wrapped = everr_process(&env, collector.origin())
        .args([
            "wrap",
            "--",
            "sh",
            "-c",
            "printf partial; sleep 3; printf ' done\\n'",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn wrapped command");
    let mut wrapped_stdout = wrapped.stdout.take().expect("wrapped stdout");

    let (first_tx, first_rx) = mpsc::channel();
    let reader = thread::spawn(move || {
        let mut first = [0_u8; 7];
        let result = wrapped_stdout
            .read_exact(&mut first)
            .map(|_| String::from_utf8_lossy(&first).to_string());
        let _ = first_tx.send(result);

        let mut rest = String::new();
        let _ = wrapped_stdout.read_to_string(&mut rest);
        rest
    });

    match first_rx.recv_timeout(Duration::from_millis(1500)) {
        Ok(Ok(output)) => assert_eq!(output, "partial"),
        Ok(Err(err)) => panic!("read partial output: {err}"),
        Err(err) => {
            let _ = wrapped.kill();
            let _ = wrapped.wait();
            panic!("partial output was not forwarded before newline: {err}");
        }
    }

    let status = wrapped.wait().expect("wait for wrapped command");
    assert!(status.success(), "wrapped command failed: {status}");
    assert_eq!(reader.join().expect("join stdout reader"), " done\n");
}

#[test]
fn wrap_preserves_wrapped_command_exit_code() {
    let collector = OtlpLogServer::start();
    let env = CliTestEnv::new();

    env.command()
        .env("EVERR_OTLP_HTTP_ORIGIN", collector.origin())
        .args(["wrap", "--", "sh", "-c", "printf 'before fail\\n'; exit 7"])
        .assert()
        .code(7)
        .stdout(diff("before fail\n"));
}

#[test]
fn wrap_refuses_to_run_when_collector_is_unavailable() {
    let env = CliTestEnv::new();

    env.command()
        .env("EVERR_OTLP_HTTP_ORIGIN", "http://127.0.0.1:9")
        .args(["wrap", "--", "sh", "-c", "printf 'should not run\\n'"])
        .assert()
        .code(2)
        .stdout(diff(""))
        .stderr(contains("telemetry collector isn't running"));
}

#[test]
fn wrap_exits_when_stdout_consumer_closes_pipe() {
    let collector = OtlpLogServer::start();
    let env = CliTestEnv::new();
    let mut wrapped = everr_process(&env, collector.origin())
        .args([
            "wrap",
            "--",
            "sh",
            "-c",
            "i=0; while [ $i -lt 200000 ]; do echo y; i=$((i + 1)); done",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn wrapped command");
    let wrapped_stdout = wrapped.stdout.take().expect("wrapped stdout");
    let mut wrapped_stderr = wrapped.stderr.take().expect("wrapped stderr");

    let mut head = ProcessCommand::new("head")
        .args(["-n", "1"])
        .stdin(Stdio::from(wrapped_stdout))
        .stdout(Stdio::null())
        .spawn()
        .expect("spawn head");

    let head_status = head.wait().expect("wait for head");
    assert!(head_status.success(), "head failed: {head_status}");

    let status = wait_for_child(&mut wrapped, Duration::from_secs(3))
        .expect("wrap should exit after stdout pipe closes");
    assert!(
        !status.success(),
        "wrap should report the closed output pipe"
    );

    let mut stderr = String::new();
    wrapped_stderr
        .read_to_string(&mut stderr)
        .expect("read wrapped stderr");
    assert!(
        !stderr.contains("stdout forwarding task failed") && !stderr.contains("Broken pipe"),
        "wrap should not print an internal pipe error, got: {stderr}"
    );
}

#[test]
fn slow_collector_does_not_throttle_wrapped_output() {
    let collector = OtlpLogServer::start_with_non_probe_delay(Duration::from_millis(300));
    let env = CliTestEnv::new();
    let started = Instant::now();
    let mut wrapped = everr_process(&env, collector.origin())
        .args([
            "wrap",
            "--",
            "sh",
            "-c",
            "i=0; while [ $i -lt 2000 ]; do echo line-$i; i=$((i + 1)); done",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn wrapped command");

    let status = wait_for_child(&mut wrapped, Duration::from_secs(3))
        .expect("wrap should not wait for collector queue space while reading output");
    assert!(status.success(), "wrapped command failed: {status}");
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "wrap took too long: {:?}",
        started.elapsed()
    );
}

struct OtlpLogServer {
    origin: String,
    bodies: Arc<Mutex<Vec<String>>>,
}

impl OtlpLogServer {
    fn start() -> Self {
        Self::start_with_delay(None)
    }

    fn start_with_non_probe_delay(delay: Duration) -> Self {
        Self::start_with_delay(Some(delay))
    }

    fn start_with_delay(response_delay_non_probe: Option<Duration>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind OTLP test server");
        let origin = format!("http://{}", listener.local_addr().expect("server addr"));
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let thread_bodies = Arc::clone(&bodies);

        thread::spawn(move || {
            listener
                .set_nonblocking(true)
                .expect("set listener nonblocking");
            let deadline = std::time::Instant::now() + Duration::from_secs(10);

            while std::time::Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        if let Some(body) = read_request_body(&mut stream) {
                            if !is_probe_body(&body) {
                                if let Some(delay) = response_delay_non_probe {
                                    thread::sleep(delay);
                                }
                            }
                            thread_bodies.lock().expect("lock bodies").push(body);
                        }
                        write_ok(&mut stream);
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });

        Self { origin, bodies }
    }

    fn origin(&self) -> &str {
        &self.origin
    }

    fn bodies(&self) -> Vec<String> {
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        loop {
            let current = self.bodies.lock().expect("lock bodies").clone();
            if current.len() >= 2 || std::time::Instant::now() >= deadline {
                return current;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}

fn everr_process(env: &CliTestEnv, collector_origin: &str) -> ProcessCommand {
    let mut command = ProcessCommand::new(assert_cmd::cargo::cargo_bin!("everr"));
    command.env("HOME", &env.home_dir);
    command.env("XDG_CONFIG_HOME", &env.config_dir);
    command.env("XDG_DATA_HOME", env.home_dir.join(".local").join("share"));
    command.env("EVERR_OTLP_HTTP_ORIGIN", collector_origin);
    command
}

fn wait_for_child(
    child: &mut std::process::Child,
    timeout: Duration,
) -> Option<std::process::ExitStatus> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait().expect("poll child") {
            return Some(status);
        }
        thread::sleep(Duration::from_millis(25));
    }

    let _ = child.kill();
    let _ = child.wait();
    None
}

fn read_request_body(stream: &mut TcpStream) -> Option<String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .expect("set read timeout");

    let mut buf = Vec::new();
    let mut chunk = [0_u8; 1024];
    let mut header_len = None;

    while header_len.is_none() {
        let read = stream.read(&mut chunk).expect("read request");
        if read == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..read]);
        header_len = find_header_end(&buf);
    }

    let header_len = header_len.expect("header end");
    let header_text = String::from_utf8_lossy(&buf[..header_len]);
    let content_length = header_text
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);

    let body_start = header_len + 4;
    let body_read = buf.len().saturating_sub(body_start);
    let mut remaining = content_length.saturating_sub(body_read);
    while remaining > 0 {
        let read = stream.read(&mut chunk).expect("read request body");
        if read == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..read]);
        remaining = remaining.saturating_sub(read);
    }

    Some(String::from_utf8_lossy(&buf[body_start..]).to_string())
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn write_ok(stream: &mut TcpStream) {
    stream
        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
        .expect("write response");
}

fn is_probe_body(body: &str) -> bool {
    body.trim() == r#"{"resourceLogs":[]}"#
}
