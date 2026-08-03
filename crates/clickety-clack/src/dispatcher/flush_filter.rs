//! Reapply suppression before delivering a buffered group.

use crate::dispatcher::cache::Snapshot;
use crate::dispatcher::{inhibition, routing, silence};
use crate::domain::sink::{AlertLogSink, DeliveryFacts};
use crate::domain::Event;
use time::OffsetDateTime;

/// Drop currently suppressed events while preserving input order. Silence drops
/// emit audit records; inhibition drops do not have an event type.
pub async fn filter_suppressed(
    snap: &Snapshot,
    events: Vec<Event>,
    now: OffsetDateTime,
    sink: &dyn AlertLogSink,
) -> Vec<Event> {
    let mut survivors = Vec::with_capacity(events.len());
    for ev in events {
        // Keep buffered preview-rule events suppressed across rolling upgrades.
        if ev.suppressed {
            continue;
        }
        let labels = routing::match_labels(&ev);
        // Silence takes precedence and emits an audit record.
        if let Some(sid) = silence::matching_silence(&labels, &snap.silences, now) {
            sink.record_delivery(
                &ev,
                &DeliveryFacts {
                    delivery_targets: vec![],
                    silence_id: Some(sid.to_string()),
                    silenced: true,
                },
            )
            .await;
            continue;
        }
        // Inhibition drops have no audit event type.
        if inhibition::is_inhibited(&labels, &ev.instance_key, &snap.inhibitions, &snap.firing) {
            continue;
        }
        survivors.push(ev);
    }
    survivors
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::inhibition::InhibitionRule;
    use crate::domain::routing::{MatchOp, Matcher};
    use crate::domain::rule::Severity;
    use crate::domain::silence::Silence;
    use crate::domain::sink::NullSink;
    use crate::domain::{Event, EventStatus};
    use std::collections::BTreeMap;
    use time::{Duration, OffsetDateTime};
    use uuid::Uuid;

    fn tenant() -> TenantId {
        TenantId::from_trusted(Uuid::nil().to_string())
    }

    fn rule_id() -> RuleId {
        RuleId(Uuid::nil())
    }

    fn make_event(status: EventStatus, labels: BTreeMap<String, String>) -> Event {
        Event::new(
            tenant(),
            rule_id(),
            InstanceKey(format!("key-{:?}", status)),
            status,
            labels,
            None,
            Severity::Warning,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        )
    }

    fn empty_snapshot() -> Snapshot {
        Snapshot {
            silences: vec![],
            inhibitions: vec![],
            firing: vec![],
            routes: vec![],
            receivers: Default::default(),
        }
    }

    /// An active match-all silence.
    fn match_all_silence(now: OffsetDateTime) -> Silence {
        Silence {
            id: Uuid::nil(),
            tenant: tenant(),
            matchers: vec![],
            starts_at: now - Duration::seconds(1),
            ends_at: now + Duration::seconds(60),
            comment: String::new(),
            author: String::new(),
            created_at: now - Duration::seconds(1),
        }
    }

    fn eq_matcher(label: &str, value: &str) -> Matcher {
        Matcher {
            label: label.into(),
            op: MatchOp::Eq,
            value: value.into(),
        }
    }

    #[tokio::test]
    async fn keeps_everything_with_empty_snapshot() {
        let snap = empty_snapshot();
        let ev = make_event(EventStatus::Firing, BTreeMap::new());
        let result = filter_suppressed(
            &snap,
            vec![ev.clone()],
            OffsetDateTime::UNIX_EPOCH,
            &NullSink,
        )
        .await;
        assert_eq!(result.len(), 1, "event should survive an empty snapshot");
        assert_eq!(result[0].status, ev.status);
    }

    /// Buffered preview events remain suppressed during rolling upgrades.
    #[tokio::test]
    async fn suppressed_event_is_dropped_at_flush() {
        let snap = empty_snapshot();
        let mut suppressed = make_event(EventStatus::Firing, BTreeMap::new());
        suppressed.suppressed = true;
        let live = make_event(EventStatus::Resolved, BTreeMap::new());
        let result = filter_suppressed(
            &snap,
            vec![suppressed, live],
            OffsetDateTime::UNIX_EPOCH,
            &NullSink,
        )
        .await;
        assert_eq!(result.len(), 1, "only the non-suppressed event survives");
        assert!(!result[0].suppressed);
    }

    #[tokio::test]
    async fn silence_drops_firing_and_resolved() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let snap = Snapshot {
            silences: vec![match_all_silence(now)],
            inhibitions: vec![],
            firing: vec![],
            routes: vec![],
            receivers: Default::default(),
        };
        let firing = make_event(EventStatus::Firing, BTreeMap::new());
        let resolved = make_event(EventStatus::Resolved, BTreeMap::new());
        let result = filter_suppressed(&snap, vec![firing, resolved], now, &NullSink).await;
        assert!(
            result.is_empty(),
            "both firing and resolved must be dropped by an active match-all silence; got {result:?}"
        );
    }

    #[tokio::test]
    async fn inhibition_drops_target_when_source_firing() {
        let now = OffsetDateTime::UNIX_EPOCH;

        // A critical db1 source inhibits a warning db1 target.
        let source_labels: BTreeMap<String, String> = [
            ("severity".to_string(), "critical".to_string()),
            ("instance".to_string(), "db1".to_string()),
        ]
        .into();

        let target_labels: BTreeMap<String, String> = [
            ("severity".to_string(), "warning".to_string()),
            ("instance".to_string(), "db1".to_string()),
        ]
        .into();

        let source_key = InstanceKey("src-key".to_string());
        let target_key = InstanceKey("tgt-key".to_string());

        let rule = InhibitionRule {
            id: Uuid::nil(),
            tenant: tenant(),
            source_matchers: vec![eq_matcher("severity", "critical")],
            target_matchers: vec![eq_matcher("severity", "warning")],
            equal: vec!["instance".to_string()],
            created_at: OffsetDateTime::UNIX_EPOCH,
        };

        let target_ev = Event::new(
            tenant(),
            rule_id(),
            target_key.clone(),
            EventStatus::Firing,
            target_labels.clone(),
            None,
            Severity::Warning,
            BTreeMap::new(),
            now,
        );

        let snap = Snapshot {
            silences: vec![],
            inhibitions: vec![rule],
            firing: vec![(source_key, source_labels)],
            routes: vec![],
            receivers: Default::default(),
        };

        let result = filter_suppressed(&snap, vec![target_ev], now, &NullSink).await;
        assert!(
            result.is_empty(),
            "target event must be dropped when a matching source is firing; got {result:?}"
        );
    }
}
