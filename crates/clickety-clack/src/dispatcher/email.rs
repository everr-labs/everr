use crate::dispatcher::notify::{config_mismatch, Notification, Notifier, NotifyError};
use crate::domain::channel::ChannelConfig;
use async_trait::async_trait;
use lettre::message::Mailbox;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

/// Build a plaintext email for a notification (one or more events). A bad `from`/`to`
/// address or empty recipient list is a Permanent error (misconfiguration, not worth
/// retrying).
///
/// Alert annotations: each event's block is headed by its substituted `summary`
/// (instance key when absent), `description` is an extra line, and `link.alert` /
/// `link.runbook` appear as plain URLs. Plaintext needs no output escaping.
pub fn build_email_message(
    from: &str,
    to: &[String],
    notif: &Notification,
) -> Result<Message, NotifyError> {
    if to.is_empty() {
        return Err(NotifyError::Permanent("no recipients".into()));
    }
    let n = notif.events.len();
    let subject = if n == 1 {
        let ev = &notif.events[0];
        format!(
            "[{}] {} {}",
            crate::dispatcher::render::status_word(ev),
            ev.severity.as_str(),
            crate::dispatcher::render::headline(ev)
        )
    } else {
        format!("[{n} alerts] {}", notif.group_key)
    };
    let mut body = format!("group: {}\nalerts: {n}\n\n", notif.group_key);
    for ev in &notif.events {
        body.push_str(&format!(
            "- {}\n  status: {}\n  severity: {}\n  instance: {}\n",
            crate::dispatcher::render::headline(ev),
            ev.status.as_str(),
            ev.severity.as_str(),
            ev.instance_key.0
        ));
        if let Some(d) = crate::dispatcher::render::description(ev) {
            body.push_str(&format!("  description: {d}\n"));
        }
        if let Some(url) = crate::dispatcher::render::alert_link(ev) {
            body.push_str(&format!("  alert: {url}\n"));
        }
        if let Some(url) = crate::dispatcher::render::runbook_link(ev) {
            body.push_str(&format!("  runbook: {url}\n"));
        }
        for (k, v) in &ev.labels {
            body.push_str(&format!("  {k}: {v}\n"));
        }
    }

    let from_mbox: Mailbox = from
        .parse()
        .map_err(|e| NotifyError::Permanent(format!("bad from address: {e}")))?;
    let mut builder = Message::builder().from(from_mbox).subject(subject);
    for addr in to {
        let mbox: Mailbox = addr
            .parse()
            .map_err(|e| NotifyError::Permanent(format!("bad recipient {addr}: {e}")))?;
        builder = builder.to(mbox);
    }
    builder
        .body(body)
        .map_err(|e| NotifyError::Permanent(format!("building message: {e}")))
}

/// SMTP email channel (`ChannelConfig::Email` carries the recipient list); the
/// SMTP relay (host/port/from/credentials) is process-level config held here.
/// SMTP send failures are classified Transient (bounded-retry then dead-letter);
/// distinguishing permanent 5xx codes is a later refinement.
pub struct EmailNotifier {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: String,
}

impl EmailNotifier {
    /// Build a notifier against a plaintext SMTP relay (no TLS). Optional credentials.
    pub fn new(
        host: &str,
        port: u16,
        from: &str,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Self {
        // builder_dangerous: plaintext connection (relay reachable on a trusted network
        // or a local test server such as Mailpit). TLS relays are a later refinement.
        let mut builder = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host).port(port);
        if let (Some(u), Some(p)) = (username, password) {
            builder =
                builder.credentials(lettre::transport::smtp::authentication::Credentials::new(
                    u.to_string(),
                    p.to_string(),
                ));
        }
        Self {
            transport: builder.build(),
            from: from.to_string(),
        }
    }
}

#[async_trait]
impl Notifier for EmailNotifier {
    fn channel(&self) -> &'static str {
        "email"
    }

    async fn send(&self, config: &ChannelConfig, notif: &Notification) -> Result<(), NotifyError> {
        let ChannelConfig::Email { to } = config else {
            return Err(config_mismatch("email", config));
        };
        let msg = build_email_message(&self.from, to, notif)?;
        self.transport
            .send(msg)
            .await
            .map(|_| ())
            .map_err(|e| NotifyError::Transient(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use crate::domain::{Event, EventStatus};
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn ev() -> Event {
        Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey("svc=api".into()),
            EventStatus::Firing,
            BTreeMap::from([("svc".to_string(), "api".to_string())]),
            None,
            Severity::Warning,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        )
    }

    #[test]
    fn builds_message_with_subject_and_recipients() {
        let msg = build_email_message(
            "from@x.test",
            &["a@x.test".into()],
            &Notification::single(&ev()),
        )
        .unwrap();
        let formatted = String::from_utf8(msg.formatted()).unwrap();
        assert!(formatted.contains("Subject: [FIRING] warning svc=api"));
        assert!(formatted.contains("To: a@x.test"));
        assert!(formatted.contains("svc: api"));
    }

    #[test]
    fn summary_description_and_links_render_in_subject_and_body() {
        let mut e = ev();
        e.value = Some(12.0);
        e.annotations
            .insert("summary".into(), "High errors on ${svc}".into());
        e.annotations.insert(
            "description".into(),
            "rate=${value} missing=[${nope}]".into(),
        );
        e.annotations
            .insert("link.alert".into(), "https://app/alerts/1".into());
        e.annotations
            .insert("link.runbook".into(), "https://wiki/rb".into());
        let msg = build_email_message(
            "from@x.test",
            &["a@x.test".into()],
            &Notification::single(&e),
        )
        .unwrap();
        let formatted = String::from_utf8(msg.formatted()).unwrap();
        assert!(formatted.contains("Subject: [FIRING] warning High errors on api"));
        assert!(
            formatted.contains("- High errors on api"),
            "per-event summary line"
        );
        assert!(formatted.contains("description: rate=12 missing=[]"));
        assert!(formatted.contains("alert: https://app/alerts/1"));
        assert!(formatted.contains("runbook: https://wiki/rb"));
    }

    #[test]
    fn empty_recipients_is_permanent() {
        let err =
            build_email_message("from@x.test", &[], &Notification::single(&ev())).unwrap_err();
        assert!(matches!(err, NotifyError::Permanent(_)));
    }
}
