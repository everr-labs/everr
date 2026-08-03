use crate::domain::ids::TenantId;
use crate::domain::Event;
use std::collections::BTreeMap;

/// Default label names to group by when a route does not specify `group_by`.
/// Tenant and receiver are always implicit in the group identity.
pub fn default_group_by() -> Vec<String> {
    vec!["rule".to_string(), "severity".to_string()]
}

pub const DEFAULT_GROUP_WAIT_SECS: u32 = 10;
pub const DEFAULT_GROUP_INTERVAL_SECS: u32 = 300;

/// Resolve the group-by label values from a matchable label set (see
/// `routing::match_labels`). A missing label resolves to the empty string so a group
/// is still well-defined. Returns pairs in the order of `group_by`.
pub fn group_by_values(
    labels: &BTreeMap<String, String>,
    group_by: &[String],
) -> Vec<(String, String)> {
    group_by
        .iter()
        .map(|k| (k.clone(), labels.get(k).cloned().unwrap_or_default()))
        .collect()
}

/// Human-readable group key: `receiver|k1=v1,k2=v2` (values in `group_by` order).
pub fn group_key_string(receiver: &str, values: &[(String, String)]) -> String {
    let body = values
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(",");
    format!("{receiver}|{body}")
}

/// Stable opaque group id (hex sha256) over tenant + receiver + the group-by names and
/// values. Distinct group_by configs for the same receiver yield distinct ids.
/// `receiver` is the receiver's stable id (not its name), so a rename never
/// re-buckets a live group.
pub fn group_id(
    tenant: &TenantId,
    receiver: &str,
    group_by: &[String],
    values: &[(String, String)],
) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(tenant.as_str().as_bytes());
    h.update(b"\x00");
    h.update(receiver.as_bytes());
    h.update(b"\x00");
    for name in group_by {
        h.update(name.as_bytes());
        h.update(b"\x01");
    }
    h.update(b"\x00");
    for (k, v) in values {
        h.update(k.as_bytes());
        h.update(b"\x01");
        h.update(v.as_bytes());
        h.update(b"\x02");
    }
    hex::encode(h.finalize())
}

/// Per-event fingerprint within a group: the instance key. A later event for the same
/// instance (e.g. a resolve) overwrites the earlier one in the active set.
pub fn fingerprint(ev: &Event) -> String {
    ev.instance_key.0.clone()
}

/// Dedup key for one group notification on one channel =
/// hash(group_id, channel ID, active set). Keying by the channel's stable id (not
/// its name, config, or target) keeps the key stable across renames and config
/// edits: renaming a channel or rotating a Slack hook must not re-send the
/// identical active set. The active set is folded in as sorted
/// (instance, status, eval_ts) so a changed set yields a new key (a new notification)
/// while a redelivery of the identical set does not. This is deliberate for the
/// crash-reflush path too: a reflush whose batch GREW (crash before the drain commit,
/// then another event buffered) keys as a new notification that re-includes the
/// already-sent members, because each notification reflects the batch as taken.
pub fn group_dedup_key(group_id: &str, channel_id: &str, events: &[Event]) -> String {
    use sha2::Digest;
    let h = dedup_hash(group_id, channel_id, events);
    hex::encode(h.finalize())
}

/// Dedup key for a still-firing REMINDER (`repeat_interval`) notification. Folds in the
/// repeat timestamp under a distinct domain tag so a reminder for the identical active
/// set never collapses with the original send (or with an earlier reminder), while a
/// redelivery of the same reminder attempt still dedups.
pub fn repeat_dedup_key(
    group_id: &str,
    channel_id: &str,
    events: &[Event],
    repeat_ts_ms: i64,
) -> String {
    use sha2::Digest;
    let mut h = dedup_hash(group_id, channel_id, events);
    h.update(b"\x00repeat\x00");
    h.update(repeat_ts_ms.to_be_bytes());
    hex::encode(h.finalize())
}

fn dedup_hash(group_id: &str, channel_id: &str, events: &[Event]) -> sha2::Sha256 {
    use sha2::{Digest, Sha256};
    let mut parts: Vec<(String, &'static str, i128)> = events
        .iter()
        .map(|e| {
            (
                e.instance_key.0.clone(),
                e.status.as_str(),
                e.eval_ts.unix_timestamp_nanos(),
            )
        })
        .collect();
    parts.sort();
    let mut h = Sha256::new();
    h.update(group_id.as_bytes());
    h.update(b"\x00");
    h.update(channel_id.as_bytes());
    h.update(b"\x00");
    for (inst, status, ts) in &parts {
        h.update(inst.as_bytes());
        h.update(b"\x01");
        h.update(status.as_bytes());
        h.update(b"\x01");
        h.update(ts.to_be_bytes());
        h.update(b"\x02");
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::event::{Event, EventStatus};
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::rule::Severity;
    use std::collections::BTreeMap;
    use time::{Duration, OffsetDateTime};
    use uuid::Uuid;

    fn ev(inst: &str, status: EventStatus, secs: i64) -> Event {
        Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey(inst.into()),
            status,
            BTreeMap::new(),
            None,
            Severity::Warning,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH + Duration::seconds(secs),
        )
    }

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn values_follow_group_by_order_and_default_empty() {
        let l = labels(&[("severity", "critical")]);
        let gb = vec!["rule".to_string(), "severity".to_string()];
        assert_eq!(
            group_by_values(&l, &gb),
            vec![
                ("rule".to_string(), String::new()),
                ("severity".to_string(), "critical".to_string())
            ]
        );
    }

    #[test]
    fn group_id_changes_with_values_and_receiver() {
        let gb = default_group_by();
        let v1 = group_by_values(&labels(&[("rule", "r"), ("severity", "warning")]), &gb);
        let v2 = group_by_values(&labels(&[("rule", "r"), ("severity", "critical")]), &gb);
        let t = TenantId::from_trusted(Uuid::nil().to_string());
        assert_ne!(group_id(&t, "ops", &gb, &v1), group_id(&t, "ops", &gb, &v2));
        assert_ne!(group_id(&t, "ops", &gb, &v1), group_id(&t, "pd", &gb, &v1));
        assert_eq!(group_id(&t, "ops", &gb, &v1), group_id(&t, "ops", &gb, &v1));
    }

    #[test]
    fn empty_group_by_buckets_everything_together() {
        // Some(vec![]) (group_by = no labels) → all events for a receiver share one group.
        let t = TenantId::from_trusted(Uuid::nil().to_string());
        let gb: Vec<String> = vec![];
        let v_a = group_by_values(&labels(&[("severity", "warning")]), &gb);
        let v_b = group_by_values(&labels(&[("severity", "critical")]), &gb);
        assert!(v_a.is_empty());
        assert_eq!(
            group_id(&t, "ops", &gb, &v_a),
            group_id(&t, "ops", &gb, &v_b)
        );
    }

    #[test]
    fn dedup_key_order_independent_but_set_sensitive() {
        let a = ev("a", EventStatus::Firing, 0);
        let b = ev("b", EventStatus::Firing, 0);
        let k1 = group_dedup_key("g", "ops-hook", &[a.clone(), b.clone()]);
        let k2 = group_dedup_key("g", "ops-hook", &[b.clone(), a.clone()]);
        assert_eq!(k1, k2, "order of the active set must not matter");
        let k3 = group_dedup_key("g", "ops-hook", std::slice::from_ref(&a));
        assert_ne!(k1, k3, "different active set → different key");
        let a_resolved = ev("a", EventStatus::Resolved, 0);
        let k4 = group_dedup_key("g", "ops-hook", &[a_resolved, b.clone()]);
        assert_ne!(k1, k4, "status change → different key");
        let k5 = group_dedup_key("g", "team-slack", &[a, b]);
        assert_ne!(k1, k5, "different channel name → different key");
    }

    #[test]
    fn repeat_dedup_key_never_collapses_with_the_original_send() {
        let a = ev("a", EventStatus::Firing, 0);
        let b = ev("b", EventStatus::Firing, 0);
        let set = vec![a, b];
        let original = group_dedup_key("g", "ops-hook", &set);
        let repeat1 = repeat_dedup_key("g", "ops-hook", &set, 1_000);
        let repeat2 = repeat_dedup_key("g", "ops-hook", &set, 2_000);
        assert_ne!(
            original, repeat1,
            "identical active set: repeat must not dedup away"
        );
        assert_ne!(
            repeat1, repeat2,
            "successive reminders are distinct notifications"
        );
        assert_eq!(
            repeat1,
            repeat_dedup_key("g", "ops-hook", &set, 1_000),
            "a redelivery of the same reminder attempt still dedups"
        );
    }
}
