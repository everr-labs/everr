use crate::dispatcher::grouping;
use crate::dispatcher::matching::matchers_match;
use crate::domain::ids::{RuleId, SloId};
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

/// Build the matchable label set from raw labels + synthetic `severity`/`status`/`rule`/`kind`/`slo`.
/// Synthetic labels take precedence over any same-named user label (inserted last).
pub fn synthetic_labels(
    labels: &BTreeMap<String, String>,
    severity: Severity,
    status: EventStatus,
    rule: RuleId,
    kind: EventKind,
    slo: Option<SloId>,
) -> BTreeMap<String, String> {
    let mut m = labels.clone();
    m.insert("severity".to_string(), severity_str(severity).to_string());
    m.insert("status".to_string(), status_str(status).to_string());
    m.insert("rule".to_string(), rule.0.to_string());
    m.insert("kind".to_string(), kind_str(kind).to_string());
    if let Some(s) = slo {
        m.insert("slo".to_string(), s.0.to_string());
    }
    m
}

/// The matchable label set for an event.
pub fn match_labels(ev: &Event) -> BTreeMap<String, String> {
    synthetic_labels(&ev.labels, ev.severity, ev.status, ev.rule, ev.kind, ev.slo)
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

/// Default group_by for SLO events (spec §5): one notification group per
/// (slo, group), collapsing tiers. Only used when the matched route has no
/// explicit group_by. Group-label names = the event's labels minus the
/// tier discriminator (slo_tier) — i.e. the SLI label_columns.
pub(crate) fn slo_default_group_by(ev_labels: &BTreeMap<String, String>) -> Vec<String> {
    let mut gb = vec!["slo".to_string()];
    gb.extend(ev_labels.keys().filter(|k| *k != "slo_tier").cloned());
    gb
}

/// Like `select_receivers`, but returns each unique receiver (first-match order) paired
/// with the grouping parameters from the FIRST route that selected it (route defaults
/// applied). `continue` semantics match `select_receivers`.
///
/// The route-default `group_by` (used only when the route sets none) depends on whether
/// `ev` is SLO-originated: SLO events default to `slo_default_group_by(&ev.labels)`
/// (spec §5, collapsing burn-rate tiers into one group per (slo, group)); all other
/// events keep the existing `["rule","severity"]` default. An explicit route `group_by`
/// always wins regardless of `ev.slo`.
pub fn select_grouping_targets(routes: &[Route], ev: &Event) -> Vec<MatchedTarget> {
    let labels = match_labels(ev);
    let mut out: Vec<MatchedTarget> = Vec::new();
    for r in routes {
        if route_matches(r, &labels) {
            if !out.iter().any(|t| t.receiver == r.receiver) {
                out.push(MatchedTarget {
                    receiver: r.receiver.clone(),
                    grouping: GroupingParams {
                        group_by: r.group_by.clone().unwrap_or_else(|| {
                            if ev.slo.is_some() {
                                slo_default_group_by(&ev.labels)
                            } else {
                                grouping::default_group_by()
                            }
                        }),
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
            slo: None,
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
    fn slo_is_a_matchable_synthetic_label_when_present() {
        use crate::domain::ids::SloId;
        let mut e = ev(Severity::Critical, &[]);
        e.slo = Some(SloId(Uuid::nil()));
        let labels = match_labels(&e);
        assert_eq!(labels["slo"], Uuid::nil().to_string());
    }

    #[test]
    fn slo_label_absent_when_event_has_none() {
        let labels = match_labels(&ev(Severity::Critical, &[]));
        assert!(!labels.contains_key("slo"));
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
        let e = ev(Severity::Critical, &[("svc", "api")]);
        let mut r1 = route("ops", true, vec![m("severity", MatchOp::Eq, "critical")]);
        r1.group_wait_secs = Some(3);
        let r2 = route("ops", false, vec![m("svc", MatchOp::Eq, "api")]); // same receiver again
        let targets = select_grouping_targets(&[r1, r2], &e);
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
            vec!["rule".to_string(), "severity".to_string()],
            "non-SLO event: unchanged default"
        );
    }

    #[test]
    fn slo_default_group_by_is_slo_plus_labels_minus_tier() {
        let labels = BTreeMap::from([
            ("service".to_string(), "api".to_string()),
            ("slo_tier".to_string(), "fast-burn".to_string()),
        ]);
        assert_eq!(
            slo_default_group_by(&labels),
            vec!["slo".to_string(), "service".to_string()]
        );
    }

    #[test]
    fn slo_event_route_group_by_none_defaults_to_slo_grouping() {
        use crate::domain::ids::SloId;
        let mut e = ev(
            Severity::Critical,
            &[("service", "api"), ("slo_tier", "fast-burn")],
        );
        e.slo = Some(SloId(Uuid::nil()));
        let routes = vec![route("ops", false, vec![])];
        let targets = select_grouping_targets(&routes, &e);
        assert_eq!(
            targets[0].grouping.group_by,
            vec!["slo".to_string(), "service".to_string()],
            "SLO event with no explicit route group_by uses slo_default_group_by"
        );
    }

    #[test]
    fn slo_event_explicit_route_group_by_always_wins() {
        use crate::domain::ids::SloId;
        let mut e = ev(
            Severity::Critical,
            &[("service", "api"), ("slo_tier", "fast-burn")],
        );
        e.slo = Some(SloId(Uuid::nil()));
        let mut r = route("ops", false, vec![]);
        r.group_by = Some(vec!["severity".to_string()]);
        let targets = select_grouping_targets(&[r], &e);
        assert_eq!(
            targets[0].grouping.group_by,
            vec!["severity".to_string()],
            "explicit route group_by always wins, even for SLO events"
        );
    }

    #[test]
    fn rule_event_default_group_by_is_unaffected_by_slo_change() {
        let e = ev(Severity::Critical, &[("svc", "api")]);
        let routes = vec![route("ops", false, vec![])];
        let targets = select_grouping_targets(&routes, &e);
        assert_eq!(
            targets[0].grouping.group_by,
            vec!["rule".to_string(), "severity".to_string()],
            "non-SLO event keeps the rule/severity default"
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
