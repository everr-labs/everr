mod support;

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::time::Duration;
use std::time::SystemTime;

use predicates::prelude::PredicateBooleanExt;
use predicates::str::{contains, diff};
use support::CliTestEnv;

#[test]
fn endpoint_is_not_a_local_subcommand() {
    let env = CliTestEnv::new();

    env.command()
        .args(["local", "endpoint"])
        .assert()
        .failure()
        .stderr(contains("unrecognized subcommand"))
        .stderr(contains("endpoint"));
}

#[test]
fn status_reports_running_when_collector_healthcheck_is_up() {
    let env = CliTestEnv::new();
    let health_origin = spawn_health_server(200);

    env.command()
        .env("EVERR_HEALTHCHECK_ORIGIN", health_origin)
        .args(["local", "status"])
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
        .args(["local", "status"])
        .assert()
        .code(2)
        .stdout(contains("collector: stopped"))
        .stderr(contains("everr local start"));
}

#[test]
fn query_connection_error_mentions_start_command() {
    let env = CliTestEnv::new();

    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", "http://127.0.0.1:9")
        .args(["local", "query", "SHOW TABLES"])
        .assert()
        .code(2)
        .stderr(contains("everr local start"))
        .stderr(contains("Everr Desktop"));
}

#[cfg(unix)]
#[test]
fn query_does_not_emit_sibling_build_staleness_banner() {
    let env = CliTestEnv::new();
    let this_chdb = env.telemetry_dir().join("chdb");
    let sibling_chdb = env
        .telemetry_dir()
        .parent()
        .expect("telemetry dir has parent")
        .join("telemetry")
        .join("chdb");
    std::fs::create_dir_all(&this_chdb).expect("create current telemetry chdb dir");
    std::fs::create_dir_all(&sibling_chdb).expect("create sibling telemetry chdb dir");

    let this_flush = this_chdb.join(".last_flush");
    let sibling_flush = sibling_chdb.join(".last_flush");
    std::fs::write(&this_flush, b"").expect("write current sentinel");
    std::fs::write(&sibling_flush, b"").expect("write sibling sentinel");
    set_mtime(&this_flush, SystemTime::UNIX_EPOCH);
    set_mtime(&sibling_flush, SystemTime::now());

    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", "http://127.0.0.1:9")
        .args(["local", "query", "SHOW TABLES"])
        .assert()
        .code(2)
        .stderr(contains("wrong sidecar").not());
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

#[cfg(unix)]
fn set_mtime(path: &Path, mtime: SystemTime) {
    let duration = mtime
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("mtime must be after unix epoch");
    let path = std::ffi::CString::new(path.as_os_str().as_bytes()).expect("path has no nul bytes");
    let times = [
        libc::timeval {
            tv_sec: duration.as_secs() as libc::time_t,
            tv_usec: duration.subsec_micros() as libc::suseconds_t,
        },
        libc::timeval {
            tv_sec: duration.as_secs() as libc::time_t,
            tv_usec: duration.subsec_micros() as libc::suseconds_t,
        },
    ];
    let result = unsafe { libc::utimes(path.as_ptr(), times.as_ptr()) };
    assert_eq!(result, 0, "set file mtime");
}
