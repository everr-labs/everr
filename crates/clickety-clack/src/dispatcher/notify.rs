use crate::domain::channel::ChannelConfig;
use crate::domain::Event;
use async_trait::async_trait;
use std::net::SocketAddr;
use thiserror::Error;
use url::Host;

#[derive(Debug, Error)]
pub enum NotifyError {
    /// Worth retrying (timeout, connection error, 5xx).
    #[error("transient: {0}")]
    Transient(String),
    /// Not worth retrying (4xx, malformed target).
    #[error("permanent: {0}")]
    Permanent(String),
}

/// A batch of active events for one group, delivered as a single notification.
/// `events` is always non-empty; `group_key` is a human-readable group identity
/// (e.g. `"rule=…,severity=critical"`) included in rendered payloads.
#[derive(Debug, Clone)]
pub struct Notification {
    pub group_key: String,
    pub events: Vec<Event>,
}

impl Notification {
    /// Wrap a single event as a one-member notification.
    pub fn single(ev: &Event) -> Self {
        Self {
            group_key: ev.instance_key.0.clone(),
            events: vec![ev.clone()],
        }
    }
}

/// A delivery channel. Each impl renders a `Notification` (one or more events) into
/// one channel-native message.
#[async_trait]
pub trait Notifier: Send + Sync {
    fn channel(&self) -> &'static str;
    /// Deliver `notif` to the endpoint described by `config`. Each impl matches
    /// its own [`ChannelConfig`] variant and returns [`config_mismatch`] for any
    /// other (a registry/config bug, never worth retrying). Classify delivery
    /// failures as Transient vs Permanent.
    async fn send(&self, config: &ChannelConfig, notif: &Notification) -> Result<(), NotifyError>;
}

/// The Permanent error a notifier returns when handed another channel's config
/// variant (dispatch looked up the wrong notifier, or a config row is corrupt).
pub fn config_mismatch(notifier: &'static str, got: &ChannelConfig) -> NotifyError {
    NotifyError::Permanent(format!(
        "{notifier} notifier received a '{}' config",
        got.channel_name()
    ))
}

fn http_client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
}

/// The HTTP client shared in shape by fixed-target HTTP notifiers.
pub fn default_http_client() -> reqwest::Client {
    http_client_builder()
        .build()
        .expect("building reqwest client should not fail")
}

/// Build a client for a tenant-controlled webhook target. Domain names are
/// resolved at delivery time and pinned so a second lookup cannot rebind the
/// connection to an internal address. Every resolved address must be allowed.
pub(super) async fn webhook_http_client(
    raw_url: &str,
    allow_private: bool,
) -> Result<reqwest::Client, NotifyError> {
    crate::api::webhook_url::validate_webhook_url(raw_url, allow_private)
        .map_err(NotifyError::Permanent)?;
    let url = url::Url::parse(raw_url)
        .map_err(|_| NotifyError::Permanent("webhook URL is invalid".into()))?;

    let Host::Domain(host) = url
        .host()
        .ok_or_else(|| NotifyError::Permanent("webhook URL has no host".into()))?
    else {
        return Ok(default_http_client());
    };
    if allow_private {
        return Ok(default_http_client());
    }

    let port = url
        .port_or_known_default()
        .ok_or_else(|| NotifyError::Permanent("webhook URL has no usable port".into()))?;
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| NotifyError::Transient("webhook target DNS lookup failed".into()))?
        .collect();
    if addrs.is_empty() {
        return Err(NotifyError::Transient(
            "webhook target DNS lookup returned no addresses".into(),
        ));
    }
    for addr in &addrs {
        crate::api::webhook_url::validate_resolved_ip(addr.ip()).map_err(NotifyError::Permanent)?;
    }

    http_client_builder()
        // A process-level HTTP(S)_PROXY would move DNS resolution to the proxy
        // and bypass the address set validated above.
        .no_proxy()
        .resolve_to_addrs(host, &addrs)
        .build()
        .map_err(|_| NotifyError::Transient("building webhook HTTP client failed".into()))
}

/// Classify a delivery response: 2xx ok; 4xx permanent; else transient.
pub fn classify_status(status: reqwest::StatusCode) -> Result<(), NotifyError> {
    if status.is_success() {
        Ok(())
    } else if status.is_client_error() {
        Err(NotifyError::Permanent(format!("status {status}")))
    } else {
        Err(NotifyError::Transient(format!("status {status}")))
    }
}

/// Like [`classify_status`], but for APIs whose 429 rate-limit is worth retrying:
/// 2xx ok; 429 transient; other 4xx permanent; else transient.
pub fn classify_status_429_transient(status: reqwest::StatusCode) -> Result<(), NotifyError> {
    if status.as_u16() == 429 {
        return Err(NotifyError::Transient("rate limited (429)".into()));
    }
    classify_status(status)
}

/// Generic webhook: POST `{group_key, events:[…]}` as JSON. 2xx = ok, 4xx = permanent,
/// else transient.
pub struct WebhookNotifier {
    allow_private: bool,
}

impl WebhookNotifier {
    pub fn new(allow_private: bool) -> Self {
        Self { allow_private }
    }
}

impl Default for WebhookNotifier {
    fn default() -> Self {
        Self::new(false)
    }
}

#[async_trait]
impl Notifier for WebhookNotifier {
    fn channel(&self) -> &'static str {
        "webhook"
    }

    async fn send(&self, config: &ChannelConfig, notif: &Notification) -> Result<(), NotifyError> {
        let ChannelConfig::Webhook { url } = config else {
            return Err(config_mismatch("webhook", config));
        };
        let body = serde_json::json!({
            "group_key": notif.group_key,
            "events": notif.events,
        });
        let http = webhook_http_client(url, self.allow_private).await?;
        let resp = http
            .post(url)
            .json(&body)
            .send()
            .await
            // Strip the URL: it is the secret delivery target and must not reach
            // notifications.last_error, the dead-letter stream, or logs.
            .map_err(|e| NotifyError::Transient(e.without_url().to_string()))?;
        classify_status(resp.status())
    }
}
