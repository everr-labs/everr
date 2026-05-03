mod support;

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

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

struct OtlpLogServer {
    origin: String,
    bodies: Arc<Mutex<Vec<String>>>,
}

impl OtlpLogServer {
    fn start() -> Self {
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
