//! Stage 3 of the dispatch pipeline: suppress a target event while a matching source
//! alert is firing. Source/target/`equal` matching uses the synthetic label namespace
//! (user labels + severity/status/rule), so severity-based inhibition works.

use crate::dispatcher::matching::matchers_match;
use crate::domain::ids::InstanceKey;
use crate::domain::inhibition::InhibitionRule;
use std::collections::BTreeMap;

/// `firing` is the source-set: each entry is `(instance_key, synthetic_labels)`.
pub fn is_inhibited(
    ev_labels: &BTreeMap<String, String>,
    ev_key: &InstanceKey,
    rules: &[InhibitionRule],
    firing: &[(InstanceKey, BTreeMap<String, String>)],
) -> bool {
    rules.iter().any(|rule| {
        // Self-inhibition guard: an alert that is itself a source is never inhibited.
        if matchers_match(&rule.source_matchers, ev_labels) {
            return false;
        }
        if !matchers_match(&rule.target_matchers, ev_labels) {
            return false;
        }
        firing.iter().any(|(fkey, flabels)| {
            fkey != ev_key
                && matchers_match(&rule.source_matchers, flabels)
                && rule
                    .equal
                    .iter()
                    .all(|l| match (flabels.get(l), ev_labels.get(l)) {
                        (Some(a), Some(b)) => a == b,
                        _ => false, // a label absent on either side is not an equal-match
                    })
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::TenantId;
    use crate::domain::routing::{MatchOp, Matcher};
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }
    fn m(label: &str, value: &str) -> Matcher {
        Matcher {
            label: label.into(),
            op: MatchOp::Eq,
            value: value.into(),
        }
    }
    fn rule(source: Vec<Matcher>, target: Vec<Matcher>, equal: &[&str]) -> InhibitionRule {
        InhibitionRule {
            id: Uuid::nil(),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            source_matchers: source,
            target_matchers: target,
            equal: equal.iter().map(|s| s.to_string()).collect(),
            created_at: OffsetDateTime::UNIX_EPOCH,
        }
    }
    fn key(s: &str) -> InstanceKey {
        InstanceKey(s.to_string())
    }

    #[test]
    fn firing_source_with_equal_labels_inhibits() {
        let r = rule(
            vec![m("severity", "critical")],
            vec![m("severity", "warning")],
            &["instance"],
        );
        let target = labels(&[("severity", "warning"), ("instance", "db1")]);
        let firing = vec![(
            key("src"),
            labels(&[("severity", "critical"), ("instance", "db1")]),
        )];
        assert!(is_inhibited(
            &target,
            &key("tgt"),
            std::slice::from_ref(&r),
            &firing
        ));
    }

    #[test]
    fn equal_label_mismatch_does_not_inhibit() {
        let r = rule(
            vec![m("severity", "critical")],
            vec![m("severity", "warning")],
            &["instance"],
        );
        let target = labels(&[("severity", "warning"), ("instance", "db1")]);
        let firing = vec![(
            key("src"),
            labels(&[("severity", "critical"), ("instance", "db2")]),
        )];
        assert!(!is_inhibited(
            &target,
            &key("tgt"),
            std::slice::from_ref(&r),
            &firing
        ));
    }

    #[test]
    fn equal_label_absent_on_source_does_not_inhibit() {
        let r = rule(
            vec![m("severity", "critical")],
            vec![m("severity", "warning")],
            &["instance"],
        );
        let target = labels(&[("severity", "warning"), ("instance", "db1")]);
        let firing = vec![(key("src"), labels(&[("severity", "critical")]))];
        assert!(!is_inhibited(
            &target,
            &key("tgt"),
            std::slice::from_ref(&r),
            &firing
        ));
    }

    #[test]
    fn self_inhibition_guard() {
        let r = rule(
            vec![m("severity", "critical")],
            vec![m("severity", "critical")],
            &[],
        );
        let target = labels(&[("severity", "critical"), ("instance", "db1")]);
        let firing = vec![(
            key("src"),
            labels(&[("severity", "critical"), ("instance", "db1")]),
        )];
        assert!(!is_inhibited(
            &target,
            &key("tgt"),
            std::slice::from_ref(&r),
            &firing
        ));
    }

    #[test]
    fn own_instance_does_not_inhibit_itself() {
        let r = rule(
            vec![m("severity", "critical")],
            vec![m("severity", "warning")],
            &["instance"],
        );
        let target = labels(&[("severity", "warning"), ("instance", "db1")]);
        let firing = vec![(
            key("tgt"),
            labels(&[("severity", "critical"), ("instance", "db1")]),
        )];
        assert!(!is_inhibited(
            &target,
            &key("tgt"),
            std::slice::from_ref(&r),
            &firing
        ));
    }

    #[test]
    fn no_firing_source_does_not_inhibit() {
        let r = rule(
            vec![m("severity", "critical")],
            vec![m("severity", "warning")],
            &["instance"],
        );
        let target = labels(&[("severity", "warning"), ("instance", "db1")]);
        assert!(!is_inhibited(
            &target,
            &key("tgt"),
            std::slice::from_ref(&r),
            &[]
        ));
    }

    #[test]
    fn target_not_matching_passes() {
        let r = rule(
            vec![m("severity", "critical")],
            vec![m("severity", "warning")],
            &["instance"],
        );
        let target = labels(&[("severity", "info"), ("instance", "db1")]);
        let firing = vec![(
            key("src"),
            labels(&[("severity", "critical"), ("instance", "db1")]),
        )];
        assert!(!is_inhibited(
            &target,
            &key("tgt"),
            std::slice::from_ref(&r),
            &firing
        ));
    }

    #[test]
    fn inhibition_is_status_agnostic() {
        let r = rule(
            vec![m("severity", "critical")],
            vec![m("severity", "warning")],
            &["instance"],
        );
        let target = labels(&[
            ("severity", "warning"),
            ("instance", "db1"),
            ("status", "resolved"),
        ]);
        let firing = vec![(
            key("src"),
            labels(&[
                ("severity", "critical"),
                ("instance", "db1"),
                ("status", "firing"),
            ]),
        )];
        assert!(is_inhibited(
            &target,
            &key("tgt"),
            std::slice::from_ref(&r),
            &firing
        ));
    }
}
