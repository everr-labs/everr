mod support;

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use predicates::str::{contains, diff};
use support::CliTestEnv;

#[test]
fn endpoint_prints_only_collector_url() {
    let env = CliTestEnv::new();
    let collector_url = format!("{}\n", everr_core::build::otlp_http_origin());

    env.command()
        .args(["telemetry", "endpoint"])
        .assert()
        .success()
        .stdout(diff(collector_url))
        .stderr(diff(""));
}

#[test]
fn status_reports_running_when_collector_healthcheck_is_up() {
    let env = CliTestEnv::new();
    let health_origin = spawn_health_server(200);

    env.command()
        .env("EVERR_HEALTHCHECK_ORIGIN", health_origin)
        .args(["telemetry", "status"])
        .assert()
        .success()
        .stdout(contains("collector: running"))
        .stdout(contains(everr_core::build::otlp_http_origin()))
        .stderr(diff(""));
}

#[test]
fn status_exits_two_when_collector_healthcheck_is_down() {
    let env = CliTestEnv::new();

    env.command()
        .env("EVERR_HEALTHCHECK_ORIGIN", "http://127.0.0.1:9")
        .args(["telemetry", "status"])
        .assert()
        .code(2)
        .stdout(contains("collector: stopped"))
        .stderr(contains("everr telemetry start"));
}

#[test]
fn query_connection_error_mentions_start_command() {
    let env = CliTestEnv::new();

    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", "http://127.0.0.1:9")
        .args(["telemetry", "query", "SHOW TABLES"])
        .assert()
        .code(2)
        .stderr(contains("everr telemetry start"))
        .stderr(contains("Everr Desktop"));
}

fn spawn_health_server(status: u16) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind health server");
    let addr = listener.local_addr().expect("read health addr");
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept health request");
        read_request(&mut stream);
        let body = if status == 200 { "ok\n" } else { "down\n" };
        let head = format!(
            "HTTP/1.1 {status} OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(head.as_bytes()).expect("write head");
        stream.write_all(body.as_bytes()).expect("write body");
    });
    format!("http://{addr}")
}

fn read_request(stream: &mut TcpStream) {
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .expect("set read timeout");
    let mut buf = [0_u8; 1024];
    loop {
        let read = stream.read(&mut buf).expect("read request");
        if read == 0 || buf[..read].windows(4).any(|w| w == b"\r\n\r\n") {
            return;
        }
    }
}
