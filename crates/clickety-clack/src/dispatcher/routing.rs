use crate::dispatcher::grouping;
use crate::dispatcher::matching::matchers_match;
use crate::domain::ids::RuleId;
use crate::domain::routing::Route;
use crate::domain::rule::Severity;
use crate::domain::{Event, EventKind, EventStatus};
use std::collections::BTreeMap;

fn severity_str(s: Severity) -> &'static str {
    match s {
        Severity::Info => "info",
        Severity::Warning => "warning",
        Severity::Critical => "critical",
    }
}

fn status_str(s: EventStatus) -> &'static str {
    match s {
        EventStatus::Firing => "firing",
        EventStatus::Resolved => "resolved",
    }
}

fn kind_str(k: EventKind) -> &'static str {
    match k {
        EventKind::Alert => "alert",
        EventKind::RuleHealth => "rule_health",
    }
}

/// Build the matchable label set from raw labels + synthetic `severity`/`status`/`rule`/`kind`.
/// Synthetic labels take precedence over any same-named user label (inserted last).
pub fn synthetic_labels(
    labels: &BTreeMap<String, String>,
    severity: Severity,
    status: EventStatus,
    rule: RuleId,
    kind: EventKind,
) -> BTreeMap<String, String> {
    let mut m = labels.clone();
    m.insert("severity".to_string(), severity_str(severity).to_string());
    m.insert("status".to_string(), status_str(status).to_string());
    m.insert("rule".to_string(), rule.0.to_string());
    m.insert("kind".to_string(), kind_str(kind).to_string());
    m
}

/// The matchable label set for an event.
pub fn match_labels(ev: &Event) -> BTreeMap<String, String> {
    synthetic_labels(&ev.labels, ev.severity, ev.status, ev.rule, ev.kind)
}

fn route_matches(r: &Route, labels: &BTreeMap<String, String>) -> bool {
    matchers_match(&r.matchers, labels)
}

/// Walk `routes` in the given order; collect receiver names of matching routes.
/// Stops after the first matching route unless it has `continue == true`. Receiver
/// names are de-duplicated while preserving first-match order. `routes` is expected
/// pre-ordered by the store (priority asc, then creation order).
pub fn select_receivers(routes: &[Route], labels: &BTreeMap<String, String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in routes {
        if route_matches(r, labels) {
            if !out.contains(&r.receiver) {
                out.push(r.receiver.clone());
            }
            if !r.continue_matching {
                break;
            }
        }
    }
    out
}

/// Resolved grouping parameters for one matched receiver (route defaults applied).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupingParams {
    pub group_by: Vec<String>,
    pub group_wait_secs: u32,
    pub group_interval_secs: u32,
    /// Still-firing reminder cadence. None = never re-notify (no route default).
    pub repeat_interval_secs: Option<u32>,
}

/// A receiver selected for an event, with its grouping parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchedTarget {
    pub receiver: String,
    pub grouping: GroupingParams,
}

/// Like `select_receivers`, but returns each unique receiver (first-match order) paired
/// with the grouping parameters from the FIRST route that selected it (route defaults
/// applied). `continue` semantics match `select_receivers`.
pub fn select_grouping_targets(
    routes: &[Route],
    labels: &BTreeMap<String, String>,
) -> Vec<MatchedTarget> {
    let mut out: Vec<MatchedTarget> = Vec::new();
    for r in routes {
        if route_matches(r, labels) {
            if !out.iter().any(|t| t.receiver == r.receiver) {
                out.push(MatchedTarget {
                    receiver: r.receiver.clone(),
                    grouping: GroupingParams {
                        group_by: r
                            .group_by
                            .clone()
                            .unwrap_or_else(grouping::default_group_by),
                        group_wait_secs: r
                            .group_wait_secs
                            .unwrap_or(grouping::DEFAULT_GROUP_WAIT_SECS),
                        group_interval_secs: r
                            .group_interval_secs
                            .unwrap_or(grouping::DEFAULT_GROUP_INTERVAL_SECS),
                        repeat_interval_secs: r.repeat_interval_secs,
                    },
                });
            }
            if !r.continue_matching {
                break;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use crate::domain::routing::{MatchOp, Matcher};
    use proptest::prelude::*;
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn ev(severity: Severity, labels: &[(&str, &str)]) -> Event {
        Event {
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            rule: RuleId(Uuid::nil()),
            instance_key: InstanceKey("k".into()),
            status: EventStatus::Firing,
            kind: crate::domain::event::EventKind::Alert,
            labels: labels
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            value: None,
            severity,
            annotations: BTreeMap::new(),
            eval_ts: OffsetDateTime::UNIX_EPOCH,
            suppressed: false,
            evidence: None,
            evidence_truncated: false,
        }
    }

    fn route(receiver: &str, cont: bool, matchers: Vec<Matcher>) -> Route {
        Route {
            id: Uuid::nil(),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            matchers,
            receiver: receiver.into(),
            continue_matching: cont,
            priority: 0,
            group_by: None,
            group_wait_secs: None,
            group_interval_secs: None,
            repeat_interval_secs: None,
        }
    }

    fn m(label: &str, op: MatchOp, value: &str) -> Matcher {
        Matcher {
            label: label.into(),
            op,
            value: value.into(),
        }
    }

    #[test]
    fn synthetic_severity_and_status_are_matchable() {
        let labels = match_labels(&ev(Severity::Critical, &[("svc", "api")]));
        assert_eq!(labels["severity"], "critical");
        assert_eq!(labels["status"], "firing");
        assert_eq!(labels["svc"], "api");
    }

    #[test]
    fn kind_is_a_matchable_synthetic_label() {
        let mut e = ev(Severity::Critical, &[]);
        e.kind = crate::domain::EventKind::RuleHealth;
        let labels = match_labels(&e);
        assert_eq!(labels["kind"], "rule_health");

        let alert = match_labels(&ev(Severity::Info, &[]));
        assert_eq!(alert["kind"], "alert");

        // A health route selects health and not a plain alert.
        let routes = vec![route(
            "ops",
            false,
            vec![m("kind", MatchOp::Eq, "rule_health")],
        )];
        assert_eq!(select_receivers(&routes, &labels), vec!["ops"]);
        assert!(select_receivers(&routes, &alert).is_empty());
    }

    #[test]
    fn first_match_wins_without_continue() {
        let labels = match_labels(&ev(Severity::Critical, &[]));
        let routes = vec![
            route("pd", false, vec![m("severity", MatchOp::Eq, "critical")]),
            route("ops", false, vec![m("severity", MatchOp::Eq, "critical")]),
        ];
        assert_eq!(select_receivers(&routes, &labels), vec!["pd"]);
    }

    #[test]
    fn continue_collects_multiple_receivers() {
        let labels = match_labels(&ev(Severity::Critical, &[]));
        let routes = vec![
            route("pd", true, vec![m("severity", MatchOp::Eq, "critical")]),
            route("ops", false, vec![m("severity", MatchOp::Eq, "critical")]),
        ];
        assert_eq!(select_receivers(&routes, &labels), vec!["pd", "ops"]);
    }

    #[test]
    fn non_matching_routes_are_skipped() {
        let labels = match_labels(&ev(Severity::Warning, &[("svc", "api")]));
        let routes = vec![
            route("pd", false, vec![m("severity", MatchOp::Eq, "critical")]),
            route("ops", false, vec![m("svc", MatchOp::Eq, "api")]),
        ];
        assert_eq!(select_receivers(&routes, &labels), vec!["ops"]);
    }

    #[test]
    fn regex_is_anchored_and_ne_handles_missing() {
        let labels = match_labels(&ev(Severity::Warning, &[("svc", "api-1")]));
        assert!(select_receivers(
            &[route("r", false, vec![m("svc", MatchOp::Regex, "api")])],
            &labels
        )
        .is_empty());
        assert_eq!(
            select_receivers(
                &[route("r", false, vec![m("svc", MatchOp::Regex, "api-.*")])],
                &labels
            ),
            vec!["r"]
        );
        assert_eq!(
            select_receivers(
                &[route("r", false, vec![m("absent", MatchOp::Ne, "x")])],
                &labels
            ),
            vec!["r"]
        );
    }

    #[test]
    fn grouping_targets_apply_defaults_and_dedup_by_receiver() {
        let labels = match_labels(&ev(Severity::Critical, &[("svc", "api")]));
        let mut r1 = route("ops", true, vec![m("severity", MatchOp::Eq, "critical")]);
        r1.group_wait_secs = Some(3);
        let r2 = route("ops", false, vec![m("svc", MatchOp::Eq, "api")]); // same receiver again
        let targets = select_grouping_targets(&[r1, r2], &labels);
        assert_eq!(targets.len(), 1, "receiver deduped, first match wins");
        assert_eq!(targets[0].receiver, "ops");
        assert_eq!(targets[0].grouping.group_wait_secs, 3);
        assert_eq!(targets[0].grouping.group_interval_secs, 300);
        assert_eq!(
            targets[0].grouping.repeat_interval_secs, None,
            "no repeat unless the route sets one"
        );
        assert_eq!(
            targets[0].grouping.group_by,
            vec!["rule".to_string(), "severity".to_string()]
        );
    }

    proptest! {
        #[test]
        fn empty_matchers_always_selects_first(extra in prop::collection::vec("[a-z]{1,4}", 0..3)) {
            let labels = match_labels(&ev(Severity::Info, &[]));
            let mut routes = vec![route("first", false, vec![])];
            for (i, name) in extra.iter().enumerate() {
                routes.push(route(&format!("{name}{i}"), false, vec![]));
            }
            prop_assert_eq!(select_receivers(&routes, &labels), vec!["first".to_string()]);
        }
    }
}
