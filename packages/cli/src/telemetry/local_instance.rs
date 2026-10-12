use std::{error::Error, time::Duration};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Identity {
    pub service: String,
    pub version: String,
    pub instance_id: String,
    pub protocol_version: u32,
    pub status: String,
}

impl Identity {
    pub fn ui(instance_id: String) -> Self {
        Self {
            service: "everr-local-ui".into(),
            version: env!("EVERR_VERSION").into(),
            instance_id,
            protocol_version: 1,
            status: "ok".into(),
        }
    }
}

#[derive(Debug)]
pub enum ServiceState {
    Running(Identity),
    Starting,
    Stopped,
    Occupied,
    Unreachable,
    NetworkBlocked,
}

impl ServiceState {
    pub fn description(&self) -> &'static str {
        match self {
            Self::Running(_) => "running",
            Self::Starting => "starting",
            Self::Stopped => "stopped",
            Self::Occupied => "port occupied by an unrecognized service",
            Self::Unreachable => "unable to determine status (connection failed or timed out)",
            Self::NetworkBlocked => "unreachable (local network access is blocked)",
        }
    }
}

pub struct LocalStatus {
    pub collector: ServiceState,
    pub ui: ServiceState,
}

impl LocalStatus {
    pub async fn inspect() -> Self {
        let collector_endpoint = crate::build::healthcheck_endpoint();
        let ui_endpoint = format!(
            "{}/health",
            crate::build::local_ui_origin().trim_end_matches('/')
        );
        let (collector, ui) = tokio::join!(
            probe(&collector_endpoint, "everr-local-collector"),
            probe(&ui_endpoint, "everr-local-ui"),
        );
        Self { collector, ui }
    }

    pub fn running_instance(&self) -> Option<&Identity> {
        match (&self.collector, &self.ui) {
            (ServiceState::Running(collector), ServiceState::Running(ui))
                if collector.instance_id == ui.instance_id && collector.version == ui.version =>
            {
                Some(collector)
            }
            _ => None,
        }
    }

    pub fn stopped(&self) -> bool {
        matches!(self.collector, ServiceState::Stopped) && matches!(self.ui, ServiceState::Stopped)
    }

    pub fn print(&self) {
        for (label, origin, state) in [
            ("otlp", crate::build::otlp_http_origin(), &self.collector),
            ("sql", crate::build::sql_http_origin(), &self.collector),
            ("ui", crate::build::local_ui_origin(), &self.ui),
        ] {
            let value = if matches!(state, ServiceState::Running(_)) {
                origin
            } else {
                state.description().to_owned()
            };
            println!("{label}: {value}");
        }
        if matches!(
            (&self.collector, &self.ui),
            (ServiceState::Running(_), ServiceState::Running(_))
        ) && self.running_instance().is_none()
        {
            println!("instance: collector and UI do not belong to the same Everr instance");
        }
    }

    pub fn require_stopped(&self) -> Result<()> {
        if matches!(
            (&self.collector, &self.ui),
            (ServiceState::Running(_), ServiceState::Running(_))
        ) && self.running_instance().is_none()
        {
            bail!(
                "cannot start Everr: collector and UI do not belong to the same Everr instance; stop the existing instances, then retry"
            );
        }
        if !self.stopped() {
            bail!(
                "cannot start Everr: collector at {} is {}; local UI at {} is {}. Stop the existing instance or free the occupied address, then retry",
                crate::build::sql_http_origin(),
                self.collector.description(),
                crate::build::local_ui_origin(),
                self.ui.description()
            );
        }
        Ok(())
    }
}

pub async fn probe(endpoint: &str, service: &str) -> ServiceState {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(500))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .expect("local health client");
    let mut response = match client.get(endpoint).send().await {
        Ok(response) => response,
        Err(error) => {
            if crate::collector::error_chain_contains_permission_denied(&error) {
                return ServiceState::NetworkBlocked;
            }
            let mut cause: Option<&(dyn Error + 'static)> = Some(&error);
            while let Some(source) = cause {
                if source
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|error| error.kind() == std::io::ErrorKind::ConnectionRefused)
                {
                    return ServiceState::Stopped;
                }
                cause = source.source();
            }
            return ServiceState::Unreachable;
        }
    };
    let status = response.status();
    let mut bytes = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if bytes.len() + chunk.len() <= 8192 => bytes.extend_from_slice(&chunk),
            Ok(None) => break,
            Err(_) => return ServiceState::Unreachable,
            Ok(Some(_)) => return ServiceState::Occupied,
        }
    }
    let Ok(identity) = serde_json::from_slice::<Identity>(&bytes) else {
        return ServiceState::Occupied;
    };
    if identity.service != service
        || identity.protocol_version != 1
        || identity.instance_id.trim().is_empty()
        || semver::Version::parse(&identity.version).is_err()
    {
        return ServiceState::Occupied;
    }
    match (status.as_u16(), identity.status.as_str()) {
        (200, "ok") => ServiceState::Running(identity),
        (503, "starting") => ServiceState::Starting,
        _ => ServiceState::Occupied,
    }
}

pub fn listen_address(origin: &str) -> Result<std::net::SocketAddr> {
    let url = reqwest::Url::parse(origin).context("parse local listener address")?;
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") {
        bail!("local listener must use http://127.0.0.1: {origin}");
    }
    Ok(std::net::SocketAddr::from((
        [127, 0, 0, 1],
        url.port_or_known_default().context("missing local port")?,
    )))
}

pub async fn require_free_port(origin: &str) -> Result<()> {
    let address = listen_address(origin)?;
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .with_context(|| {
            format!("cannot start Everr: address {address} is unavailable; free it, then retry")
        })?;
    drop(listener);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn invalid_identity_or_readiness_is_not_recognized() {
        let body = json!({"service":"everr-local-collector", "version":"0.8.2", "instance_id":"one", "protocol_version":1, "status":"ok"});
        for (field, value, status) in [
            ("service", json!("other-service"), 200),
            ("version", json!(""), 200),
            ("instance_id", json!(""), 200),
            ("protocol_version", json!(2), 200),
            ("status", json!("starting"), 200),
            ("status", json!("ok"), 503),
        ] {
            let mut invalid = body.clone();
            invalid[field] = value;
            let mut server = mockito::Server::new_async().await;
            server
                .mock("GET", "/health")
                .with_status(status)
                .with_body(invalid.to_string())
                .create_async()
                .await;
            assert!(
                matches!(
                    probe(&format!("{}/health", server.url()), "everr-local-collector").await,
                    ServiceState::Occupied
                ),
                "accepted invalid {field}"
            );
        }
    }

    #[tokio::test]
    async fn redirect_and_oversized_response_are_not_recognized() {
        let mut server = mockito::Server::new_async().await;
        for (status, body) in [(302, String::new()), (200, "x".repeat(8193))] {
            let mock = server
                .mock("GET", "/health")
                .with_status(status)
                .with_header("location", &format!("{}/elsewhere", server.url()))
                .with_body(body)
                .create_async()
                .await;
            assert!(matches!(
                probe(&format!("{}/health", server.url()), "everr-local-collector").await,
                ServiceState::Occupied
            ));
            mock.remove_async().await;
        }
    }

    #[tokio::test]
    async fn startup_readiness_requires_the_spawned_instance() {
        let mut server = mockito::Server::new_async().await;
        server.mock("GET", "/health").with_status(200)
            .with_body(json!({"service":"everr-local-collector", "version":"0.8.2", "instance_id":"existing", "protocol_version":1, "status":"ok"}).to_string())
            .create_async().await;
        assert!(
            !crate::collector::wait_for_collector(
                &format!("{}/health", server.url()),
                "new",
                Duration::from_millis(150)
            )
            .await
        );
    }

    #[tokio::test]
    async fn silent_listener_is_unreachable_instead_of_stopped() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/health", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (_stream, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(2)).await;
        });
        assert!(matches!(
            probe(&endpoint, "everr-local-collector").await,
            ServiceState::Unreachable
        ));
        task.abort();
    }
}
