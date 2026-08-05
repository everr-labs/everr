use crate::dispatcher::grouping;
use crate::dispatcher::matching::matchers_match;
use crate::domain::ids::{RuleId, SloId};
use crate::domain::routing::Route;
use crate::domain::rule::Severity;
use crate::domain::slo::SLO_LABEL;
use crate::domain::{Event, EventKind, EventStatus};
use std::collections::BTreeMap;

/// Add synthetic event fields to the matchable labels.
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
    m.insert("severity".to_string(), severity.as_str().to_string());
    m.insert("status".to_string(), status.as_str().to_string());
    m.insert("rule".to_string(), rule.0.to_string());
    m.insert("kind".to_string(), kind.as_str().to_string());
    if let Some(s) = slo {
        m.insert(SLO_LABEL.to_string(), s.0.to_string());
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

/// Resolved grouping parameters for one matched receiver (route defaults applied).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupingParams {
    pub group_by: Vec<String>,
    pub group_wait_secs: u32,
    pub group_interval_secs: u32,
    /// Still-firing reminder cadence. None = never re-notify (no route default).
    pub repeat_interval_secs: Option<u32>,
}

/// A receiver selected for an event, with its grouping parameters. `receiver_id` is
/// the identity (snapshot lookup, group identity); `receiver` is the display name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchedTarget {
    pub receiver: String,
    pub receiver_id: uuid::Uuid,
    pub grouping: GroupingParams,
}

/// Default route grouping for SLO events: one notification group per SLO,
/// collapsing burn-rate tiers.
pub(crate) fn slo_default_group_by() -> Vec<String> {
    vec![SLO_LABEL.to_string()]
}

/// Walk `routes` in the given order (pre-ordered by the store: priority asc, then
/// creation order); stop after the first matching route unless it has `continue ==
/// true`. Returns each unique receiver (first-match order) paired with the grouping
/// parameters from the FIRST route that selected it (route defaults applied).
/// `labels` is the event's matchable label set (`match_labels(ev)`), passed in so a
/// caller that already built it doesn't pay for a second synthetic-label clone.
///
/// The route-default `group_by` (used only when the route sets none) depends on whether
/// `ev` is SLO-originated: SLO events default to `slo_default_group_by()`
/// (collapsing burn-rate tiers into one group per SLO); all other
/// events keep the existing `["rule","severity"]` default. An explicit route `group_by`
/// always wins regardless of `ev.slo`.
pub fn select_grouping_targets(
    routes: &[Route],
    ev: &Event,
    labels: &BTreeMap<String, String>,
) -> Vec<MatchedTarget> {
    let mut out: Vec<MatchedTarget> = Vec::new();
    for r in routes {
        if route_matches(r, labels) {
            if !out.iter().any(|t| t.receiver_id == r.receiver_id) {
                out.push(MatchedTarget {
                    receiver: r.receiver.clone(),
                    receiver_id: r.receiver_id,
                    grouping: GroupingParams {
                        group_by: r.group_by.clone().unwrap_or_else(|| {
                            if ev.slo.is_some() {
                                slo_default_group_by()
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
    use std::collections::BTreeMap;
    use time::OffsetDateTime;
    use uuid::Uuid;

    fn ev(severity: Severity, labels: &[(&str, &str)]) -> Event {
        Event::new(
            TenantId::from_trusted(Uuid::nil().to_string()),
            RuleId(Uuid::nil()),
            InstanceKey("k".into()),
            EventStatus::Firing,
            labels
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            None,
            severity,
            BTreeMap::new(),
            OffsetDateTime::UNIX_EPOCH,
        )
    }

    fn route(receiver: &str, cont: bool, matchers: Vec<Matcher>) -> Route {
        Route {
            id: Uuid::nil(),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            matchers,
            receiver: receiver.into(),
            // Deterministic per name, so two routes naming the same receiver share
            // an id (the dedup key) the way stored routes would.
            receiver_id: Uuid::from_u128(
                receiver
                    .bytes()
                    .fold(0u128, |acc, b| acc.wrapping_mul(257).wrapping_add(b.into())),
            ),
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

    /// Route-walk receiver names for `ev`, via the production selection path.
    fn receivers(routes: &[Route], ev: &Event) -> Vec<String> {
        select_grouping_targets(routes, ev, &match_labels(ev))
            .into_iter()
            .map(|t| t.receiver)
            .collect()
    }

    /// Grouping targets for `ev`, building the label set the way production does.
    fn targets(routes: &[Route], ev: &Event) -> Vec<MatchedTarget> {
        select_grouping_targets(routes, ev, &match_labels(ev))
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

        let alert = ev(Severity::Info, &[]);
        assert_eq!(match_labels(&alert)["kind"], "alert");

        // A health route selects health and not a plain alert.
        let routes = vec![route(
            "ops",
            false,
            vec![m("kind", MatchOp::Eq, "rule_health")],
        )];
        assert_eq!(receivers(&routes, &e), vec!["ops"]);
        assert!(receivers(&routes, &alert).is_empty());
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
    fn first_match_wins_without_continue() {
        let e = ev(Severity::Critical, &[]);
        let routes = vec![
            route("pd", false, vec![m("severity", MatchOp::Eq, "critical")]),
            route("ops", false, vec![m("severity", MatchOp::Eq, "critical")]),
        ];
        assert_eq!(receivers(&routes, &e), vec!["pd"]);
    }

    #[test]
    fn continue_collects_multiple_receivers() {
        let e = ev(Severity::Critical, &[]);
        let routes = vec![
            route("pd", true, vec![m("severity", MatchOp::Eq, "critical")]),
            route("ops", false, vec![m("severity", MatchOp::Eq, "critical")]),
        ];
        assert_eq!(receivers(&routes, &e), vec!["pd", "ops"]);
    }

    #[test]
    fn grouping_targets_apply_defaults_and_dedup_by_receiver() {
        let e = ev(Severity::Critical, &[("svc", "api")]);
        let mut r1 = route("ops", true, vec![m("severity", MatchOp::Eq, "critical")]);
        r1.group_wait_secs = Some(3);
        let r2 = route("ops", false, vec![m("svc", MatchOp::Eq, "api")]); // same receiver again
        let targets = targets(&[r1, r2], &e);
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
    fn slo_event_route_group_by_none_defaults_to_slo() {
        use crate::domain::ids::SloId;
        let mut e = ev(Severity::Critical, &[("slo_tier", "fast-burn")]);
        e.slo = Some(SloId(Uuid::nil()));
        let routes = vec![route("ops", false, vec![])];
        let targets = targets(&routes, &e);
        assert_eq!(
            targets[0].grouping.group_by,
            vec!["slo".to_string()],
            "SLO event with no explicit route group_by uses slo_default_group_by"
        );
    }

    #[test]
    fn slo_event_explicit_route_group_by_always_wins() {
        use crate::domain::ids::SloId;
        let mut e = ev(Severity::Critical, &[("slo_tier", "fast-burn")]);
        e.slo = Some(SloId(Uuid::nil()));
        let mut r = route("ops", false, vec![]);
        r.group_by = Some(vec!["severity".to_string()]);
        let targets = targets(&[r], &e);
        assert_eq!(
            targets[0].grouping.group_by,
            vec!["severity".to_string()],
            "explicit route group_by always wins, even for SLO events"
        );
    }
}
