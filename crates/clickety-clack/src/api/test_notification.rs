//! The synthetic notification a draft channel test sends.
//!
//! Deliberately a real `Notification` through the channel's real formatter: the
//! test proves the rendering path as well as the transport, and shows the
//! operator what a page from this channel will actually look like.

use crate::dispatcher::Notification;
use crate::domain::ids::{InstanceKey, RuleId, TenantId};
use crate::domain::rule::Severity;
use crate::domain::{Event, EventStatus};
use std::collections::BTreeMap;
use time::OffsetDateTime;

/// Build the one-event notification a channel test delivers. `channel_kind` is
/// `ChannelConfig::channel_name()`, carried as a label so the message is
/// self-describing wherever it lands.
pub fn test_notification(
    tenant: &TenantId,
    channel_kind: &str,
    now: OffsetDateTime,
) -> Notification {
    let mut labels = BTreeMap::new();
    labels.insert("channel".to_string(), channel_kind.to_string());

    let mut annotations = BTreeMap::new();
    annotations.insert(
        "summary".to_string(),
        "Test notification from Everr. If you can read this, this channel works.".to_string(),
    );

    // Severity::Info: a test must not render with the urgency of a real page.
    // The nil rule id and a fixed instance key keep it clearly synthetic; no
    // instance row exists or is created for it.
    let ev = Event::new(
        tenant.clone(),
        RuleId(uuid::Uuid::nil()),
        InstanceKey("channel-test".to_string()),
        EventStatus::Firing,
        labels,
        None,
        Severity::Info,
        annotations,
        now,
    );
    let mut n = Notification::single(&ev);
    n.events[0].name = "Channel test".to_string();
    n
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::TenantId;
    use time::OffsetDateTime;

    #[test]
    fn reads_as_a_test_and_names_the_channel_kind() {
        let n = test_notification(
            &TenantId::from_trusted("acme"),
            "slack",
            OffsetDateTime::UNIX_EPOCH,
        );
        assert_eq!(n.events.len(), 1);
        let ev = &n.events[0];

        // Renders through each channel's real formatter, so the operator sees
        // exactly what a page from this channel will look like.
        let summary = ev.annotations.get("summary").expect("summary annotation");
        assert!(summary.to_lowercase().contains("test"));
        assert!(summary.contains("Everr"));

        // Self-describing in a provider's notification list.
        assert_eq!(ev.labels.get("channel").map(String::as_str), Some("slack"));

        // Firing, not resolved: a resolved test renders as an all-clear.
        assert_eq!(ev.status, crate::domain::EventStatus::Firing);
    }

    #[test]
    fn carries_the_calling_tenant() {
        let n = test_notification(
            &TenantId::from_trusted("acme"),
            "email",
            OffsetDateTime::UNIX_EPOCH,
        );
        assert_eq!(n.events[0].tenant.as_str(), "acme");
    }
}
