use std::error::Error;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::time::sleep;

pub async fn wait_for_collector(endpoint: &str, instance_id: &str, deadline: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < deadline {
        let state =
            crate::telemetry::local_instance::probe(endpoint, "everr-local-collector").await;
        if let crate::telemetry::local_instance::ServiceState::Running(identity) = state {
            if identity.instance_id == instance_id {
                return true;
            }
        }
        sleep(Duration::from_millis(100)).await;
    }
    false
}

pub fn error_chain_contains_permission_denied(err: &(dyn Error + 'static)) -> bool {
    let mut current = Some(err);
    while let Some(source) = current {
        if let Some(io_err) = source.downcast_ref::<std::io::Error>() {
            if io_err.kind() == std::io::ErrorKind::PermissionDenied {
                return true;
            }
        }
        current = source.source();
    }
    false
}

pub async fn forward_output<R: tokio::io::AsyncRead + Unpin>(reader: R, prefix: &'static str) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        eprintln!("{prefix} {line}");
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn permission_denied_errors_are_network_blocked() {
        let err = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert!(super::error_chain_contains_permission_denied(&err));
    }
}
