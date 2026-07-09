use crate::domain::instance::Status;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

/// Rule-level rolled-up alert state, mirroring everr's old `alert_definitions.currentState`
/// but on CC's three-state instance axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertState {
    Inactive,
    Pending,
    Firing,
}

impl AlertState {
    pub fn as_db(self) -> &'static str {
        match self {
            AlertState::Inactive => "inactive",
            AlertState::Pending => "pending",
            AlertState::Firing => "firing",
        }
    }
    pub fn from_db(s: &str) -> AlertState {
        match s {
            "firing" => AlertState::Firing,
            "pending" => AlertState::Pending,
            _ => AlertState::Inactive,
        }
    }
}

/// The per-evaluation rollup written alongside instance state. Timestamps are `None`
/// when the eval produced no transition of that kind; the store coalesces them with the
/// existing column (only-advance semantics) so a None never clears a prior value.
#[derive(Debug, Clone, PartialEq)]
pub struct RuleRollup {
    pub state: AlertState,
    pub firing_instance_count: i32,
    /// Set iff at least one instance transitioned INTO firing this eval.
    pub fired_at: Option<OffsetDateTime>,
    /// Set iff at least one instance resolved (left firing/pending) this eval.
    pub resolved_at: Option<OffsetDateTime>,
    /// Set iff this eval saw >= 1 present row.
    pub seen_at: Option<OffsetDateTime>,
    pub row_count: i32,
}

impl RuleRollup {
    /// Aggregate the next-state instance set for one rule into the rule rollup.
    /// `prev_status_by_key` is the status of each instance BEFORE this eval (to detect
    /// into-firing / out-of-firing transitions). `row_count` = rows returned by the eval.
    pub fn from_instances(
        next: &[(crate::domain::ids::InstanceKey, Status)],
        prev_status_by_key: &std::collections::HashMap<crate::domain::ids::InstanceKey, Status>,
        row_count: i32,
        now: OffsetDateTime,
    ) -> RuleRollup {
        let mut firing = 0i32;
        let mut any_pending = false;
        let mut fired = false;
        let mut resolved = false;
        for (key, status) in next {
            let prev = prev_status_by_key
                .get(key)
                .copied()
                .unwrap_or(Status::Inactive);
            match status {
                Status::Firing => {
                    firing += 1;
                    if prev != Status::Firing {
                        fired = true;
                    }
                }
                Status::Pending => any_pending = true,
                Status::Inactive => {
                    if prev == Status::Firing || prev == Status::Pending {
                        resolved = true;
                    }
                }
            }
        }
        let state = if firing > 0 {
            AlertState::Firing
        } else if any_pending {
            AlertState::Pending
        } else {
            AlertState::Inactive
        };
        RuleRollup {
            state,
            firing_instance_count: firing,
            fired_at: if fired { Some(now) } else { None },
            resolved_at: if resolved { Some(now) } else { None },
            seen_at: if row_count > 0 { Some(now) } else { None },
            row_count,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId};
    use std::collections::HashMap;
    use uuid::Uuid;

    fn k(n: &str) -> InstanceKey {
        InstanceKey::new(
            RuleId(Uuid::nil()),
            &std::collections::BTreeMap::from([("h".into(), n.into())]),
        )
    }

    #[test]
    fn firing_dominates_and_counts() {
        let a = k("a");
        let b = k("b");
        let next = vec![(a.clone(), Status::Firing), (b.clone(), Status::Pending)];
        let prev = HashMap::new();
        let r = RuleRollup::from_instances(&next, &prev, 5, OffsetDateTime::UNIX_EPOCH);
        assert_eq!(r.state, AlertState::Firing);
        assert_eq!(r.firing_instance_count, 1);
        assert!(r.fired_at.is_some(), "a went inactive->firing");
        assert!(r.seen_at.is_some(), "row_count > 0");
        assert_eq!(r.row_count, 5);
    }

    #[test]
    fn pending_only_when_no_firing() {
        let next = vec![(k("a"), Status::Pending)];
        let r = RuleRollup::from_instances(&next, &HashMap::new(), 1, OffsetDateTime::UNIX_EPOCH);
        assert_eq!(r.state, AlertState::Pending);
        assert_eq!(r.firing_instance_count, 0);
        assert!(r.fired_at.is_none());
    }

    #[test]
    fn resolve_detected_when_firing_goes_inactive() {
        let a = k("a");
        let prev = HashMap::from([(a.clone(), Status::Firing)]);
        let next = vec![(a.clone(), Status::Inactive)];
        let r = RuleRollup::from_instances(&next, &prev, 0, OffsetDateTime::UNIX_EPOCH);
        assert_eq!(r.state, AlertState::Inactive);
        assert!(r.resolved_at.is_some());
        assert!(r.seen_at.is_none(), "no present rows this eval");
    }

    use proptest::prelude::*;

    fn status_strategy() -> impl Strategy<Value = Status> {
        prop_oneof![
            Just(Status::Inactive),
            Just(Status::Pending),
            Just(Status::Firing),
        ]
    }

    proptest! {
        // Invariant: state == Firing iff any firing; else Pending iff any pending; else
        // Inactive. firing_instance_count always equals the firing tally. Never panics.
        #[test]
        fn rollup_state_matches_priority(
            statuses in proptest::collection::vec(status_strategy(), 0..40),
            row_count in 0i32..1000,
        ) {
            let next: Vec<(InstanceKey, Status)> = statuses
                .iter()
                .enumerate()
                .map(|(i, s)| (k(&format!("i{i}")), *s))
                .collect();
            let r = RuleRollup::from_instances(&next, &HashMap::new(), row_count, OffsetDateTime::UNIX_EPOCH);
            let any_firing = statuses.contains(&Status::Firing);
            let any_pending = statuses.contains(&Status::Pending);
            let firing_n = statuses.iter().filter(|s| **s == Status::Firing).count() as i32;
            prop_assert_eq!(r.firing_instance_count, firing_n);
            if any_firing {
                prop_assert_eq!(r.state, AlertState::Firing);
            } else if any_pending {
                prop_assert_eq!(r.state, AlertState::Pending);
            } else {
                prop_assert_eq!(r.state, AlertState::Inactive);
            }
            prop_assert_eq!(r.seen_at.is_some(), row_count > 0);
        }
    }
}
