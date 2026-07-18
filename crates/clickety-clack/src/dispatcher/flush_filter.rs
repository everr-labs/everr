//! Flush-time suppression: re-apply silence + inhibition to a buffered group batch just
//! before delivery, so a silence created during the group window is honored. See
//! docs/superpowers/specs/2026-06-15-notify-time-silencing-and-batched-writes-design.md.

use crate::dispatcher::cache::Snapshot;
use crate::dispatcher::{inhibition, routing, silence};
use crate::domain::sink::{AlertLogSink, DeliveryFacts};
use crate::domain::Event;
use time::OffsetDateTime;

/// Drop events suppressed by an active silence or inhibition in `snap`. Returns the
/// surviving events in input order. Firing and resolved are both dropped on a silence
/// match (behavior-preserving with the at-ingest filter).
///
/// For each event dropped by a matching SILENCE, a `silenced` audit record is emitted via
/// `sink`, mirroring the at-ingest path in `process_event`. This is the only place a
/// late-arriving silence (created during the group window) can be observed, so the record
/// is essential to keep app.logs consistent. INHIBITION drops emit no record (no
/// event_type exists for inhibition; out of scope).
pub async fn filter_suppressed(
    snap: &Snapshot,
    events: Vec<Event>,
    now: OffsetDateTime,
    sink: &dyn AlertLogSink,
) -> Vec<Event> {
    let mut survivors = Vec::with_capacity(events.len());
    for ev in events {
        // Defense in depth for rolling upgrades: a suppressed (preview-rule) event is
        // normally dropped at ingest, but one buffered by a pre-upgrade dispatcher must
        // not be delivered at flush time either. Dropped silently (no audit record;
        // suppression is a rule property, not a notify-time decision).
        if ev.suppressed {
            continue;
        }
        let labels = routing::match_labels(&ev);
        // Silence takes precedence: if a silence matches, emit the audit record and drop.
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
        // Inhibition drops silently (no audit record; out of scope).
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

    /// An active match-all silence: empty matchers match everything (see matching.rs
    /// `matchers_match` — all() on empty is true), starts_at <= now < ends_at.
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

    /// Rolling-upgrade backstop: a suppressed (preview-rule) event that reached a group
    /// buffer anyway must still be dropped at flush time, even with an empty snapshot.
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

        // Source: severity=critical, instance=db1
        // Target: severity=warning,  instance=db1 (matches target_matchers; same instance)
        // Rule: source_matchers=[severity=critical], target_matchers=[severity=warning], equal=[instance]
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

        // Build the target event. The synthetic labels from match_labels() will include
        // "severity" from ev.severity (Severity::Warning -> "warning"), but routing::match_labels
        // also inserts user labels first and then overwrites with synthetic ones. We pass
        // target_labels as user labels and set Severity::Warning so "severity" stays "warning".
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

        // The firing set uses synthetic labels as the cache does (source_labels already contain
        // "severity" explicitly, which routing::match_labels would also set from Severity).
        let snap = Snapshot {
            silences: vec![],
            inhibitions: vec![rule],
            // firing entry: (instance_key, synthetic_labels). We provide labels matching
            // source_matchers directly; inhibition::is_inhibited uses these verbatim.
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
