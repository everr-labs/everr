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
fn stop_is_idempotent_when_both_listeners_are_absent() {
    CliTestEnv::new()
        .command()
        .env("EVERR_SQL_HTTP_ORIGIN", stopped_origin())
        .env("EVERR_LOCAL_UI_ORIGIN", stopped_origin())
        .args(["local", "stop"])
        .assert()
        .success()
        .stdout(contains("already stopped"));
}

#[test]
fn stop_refuses_unrecognized_or_mismatched_instances() {
    for recognized in [false, true] {
        let env = CliTestEnv::new();
        let collector = health_server("everr-local-collector", "one", false);
        let mut ui = mockito::Server::new();
        ui.mock("GET", "/health")
            .with_body(if recognized {
                identity("everr-local-ui", "two", "ok")
            } else {
                "other app".into()
            })
            .create();
        let stop = ui
            .mock("POST", "/api/commands/stop_local")
            .expect(0)
            .create();
        env.command()
            .env("EVERR_SQL_HTTP_ORIGIN", collector.url())
            .env("EVERR_LOCAL_UI_ORIGIN", ui.url())
            .args(["local", "stop"])
            .assert()
            .failure()
            .stderr(contains("cannot stop Everr"));
        stop.assert();
        assert!(
            reqwest::blocking::get(format!("{}/health", ui.url()))
                .unwrap()
                .status()
                .is_success()
        );
    }
}

fn identity(service: &str, instance: &str, status: &str) -> String {
    serde_json::json!({
        "service": service, "version": "0.8.2", "instance_id": instance,
        "protocol_version": 1, "status": status,
    })
    .to_string()
}

fn health_server(service: &str, instance: &str, starting: bool) -> mockito::ServerGuard {
    let mut server = mockito::Server::new();
    server
        .mock("GET", "/health")
        .with_status(if starting { 503 } else { 200 })
        .with_body(identity(
            service,
            instance,
            if starting { "starting" } else { "ok" },
        ))
        .create();
    server
}

fn stopped_origin() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    format!("http://{}", listener.local_addr().unwrap())
}

#[test]
fn status_reports_running_when_collector_and_ui_belong_together() {
    let env = CliTestEnv::new();
    let collector = health_server("everr-local-collector", "one", false);
    let ui = health_server("everr-local-ui", "one", false);
    let otlp = stopped_origin();
    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", collector.url())
        .env("EVERR_LOCAL_UI_ORIGIN", ui.url())
        .env("EVERR_OTLP_HTTP_ORIGIN", &otlp)
        .args(["local", "status"])
        .assert()
        .success()
        .stdout(diff(format!(
            "otlp: {otlp}\nsql: {}\nui: {}\n",
            collector.url(),
            ui.url()
        )))
        .stderr(diff(""));
}

#[test]
fn status_reports_stopped_when_both_listeners_are_absent() {
    let env = CliTestEnv::new();
    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", stopped_origin())
        .env("EVERR_LOCAL_UI_ORIGIN", stopped_origin())
        .args(["local", "status"])
        .assert()
        .code(2)
        .stdout(diff("otlp: stopped\nsql: stopped\nui: stopped\n"))
        .stderr(contains("everr local start"));
}

#[test]
fn unrelated_http_success_is_not_everr_for_either_listener() {
    for (sql_body, ui_body) in [
        ("ok".into(), identity("everr-local-ui", "one", "ok")),
        (
            identity("everr-local-collector", "one", "ok"),
            "<html>Other app</html>".into(),
        ),
    ] {
        let env = CliTestEnv::new();
        let mut sql = mockito::Server::new();
        let mut ui = mockito::Server::new();
        sql.mock("GET", "/health")
            .with_status(200)
            .with_body(sql_body)
            .create();
        ui.mock("GET", "/health")
            .with_status(200)
            .with_body(ui_body)
            .create();
        env.command()
            .env("EVERR_SQL_HTTP_ORIGIN", sql.url())
            .env("EVERR_LOCAL_UI_ORIGIN", ui.url())
            .args(["local", "status"])
            .assert()
            .code(2)
            .stdout(contains("port occupied by an unrecognized service"));
    }
}

#[test]
fn status_recognizes_starting_collector() {
    let env = CliTestEnv::new();
    let collector = health_server("everr-local-collector", "one", true);
    let ui = health_server("everr-local-ui", "one", false);
    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", collector.url())
        .env("EVERR_LOCAL_UI_ORIGIN", ui.url())
        .args(["local", "status"])
        .assert()
        .code(2)
        .stdout(diff(format!(
            "otlp: starting\nsql: starting\nui: {}\n",
            ui.url()
        )));
}

#[test]
fn start_reuses_ready_instance_without_starting_a_new_process() {
    let env = CliTestEnv::new();
    let collector = health_server("everr-local-collector", "one", false);
    let ui = health_server("everr-local-ui", "one", false);
    let otlp = stopped_origin();
    for quiet in [false, true] {
        let mut command = env.command();
        command
            .env("EVERR_SQL_HTTP_ORIGIN", collector.url())
            .env("EVERR_LOCAL_UI_ORIGIN", ui.url())
            .env("EVERR_OTLP_HTTP_ORIGIN", &otlp)
            .args(["local", "start", "--no-open"]);
        if quiet {
            command.arg("--quiet");
        }
        let result = command.assert().success().stderr(diff(""));
        if quiet {
            result.stdout(diff(""));
        } else {
            result.stdout(diff(format!(
                "otlp: {otlp}\nsql: {}\nui: {}\n",
                collector.url(),
                ui.url()
            )));
        }
    }
}

#[test]
fn partial_instance_is_reported_and_start_refuses_to_replace_it() {
    let env = CliTestEnv::new();
    let collector = health_server("everr-local-collector", "one", false);
    let ui_origin = stopped_origin();
    let otlp = stopped_origin();
    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", collector.url())
        .env("EVERR_LOCAL_UI_ORIGIN", &ui_origin)
        .env("EVERR_OTLP_HTTP_ORIGIN", &otlp)
        .args(["local", "status"])
        .assert()
        .code(2)
        .stdout(diff(format!(
            "otlp: {otlp}\nsql: {}\nui: stopped\n",
            collector.url()
        )));
    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", collector.url())
        .env("EVERR_LOCAL_UI_ORIGIN", &ui_origin)
        .args(["local", "start", "--no-open"])
        .assert()
        .failure()
        .stderr(contains("cannot start Everr"))
        .stderr(contains("is running"));
    reqwest::blocking::get(format!("{}/health", collector.url()))
        .unwrap()
        .error_for_status()
        .unwrap();
}

#[test]
fn mismatched_instances_are_not_reported_as_a_complete_running_instance() {
    let env = CliTestEnv::new();
    let collector = health_server("everr-local-collector", "one", false);
    let ui = health_server("everr-local-ui", "two", false);
    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", collector.url())
        .env("EVERR_LOCAL_UI_ORIGIN", ui.url())
        .args(["local", "status"])
        .assert()
        .code(2)
        .stdout(contains("do not belong to the same Everr instance"));
    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", collector.url())
        .env("EVERR_LOCAL_UI_ORIGIN", ui.url())
        .args(["local", "start", "--no-open"])
        .assert()
        .failure()
        .stderr(contains("cannot start Everr"));
}

#[test]
fn start_leaves_unrelated_sql_and_ui_listeners_running() {
    for sql_conflict in [true, false] {
        let env = CliTestEnv::new();
        let server = spawn_health_server(200);
        let free = stopped_origin();
        env.command()
            .env(
                "EVERR_SQL_HTTP_ORIGIN",
                if sql_conflict { &server } else { &free },
            )
            .env(
                "EVERR_LOCAL_UI_ORIGIN",
                if sql_conflict { &free } else { &server },
            )
            .args(["local", "start", "--no-open"])
            .assert()
            .failure()
            .stderr(contains("port occupied by an unrecognized service"));
        // The listener remains bound after the CLI exits.
        let addr = server.trim_start_matches("http://");
        assert!(TcpListener::bind(addr).is_err());
    }
}

#[test]
fn start_leaves_unrelated_otlp_listener_running() {
    let env = CliTestEnv::new();
    let otlp = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = otlp.local_addr().unwrap();
    env.command()
        .env("EVERR_SQL_HTTP_ORIGIN", stopped_origin())
        .env("EVERR_LOCAL_UI_ORIGIN", stopped_origin())
        .env("EVERR_OTLP_HTTP_ORIGIN", format!("http://{address}"))
        .args(["local", "start", "--no-open"])
        .assert()
        .failure()
        .stderr(contains(address.to_string()))
        .stderr(contains("is unavailable"));
    assert!(TcpListener::bind(address).is_err());
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
        .stderr(contains("everr local start"));
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
        loop {
            let (mut stream, _) = listener.accept().expect("accept health request");
            let request = read_request(&mut stream);
            assert!(
                request.starts_with("GET /health HTTP/1.1"),
                "unexpected health request: {request}"
            );
            let body = if status == 200 { "ok\n" } else { "down\n" };
            let head = format!(
                "HTTP/1.1 {status} OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(head.as_bytes()).expect("write head");
            stream.write_all(body.as_bytes()).expect("write body");
        }
    });
    format!("http://{addr}")
}

fn read_request(stream: &mut TcpStream) -> String {
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .expect("set read timeout");
    let mut buf = [0_u8; 1024];
    let mut request = Vec::new();
    loop {
        let read = stream.read(&mut buf).expect("read request");
        request.extend_from_slice(&buf[..read]);
        if read == 0 || request.windows(4).any(|w| w == b"\r\n\r\n") {
            return String::from_utf8_lossy(&request).into_owned();
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
