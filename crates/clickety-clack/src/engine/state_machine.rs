use crate::domain::event::{Event, EventStatus};
use crate::domain::instance::{InstanceState, Status};
use crate::domain::rule::Severity;
use std::collections::BTreeMap;
use time::{Duration, OffsetDateTime};

/// Inputs describing one evaluation of one instance.
pub struct EvalInput<'a> {
    /// Is the row present in this evaluation's result?
    pub present: bool,
    pub value: Option<f64>,
    /// Owned: differs per instance (unlike `annotations`, shared across the rule).
    pub labels: BTreeMap<String, String>,
    pub for_duration: Duration,
    /// Consecutive absent evaluations required to resolve; must be >= 1.
    pub resolve_after: u32,
    pub severity: Severity,
    pub annotations: &'a BTreeMap<String, String>,
    pub eval_ts: OffsetDateTime,
}

/// Result of applying one evaluation to one instance.
pub struct EvalOutcome {
    pub next: InstanceState,
    pub event: Option<Event>,
}

/// Pure transition function. Never panics. Deterministic in eval_ts.
pub fn evaluate(prev: InstanceState, input: EvalInput) -> EvalOutcome {
    debug_assert!(input.resolve_after >= 1, "resolve_after must be >= 1");

    let EvalInput {
        present,
        value,
        labels,
        for_duration,
        resolve_after,
        severity,
        annotations,
        eval_ts,
    } = input;

    let mut next = prev.clone();
    next.labels = labels; // moved, not cloned

    if present {
        next.value = value;
        next.last_seen = Some(eval_ts);
        next.absent_count = 0;

        match prev.status {
            Status::Inactive => {
                next.status = Status::Pending;
                next.active_since = Some(eval_ts);
                maybe_fire(next, eval_ts, for_duration, severity, annotations)
            }
            Status::Pending => {
                // active_since carried over; check whether `for` has elapsed.
                maybe_fire(next, eval_ts, for_duration, severity, annotations)
            }
            Status::Firing => EvalOutcome { next, event: None },
        }
    } else {
        // Row absent this evaluation.
        match prev.status {
            Status::Inactive => EvalOutcome { next, event: None },
            Status::Pending => {
                // Never fired; drop silently once absence threshold met.
                next.absent_count = prev.absent_count + 1;
                if next.absent_count >= resolve_after {
                    reset_inactive(&mut next);
                }
                EvalOutcome { next, event: None }
            }
            Status::Firing => {
                next.absent_count = prev.absent_count + 1;
                if next.absent_count >= resolve_after {
                    let event =
                        make_event(&next, severity, annotations, eval_ts, EventStatus::Resolved);
                    reset_inactive(&mut next);
                    EvalOutcome {
                        next,
                        event: Some(event),
                    }
                } else {
                    EvalOutcome { next, event: None }
                }
            }
        }
    }
}

fn maybe_fire(
    mut next: InstanceState,
    eval_ts: OffsetDateTime,
    for_duration: Duration,
    severity: Severity,
    annotations: &BTreeMap<String, String>,
) -> EvalOutcome {
    let since = next.active_since.expect("active_since set when present");
    let elapsed = eval_ts - since;
    if next.status != Status::Firing && elapsed >= for_duration {
        next.status = Status::Firing;
        let event = make_event(&next, severity, annotations, eval_ts, EventStatus::Firing);
        EvalOutcome {
            next,
            event: Some(event),
        }
    } else {
        EvalOutcome { next, event: None }
    }
}

fn reset_inactive(next: &mut InstanceState) {
    next.status = Status::Inactive;
    next.active_since = None;
    next.absent_count = 0;
}

fn make_event(
    s: &InstanceState,
    severity: Severity,
    annotations: &BTreeMap<String, String>,
    eval_ts: OffsetDateTime,
    status: EventStatus,
) -> Event {
    Event::new(
        s.tenant.clone(),
        s.rule,
        s.key.clone(),
        status,
        s.labels.clone(),
        s.value,
        severity,
        annotations.clone(),
        eval_ts,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{InstanceKey, RuleId, TenantId};
    use uuid::Uuid;

    fn base() -> InstanceState {
        InstanceState::new_inactive(
            InstanceKey("k".into()),
            RuleId(Uuid::nil()),
            TenantId::from_trusted(Uuid::nil().to_string()),
            BTreeMap::new(),
        )
    }

    fn input(present: bool, for_secs: i64, ts: OffsetDateTime) -> EvalInput<'static> {
        static ANN: std::sync::OnceLock<BTreeMap<String, String>> = std::sync::OnceLock::new();
        EvalInput {
            present,
            value: Some(1.0),
            labels: BTreeMap::new(),
            for_duration: Duration::seconds(for_secs),
            resolve_after: 1,
            severity: Severity::Warning,
            annotations: ANN.get_or_init(BTreeMap::new),
            eval_ts: ts,
        }
    }

    fn t(secs: i64) -> OffsetDateTime {
        OffsetDateTime::UNIX_EPOCH + Duration::seconds(secs)
    }

    #[test]
    fn for_zero_fires_immediately() {
        let out = evaluate(base(), input(true, 0, t(0)));
        assert_eq!(out.next.status, Status::Firing);
        assert!(matches!(out.event, Some(e) if e.status == EventStatus::Firing));
    }

    #[test]
    fn pending_until_for_elapses() {
        let out1 = evaluate(base(), input(true, 60, t(0)));
        assert_eq!(out1.next.status, Status::Pending);
        assert!(out1.event.is_none());

        let out2 = evaluate(out1.next, input(true, 60, t(30)));
        assert_eq!(out2.next.status, Status::Pending);
        assert!(out2.event.is_none());

        let out3 = evaluate(out2.next, input(true, 60, t(60)));
        assert_eq!(out3.next.status, Status::Firing);
        assert!(out3.event.is_some());
    }

    #[test]
    fn pending_drops_without_event_on_absence() {
        let out1 = evaluate(base(), input(true, 60, t(0)));
        let out2 = evaluate(out1.next, input(false, 60, t(30)));
        assert_eq!(out2.next.status, Status::Inactive);
        assert!(out2.event.is_none());
    }

    #[test]
    fn firing_resolves_on_absence() {
        let fired = evaluate(base(), input(true, 0, t(0)));
        let resolved = evaluate(fired.next, input(false, 0, t(10)));
        assert_eq!(resolved.next.status, Status::Inactive);
        assert!(matches!(resolved.event, Some(e) if e.status == EventStatus::Resolved));
    }

    #[test]
    fn resolve_after_absorbs_single_flap() {
        let fired = evaluate(base(), input(true, 0, t(0)));
        let mut absent = input(false, 0, t(10));
        absent.resolve_after = 2;
        let out1 = evaluate(fired.next, absent);
        assert_eq!(out1.next.status, Status::Firing); // still firing after 1 absence
        assert!(out1.event.is_none());

        let mut absent2 = input(false, 0, t(20));
        absent2.resolve_after = 2;
        let out2 = evaluate(out1.next, absent2);
        assert_eq!(out2.next.status, Status::Inactive);
        assert!(out2.event.is_some());
    }

    #[test]
    fn firing_only_emits_once() {
        let fired = evaluate(base(), input(true, 0, t(0)));
        assert!(fired.event.is_some());
        let still = evaluate(fired.next, input(true, 0, t(10)));
        assert_eq!(still.next.status, Status::Firing);
        assert!(still.event.is_none());
    }

    use proptest::prelude::*;

    proptest! {
        // Invariant: we never emit a Firing event while already Firing, and never
        // emit a Resolved without a preceding Firing. Track with a shadow flag.
        #[test]
        fn no_fire_without_resolve(seq in proptest::collection::vec(any::<bool>(), 0..50)) {
            let mut state = base();
            let mut firing_emitted = false;
            for (i, present) in seq.into_iter().enumerate() {
                let out = evaluate(state, input(present, 0, t(i as i64)));
                if let Some(ev) = &out.event {
                    match ev.status {
                        EventStatus::Firing => {
                            prop_assert!(!firing_emitted, "double firing without resolve");
                            firing_emitted = true;
                        }
                        EventStatus::Resolved => {
                            prop_assert!(firing_emitted, "resolve without firing");
                            firing_emitted = false;
                        }
                    }
                }
                // Status and firing_emitted must agree.
                prop_assert_eq!(out.next.status == Status::Firing, firing_emitted);
                state = out.next;
            }
        }
    }

    proptest! {
        // Same invariant, but with a randomized `for` window and timestamps, to
        // exercise the pending -> inactive -> pending re-entry path under for > 0.
        #[test]
        fn invariant_holds_with_random_for(
            for_secs in 0i64..120,
            seq in proptest::collection::vec(any::<bool>(), 0..60),
        ) {
            let mut state = base();
            let mut firing_emitted = false;
            for (i, present) in seq.into_iter().enumerate() {
                // step time by 30s each eval so `for` windows are crossable
                let out = evaluate(state, input(present, for_secs, t(i as i64 * 30)));
                if let Some(ev) = &out.event {
                    match ev.status {
                        EventStatus::Firing => {
                            prop_assert!(!firing_emitted, "double firing without resolve");
                            firing_emitted = true;
                        }
                        EventStatus::Resolved => {
                            prop_assert!(firing_emitted, "resolve without firing");
                            firing_emitted = false;
                        }
                    }
                }
                prop_assert_eq!(out.next.status == Status::Firing, firing_emitted);
                state = out.next;
            }
        }
    }
}
