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
    let pids = listening_pids_on_port(port);
    let mut killed = false;
    for pid in &pids {
        if *pid == std::process::id() as i32 {
            continue;
        }
        eprintln!("[collector] killing {label} {pid} on port {port}");
        let _ = kill(Pid::from_raw(*pid), Signal::SIGKILL);
        killed = true;
    }

    if killed {
        wait_for_no_listeners_on_port(port, Duration::from_secs(2));
    }
}

#[cfg(unix)]
fn listening_pids_on_port(port: u16) -> Vec<i32> {
    let output = match std::process::Command::new("lsof")
        .args(lsof_listening_pid_args(port))
        .output()
    {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };

    let mut pids = Vec::new();
    for token in String::from_utf8_lossy(&output.stdout).split_whitespace() {
        let Ok(pid) = token.parse::<i32>() else {
            continue;
        };
        if !pids.contains(&pid) {
            pids.push(pid);
        }
    }
    pids
}

#[cfg(unix)]
fn lsof_listening_pid_args(port: u16) -> Vec<String> {
    vec![
        "-nP".to_string(),
        "-a".to_string(),
        format!("-tiTCP:{port}"),
        "-sTCP:LISTEN".to_string(),
    ]
}

#[cfg(unix)]
fn wait_for_no_listeners_on_port(port: u16, deadline: Duration) {
    let start = Instant::now();
    while start.elapsed() < deadline {
        if listening_pids_on_port(port).is_empty() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(not(unix))]
pub fn kill_processes_on_port(_port: u16, _label: &str) {}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use std::io;
    #[cfg(unix)]
    use std::net::{TcpListener, TcpStream};
    #[cfg(unix)]
    use std::process::{Command, Stdio};
    #[cfg(unix)]
    use std::time::Duration;

    #[cfg(unix)]
    #[test]
    fn lsof_query_is_scoped_to_listening_processes() {
        assert_eq!(
            super::lsof_listening_pid_args(54419),
            vec!["-nP", "-a", "-tiTCP:54419", "-sTCP:LISTEN"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn listener_pid_query_ignores_connected_client_processes() {
        if Command::new("lsof").arg("-v").output().is_err() {
            eprintln!("skipping: lsof is not available");
            return;
        }

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind listener");
        let addr = listener.local_addr().expect("listener address");
        let mut child = Command::new(std::env::current_exe().expect("current test binary"))
            .args([
                "--exact",
                "collector::tests::connect_to_port_child",
                "--ignored",
                "--nocapture",
            ])
            .env("EVERR_TEST_CONNECT_ADDR", addr.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn client child");

        let _stream = accept_with_timeout(&listener, Duration::from_secs(2));
        let pids = super::listening_pids_on_port(addr.port());

        let _ = child.kill();
        let _ = child.wait();

        assert!(
            pids.contains(&(std::process::id() as i32)),
            "listener pid should be present in {pids:?}"
        );
        assert!(
            !pids.contains(&(child.id() as i32)),
            "connected client pid should not be present in {pids:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    #[ignore]
    fn connect_to_port_child() {
        let Ok(addr) = std::env::var("EVERR_TEST_CONNECT_ADDR") else {
            return;
        };
        let _stream = TcpStream::connect(addr).expect("connect to parent listener");
        std::thread::sleep(Duration::from_secs(30));
    }

    #[cfg(unix)]
    fn accept_with_timeout(listener: &TcpListener, deadline: Duration) -> TcpStream {
        listener
            .set_nonblocking(true)
            .expect("set listener nonblocking");
        let start = std::time::Instant::now();
        loop {
            match listener.accept() {
                Ok((stream, _)) => return stream,
                Err(err)
                    if err.kind() == io::ErrorKind::WouldBlock && start.elapsed() < deadline =>
                {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(err) => panic!("accept client connection: {err}"),
            }
        }
    }
}
