//! Product telemetry is independent of the applications observed by Everr.
//!
//! Release builds can only export to Everr's own cloud. The transport uses
//! the standard OTLP protobuf encoders directly because the generic OTLP
//! exporters also merge customer headers and compression from the environment.

use std::time::Duration;

use opentelemetry_proto::{
    tonic::collector::{logs::v1::ExportLogsServiceRequest, trace::v1::ExportTraceServiceRequest},
    transform::{
        common::tonic::ResourceAttributesWithSchema, logs::tonic::group_logs_by_resource_and_scope,
        trace::tonic::group_spans_by_resource_and_scope,
    },
};
use opentelemetry_sdk::{
    Resource,
    error::{OTelSdkError, OTelSdkResult},
    logs::{LogBatch, LogExporter},
    trace::{SpanData, SpanExporter},
};
use prost::Message;
use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue, ORIGIN};

const CLOUD_ENDPOINT: &str = "https://ingest.everr.dev";
// Native callers deliberately use the product origin with an origin-bound
// public ingest key. Never inherit the local browser's origin or a customer key.
pub(crate) const CLI_PUBLIC_ORIGIN: &str = "https://cli.everr.local";
pub(crate) const UI_PUBLIC_ORIGIN: &str = "https://ui.everr.local";
pub(crate) const EXPORT_TIMEOUT: Duration = Duration::from_millis(750);

#[derive(Clone, Copy)]
pub(crate) enum Source {
    Cli,
    Ui,
}

impl Source {
    fn origin(self) -> &'static str {
        match self {
            Self::Cli => CLI_PUBLIC_ORIGIN,
            Self::Ui => UI_PUBLIC_ORIGIN,
        }
    }
}

#[cfg(not(debug_assertions))]
const EMBEDDED_KEY: Option<&str> = option_env!("EVERR_INTERNAL_TELEMETRY_INGEST_KEY");
#[cfg(debug_assertions)]
const EMBEDDED_KEY: Option<&str> = None;

#[derive(Clone, Debug)]
pub(crate) struct Config {
    pub(crate) endpoint: String,
    pub(crate) headers: HeaderMap,
}

impl Config {
    pub(crate) fn from_env(source: Source) -> Option<Self> {
        Self::resolve(
            cfg!(debug_assertions),
            EMBEDDED_KEY,
            |name| std::env::var(name).ok(),
            &crate::build::otlp_http_origin(),
            source,
        )
    }

    fn resolve(
        debug: bool,
        embedded_key: Option<&str>,
        read_env: impl Fn(&str) -> Option<String>,
        local_endpoint: &str,
        source: Source,
    ) -> Option<Self> {
        if debug {
            let endpoint = read_env("EVERR_INTERNAL_TELEMETRY_ENDPOINT")
                .and_then(|value| non_empty(&value).map(str::to_owned))
                .unwrap_or_else(|| local_endpoint.to_owned());
            return Some(Self {
                endpoint,
                headers: HeaderMap::new(),
            });
        }

        let key = embedded_key.and_then(non_empty)?;
        let mut authorization = HeaderValue::from_str(&format!("Bearer {key}")).ok()?;
        authorization.set_sensitive(true);
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, authorization);
        headers.insert(ORIGIN, HeaderValue::from_static(source.origin()));
        Some(Self {
            endpoint: CLOUD_ENDPOINT.into(),
            headers,
        })
    }

    pub(crate) fn signal_endpoint(&self, signal: &str) -> String {
        signal_endpoint(&self.endpoint, signal)
    }
}

fn non_empty(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

pub(crate) fn deployment_environment() -> &'static str {
    if cfg!(debug_assertions) {
        "development"
    } else {
        "production"
    }
}

pub(crate) fn command_error(error: &anyhow::Error) -> String {
    command_error_for_build(cfg!(debug_assertions), error)
}

fn command_error_for_build(debug: bool, error: &anyhow::Error) -> String {
    if debug {
        format!("{error:#}")
    } else {
        "CLI command failed".into()
    }
}

pub(crate) fn signal_endpoint(base: &str, signal: &str) -> String {
    let base = base.trim_end_matches('/');
    let base = ["traces", "logs", "metrics"]
        .into_iter()
        .find_map(|name| base.strip_suffix(&format!("/v1/{name}")))
        .unwrap_or(base);
    format!("{base}/v1/{signal}")
}

/// Runs on the SDK's batch processor threads, outside the async CLI runtime.
#[derive(Debug)]
pub(crate) struct Exporter {
    config: Config,
    http: reqwest::blocking::Client,
    resource: ResourceAttributesWithSchema,
}

impl Exporter {
    pub(crate) fn new(config: Config) -> anyhow::Result<Self> {
        // reqwest's blocking client must be created outside a Tokio runtime.
        let http = std::thread::spawn(|| {
            reqwest::blocking::Client::builder()
                .timeout(EXPORT_TIMEOUT)
                .redirect(reqwest::redirect::Policy::none())
                .build()
        })
        .join()
        .map_err(|_| anyhow::anyhow!("create internal telemetry client"))??;
        Ok(Self {
            config,
            http,
            resource: (&Resource::builder_empty().build()).into(),
        })
    }

    fn send(&self, signal: &str, body: Vec<u8>) -> OTelSdkResult {
        let response = self
            .http
            .post(self.config.signal_endpoint(signal))
            .headers(self.config.headers.clone())
            .header("content-type", "application/x-protobuf")
            .body(body)
            .send()
            .map_err(|_| {
                OTelSdkError::InternalFailure("internal telemetry export failed".into())
            })?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(OTelSdkError::InternalFailure(
                "internal telemetry export failed".into(),
            ))
        }
    }
}

impl SpanExporter for Exporter {
    async fn export(&self, batch: Vec<SpanData>) -> OTelSdkResult {
        let request = ExportTraceServiceRequest {
            resource_spans: group_spans_by_resource_and_scope(batch, &self.resource),
        };
        self.send("traces", request.encode_to_vec())
    }

    fn set_resource(&mut self, resource: &Resource) {
        self.resource = resource.into();
    }
}

impl LogExporter for Exporter {
    async fn export(&self, batch: LogBatch<'_>) -> OTelSdkResult {
        let request = ExportLogsServiceRequest {
            resource_logs: group_logs_by_resource_and_scope(&batch, &self.resource),
        };
        self.send("logs", request.encode_to_vec())
    }

    fn set_resource(&mut self, resource: &Resource) {
        self.resource = resource.into();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn only_debug_reads_the_internal_endpoint_override() {
        for debug in [true, false] {
            for key in [None, Some(""), Some("  "), Some(" internal-key ")] {
                let reads = RefCell::new(Vec::new());
                let config = Config::resolve(
                    debug,
                    key,
                    |name| {
                        reads.borrow_mut().push(name.to_owned());
                        Some("http://internal-debug.test/".into())
                    },
                    "http://local.test",
                    Source::Cli,
                );
                if debug {
                    let config = config.unwrap();
                    assert_eq!(config.endpoint, "http://internal-debug.test/");
                    assert!(config.headers.is_empty());
                    assert_eq!(*reads.borrow(), ["EVERR_INTERNAL_TELEMETRY_ENDPOINT"]);
                } else {
                    assert!(reads.borrow().is_empty());
                    assert_eq!(config.is_some(), key.and_then(non_empty).is_some());
                    if let Some(config) = config {
                        assert_eq!(config.endpoint, CLOUD_ENDPOINT);
                        assert_eq!(config.headers[AUTHORIZATION], "Bearer internal-key");
                        assert_eq!(config.headers[ORIGIN], CLI_PUBLIC_ORIGIN);
                        assert!(!format!("{config:?}").contains("internal-key"));
                    }
                }
            }
        }
    }

    #[test]
    fn debug_uses_local_collector_without_internal_override() {
        for override_value in [None, Some(""), Some("  ")] {
            let config = Config::resolve(
                true,
                Some("ignored"),
                |_| override_value.map(str::to_owned),
                "http://local.test",
                Source::Cli,
            )
            .unwrap();
            assert_eq!(config.endpoint, "http://local.test");
            assert!(config.headers.is_empty());
        }
    }

    #[test]
    fn cli_and_ui_use_distinct_public_origins() {
        for (source, origin) in [
            (Source::Cli, "https://cli.everr.local"),
            (Source::Ui, "https://ui.everr.local"),
        ] {
            let config = Config::resolve(
                false,
                Some("internal-key"),
                |_| None,
                "http://local.test",
                source,
            )
            .unwrap();
            assert_eq!(config.headers[ORIGIN], origin);
            let debug = Config::resolve(
                true,
                Some("internal-key"),
                |_| None,
                "http://local.test",
                source,
            )
            .unwrap();
            assert!(debug.headers.is_empty());
        }
    }

    #[test]
    fn release_errors_do_not_export_customer_input() {
        let error = anyhow::anyhow!("SELECT 'customer-secret'").context("query failed");
        assert_eq!(command_error_for_build(false, &error), "CLI command failed");
        assert!(command_error_for_build(true, &error).contains("customer-secret"));
    }

    #[test]
    fn normalizes_signal_specific_endpoints() {
        assert_eq!(
            signal_endpoint("http://local.test/v1/traces/", "logs"),
            "http://local.test/v1/logs"
        );
    }
}
