//! Spec §5 tier inhibition: materializing an SLO auto-provisions inhibition so a
//! higher (faster-burning) tier suppresses lower tiers for the same (slo, group).
//! Synthesized in-memory on every snapshot load (see [`crate::dispatcher::cache`]) —
//! never stored, so there are no rows to create/delete/sync and users cannot break
//! the no-triple-page guarantee by messing with them.

use crate::domain::inhibition::InhibitionRule;
use crate::domain::routing::{MatchOp, Matcher};
use crate::domain::slo::{SLO_LABEL, SLO_TIER_LABEL};
use crate::engine::slo_math::tier_pairs;
use crate::stores::SloDispatchInfo;
use time::OffsetDateTime;
use uuid::Uuid;

/// Auto-provisioned tier inhibitions (spec §5): for every SLO and every
/// (higher, lower) tier pair, the higher tier suppresses the lower for the
/// same (slo, group). Synthesized on every snapshot load — never stored, so
/// lifecycle is automatic and users cannot break the no-triple-page guarantee.
///
/// Takes the lean [`SloDispatchInfo`] projection (id/tenant/label_columns/tiers) rather
/// than the full `Slo` — `tiers` is already resolved (`spec.tiers`, or
/// `canonical_tiers()` when unset) by [`crate::stores::PgStore::list_slos_for_dispatch`],
/// so this function no longer needs to know about that fallback.
pub(crate) fn synthesize_slo_inhibitions(slos: &[SloDispatchInfo]) -> Vec<InhibitionRule> {
    let mut out = Vec::new();
    for slo in slos {
        let tiers = &slo.tiers;
        let slo_str = slo.id.0.to_string();

        let mut equal: Vec<String> = std::iter::once(SLO_LABEL.to_string())
            .chain(slo.label_columns.iter().cloned())
            .collect();
        equal.sort();
        equal.dedup();

        for (i, j) in tier_pairs(tiers) {
            out.push(InhibitionRule {
                // Inert sentinel: `is_inhibited` (src/dispatcher/inhibition.rs) never reads
                // `id` or `created_at` — matching is entirely source/target matchers + `equal`
                // against the firing set. Confirmed by reading the function before choosing
                // this shortcut instead of per-rule deterministic ids.
                id: Uuid::nil(),
                tenant: slo.tenant.clone(),
                source_matchers: vec![
                    Matcher {
                        label: SLO_LABEL.to_string(),
                        op: MatchOp::Eq,
                        value: slo_str.clone(),
                    },
                    Matcher {
                        label: SLO_TIER_LABEL.to_string(),
                        op: MatchOp::Eq,
                        value: tiers[i].name.clone(),
                    },
                ],
                target_matchers: vec![
                    Matcher {
                        label: SLO_LABEL.to_string(),
                        op: MatchOp::Eq,
                        value: slo_str.clone(),
                    },
                    Matcher {
                        label: SLO_TIER_LABEL.to_string(),
                        op: MatchOp::Eq,
                        value: tiers[j].name.clone(),
                    },
                    // Only Firing events are suppressed — a Resolved must always pass so a
                    // delivered page can close. Without this, a lower tier's Resolved event
                    // matches the target_matchers against a still-firing higher tier in the
                    // source-set and gets dropped at ingest, and the open incident never
                    // resolves (resolves don't page, so suppressing one buys no
                    // no-triple-page benefit).
                    Matcher {
                        label: "status".to_string(),
                        op: MatchOp::Eq,
                        value: "firing".to_string(),
                    },
                ],
                equal: equal.clone(),
                created_at: OffsetDateTime::UNIX_EPOCH,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{SloId, TenantId};
    use crate::domain::slo::canonical_tiers;
    use std::collections::BTreeMap;

    fn slo_with(label_columns: Vec<String>) -> SloDispatchInfo {
        SloDispatchInfo {
            id: SloId(Uuid::new_v4()),
            tenant: TenantId::from_trusted(Uuid::new_v4().to_string()),
            label_columns,
            tiers: canonical_tiers(),
        }
    }

    #[test]
    fn canonical_tiers_yield_three_rules_with_precedence_order() {
        let slo = slo_with(vec!["service".to_string()]);
        let rules = synthesize_slo_inhibitions(std::slice::from_ref(&slo));
        assert_eq!(rules.len(), 3, "3 tier pairs for 3 canonical tiers");

        let slo_str = slo.id.0.to_string();
        // tier_pairs(3 tiers) == [(0,1),(0,2),(1,2)] == fast-burn->slow-burn,
        // fast-burn->ticket, slow-burn->ticket (see slo_math::tier_pairs_precedence_order).
        let fast_to_ticket = &rules[1];
        assert_eq!(
            fast_to_ticket.source_matchers,
            vec![
                Matcher {
                    label: "slo".into(),
                    op: MatchOp::Eq,
                    value: slo_str.clone(),
                },
                Matcher {
                    label: "slo_tier".into(),
                    op: MatchOp::Eq,
                    value: "fast-burn".into(),
                },
            ]
        );
        assert_eq!(
            fast_to_ticket.target_matchers,
            vec![
                Matcher {
                    label: "slo".into(),
                    op: MatchOp::Eq,
                    value: slo_str,
                },
                Matcher {
                    label: "slo_tier".into(),
                    op: MatchOp::Eq,
                    value: "ticket".into(),
                },
                Matcher {
                    label: "status".into(),
                    op: MatchOp::Eq,
                    value: "firing".into(),
                },
            ]
        );
        assert_eq!(
            fast_to_ticket.equal,
            vec!["service".to_string(), "slo".to_string()],
            "equal = [\"slo\"] + label_columns, sorted, deduped"
        );
        assert_eq!(fast_to_ticket.tenant, slo.tenant);
    }

    #[test]
    fn no_slos_yields_no_rules() {
        assert!(synthesize_slo_inhibitions(&[]).is_empty());
    }

    #[test]
    fn slo_label_is_always_in_equal_even_without_label_columns() {
        let slo = slo_with(vec![]);
        let rules = synthesize_slo_inhibitions(std::slice::from_ref(&slo));
        assert_eq!(rules.len(), 3);
        for r in &rules {
            assert_eq!(r.equal, vec!["slo".to_string()]);
        }
    }

    #[test]
    fn duplicate_label_column_named_slo_is_deduped() {
        // Defensive: if a SLI's label_columns happened to include "slo" itself,
        // `equal` must not contain it twice.
        let slo = slo_with(vec!["slo".to_string()]);
        let rules = synthesize_slo_inhibitions(std::slice::from_ref(&slo));
        assert_eq!(rules[0].equal, vec!["slo".to_string()]);
    }

    #[test]
    fn resolved_events_are_never_inhibited() {
        use crate::dispatcher::inhibition::is_inhibited;
        use crate::dispatcher::routing::synthetic_labels;
        use crate::domain::ids::{InstanceKey, RuleId};
        use crate::domain::rule::Severity;
        use crate::domain::EventStatus;

        let slo = slo_with(vec!["service".to_string()]);
        let rules = synthesize_slo_inhibitions(std::slice::from_ref(&slo));

        // fast-burn -> slow-burn is rules[0] (see tier_pairs precedence order comment above).
        let fast_to_slow = std::slice::from_ref(&rules[0]);

        let mut user_labels = BTreeMap::new();
        user_labels.insert("service".to_string(), "api".to_string());
        user_labels.insert("slo_tier".to_string(), "slow-burn".to_string());

        let fast_source_key = InstanceKey("fast-burn-api".to_string());
        let mut fast_source_labels = BTreeMap::new();
        fast_source_labels.insert("service".to_string(), "api".to_string());
        fast_source_labels.insert("slo_tier".to_string(), "fast-burn".to_string());
        let fast_source_labels = synthetic_labels(
            &fast_source_labels,
            Severity::Critical,
            EventStatus::Firing,
            RuleId(slo.id.0),
            crate::domain::EventKind::Alert,
            Some(slo.id),
        );
        let firing = vec![(fast_source_key.clone(), fast_source_labels)];

        let slow_resolved_key = InstanceKey("slow-burn-api".to_string());
        let slow_resolved_labels = synthetic_labels(
            &user_labels,
            Severity::Critical,
            EventStatus::Resolved,
            RuleId(slo.id.0),
            crate::domain::EventKind::Alert,
            Some(slo.id),
        );
        assert!(
            !is_inhibited(
                &slow_resolved_labels,
                &slow_resolved_key,
                fast_to_slow,
                &firing
            ),
            "a Resolved event must never be inhibited, even while the higher tier is firing, \
             so a delivered page can close"
        );

        // The guarantee still holds for the Firing case: same labels but Firing status IS
        // inhibited by the still-firing fast-burn source for the same (slo, service).
        let slow_firing_key = InstanceKey("slow-burn-api-firing".to_string());
        let slow_firing_labels = synthetic_labels(
            &user_labels,
            Severity::Critical,
            EventStatus::Firing,
            RuleId(slo.id.0),
            crate::domain::EventKind::Alert,
            Some(slo.id),
        );
        assert!(
            is_inhibited(&slow_firing_labels, &slow_firing_key, fast_to_slow, &firing),
            "a Firing slow-burn event must still be inhibited by the firing fast-burn tier"
        );
    }
}
