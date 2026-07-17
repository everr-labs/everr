//! Spec §5 tier inhibition: materializing an SLO auto-provisions inhibition so a
//! higher (faster-burning) tier suppresses lower tiers for the same (slo, group).
//! Synthesized in-memory on every snapshot load (see [`crate::dispatcher::cache`]) —
//! never stored, so there are no rows to create/delete/sync and users cannot break
//! the no-triple-page guarantee by messing with them.

use crate::domain::inhibition::InhibitionRule;
use crate::domain::routing::{MatchOp, Matcher};
use crate::domain::slo::{canonical_tiers, Slo};
use crate::engine::slo_math::tier_pairs;
use time::OffsetDateTime;
use uuid::Uuid;

/// Auto-provisioned tier inhibitions (spec §5): for every SLO and every
/// (higher, lower) tier pair, the higher tier suppresses the lower for the
/// same (slo, group). Synthesized on every snapshot load — never stored, so
/// lifecycle is automatic and users cannot break the no-triple-page guarantee.
pub(crate) fn synthesize_slo_inhibitions(slos: &[Slo]) -> Vec<InhibitionRule> {
    let mut out = Vec::new();
    for slo in slos {
        let tiers = slo.spec.tiers.clone().unwrap_or_else(canonical_tiers);
        let slo_str = slo.id.0.to_string();

        let mut equal: Vec<String> = std::iter::once("slo".to_string())
            .chain(slo.spec.sli.label_columns.iter().cloned())
            .collect();
        equal.sort();
        equal.dedup();

        for (i, j) in tier_pairs(&tiers) {
            out.push(InhibitionRule {
                // Inert sentinel: `is_inhibited` (src/dispatcher/inhibition.rs) never reads
                // `id` or `created_at` — matching is entirely source/target matchers + `equal`
                // against the firing set. Confirmed by reading the function before choosing
                // this shortcut instead of per-rule deterministic ids.
                id: Uuid::nil(),
                tenant: slo.tenant.clone(),
                source_matchers: vec![
                    Matcher {
                        label: "slo".to_string(),
                        op: MatchOp::Eq,
                        value: slo_str.clone(),
                    },
                    Matcher {
                        label: "slo_tier".to_string(),
                        op: MatchOp::Eq,
                        value: tiers[i].name.clone(),
                    },
                ],
                target_matchers: vec![
                    Matcher {
                        label: "slo".to_string(),
                        op: MatchOp::Eq,
                        value: slo_str.clone(),
                    },
                    Matcher {
                        label: "slo_tier".to_string(),
                        op: MatchOp::Eq,
                        value: tiers[j].name.clone(),
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
    use crate::domain::slo::{SliSpec, SloSpec, TimeWindow};
    use std::collections::BTreeMap;

    fn slo_with(label_columns: Vec<String>) -> Slo {
        Slo {
            id: SloId(Uuid::new_v4()),
            tenant: TenantId::from_trusted(Uuid::new_v4().to_string()),
            name: "checkout-availability".into(),
            spec: SloSpec {
                sli: SliSpec {
                    sql: "SELECT 1 AS good, 1 AS valid".into(),
                    label_columns,
                },
                target_percent: 99.9,
                time_window: TimeWindow {
                    duration: "30d".into(),
                    is_rolling: true,
                    calendar: None,
                },
                min_valid_events: None,
                tiers: None, // canonical
                annotations: BTreeMap::new(),
                suppressed: false,
            },
            version: 1,
            paused: false,
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
}
