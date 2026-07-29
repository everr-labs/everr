//! Pure scheduling-cadence helpers: the per-rule anti-thundering-herd phase
//! offset and the adaptive-backoff state machine for quiet rules.
//!
//! Both functions are deterministic and side-effect free; the store layer
//! ([`crate::stores::PgStore`]) applies their results to `rules.next_eval` and
//! `rules.eval_backoff_secs`.

use uuid::Uuid;

/// Deterministic per-rule phase offset in `[0, interval_secs)`, used when a rule
/// is (re-)armed so rules sharing a round interval (60s, 300s, ...) do not all
/// become due on the same wall-clock tick and stampede ClickHouse.
///
/// The offset is a stable function of the rule id alone (FNV-1a 64 over the raw
/// UUID bytes), so it survives restarts and is identical on every scheduler
/// replica. The claim path always advances `next_eval` by one full interval,
/// which preserves the stagger afterwards. Total load and per-rule cadence are
/// unchanged; only the phase moves.
pub fn jitter_offset_secs(rule_id: Uuid, interval_secs: u32) -> u32 {
    if interval_secs == 0 {
        return 0;
    }
    // FNV-1a 64: explicitly specified here (rather than std's DefaultHasher) so
    // the phase is stable across Rust versions and process restarts by contract.
    const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut h = FNV_OFFSET;
    for b in rule_id.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(FNV_PRIME);
    }
    (h % u64::from(interval_secs)) as u32
}

/// Adaptive-backoff transition: the next effective evaluation interval for a
/// rule, given the outcome of the evaluation that just committed.
///
/// `current_backoff_secs` is the persisted stretch (`rules.eval_backoff_secs`),
/// where `0` means "not stretched, evaluate at `interval_secs`".
///
/// - `quiet` (the evaluation saw no present row and left no instance pending or
///   firing): the effective interval doubles from its current value, starting
///   at `interval_secs` and capped at `max_interval_secs`.
/// - not quiet (any present instance, including pending ones mid for-duration):
///   reset to `0` so an active rule is never on a stretched interval.
///
/// `max_interval_secs` below `interval_secs` is clamped up defensively (the API
/// rejects such specs with 422, but stored state must stay sane regardless).
pub fn next_backoff_secs(
    current_backoff_secs: u32,
    interval_secs: u32,
    max_interval_secs: u32,
    quiet: bool,
) -> u32 {
    if !quiet || interval_secs == 0 {
        return 0;
    }
    let max = u64::from(max_interval_secs.max(interval_secs));
    let doubled = u64::from(current_backoff_secs.max(interval_secs)) * 2;
    doubled.min(max) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jitter_is_stable_for_a_given_rule() {
        let id = Uuid::parse_str("5f8b9e2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b").unwrap();
        let a = jitter_offset_secs(id, 300);
        let b = jitter_offset_secs(id, 300);
        assert_eq!(a, b, "same id + interval must always yield the same phase");
    }

    #[test]
    fn jitter_respects_interval_bounds() {
        for i in 0..500u32 {
            let id = Uuid::from_u128(u128::from(i) * 7_919 + 3);
            for interval in [1u32, 2, 30, 60, 300, 3600, u32::MAX] {
                let off = jitter_offset_secs(id, interval);
                assert!(off < interval, "offset {off} out of [0, {interval})");
            }
        }
    }

    #[test]
    fn jitter_zero_interval_is_zero() {
        // interval_secs = 0 is rejected by validation; the function must still
        // not divide by zero if handed one.
        assert_eq!(jitter_offset_secs(Uuid::from_u128(42), 0), 0);
    }

    #[test]
    fn backoff_keeps_doubling_until_the_cap() {
        let (base, max) = (60, 3600);
        let mut cur = 0;
        let mut seen = Vec::new();
        for _ in 0..10 {
            cur = next_backoff_secs(cur, base, max, true);
            seen.push(cur);
        }
        assert_eq!(
            seen,
            vec![120, 240, 480, 960, 1920, 3600, 3600, 3600, 3600, 3600]
        );
    }

    #[test]
    fn backoff_cap_is_exact_when_doubling_overshoots() {
        // 60 -> 120 -> 240 would overshoot a 200s cap: clamp to 200, then stay.
        assert_eq!(next_backoff_secs(120, 60, 200, true), 200);
        assert_eq!(next_backoff_secs(200, 60, 200, true), 200);
    }

    #[test]
    fn backoff_active_eval_resets_immediately_from_any_stretch() {
        assert_eq!(next_backoff_secs(3600, 60, 3600, false), 0);
        assert_eq!(next_backoff_secs(120, 60, 3600, false), 0);
        assert_eq!(next_backoff_secs(0, 60, 3600, false), 0);
    }

    #[test]
    fn backoff_clamps_a_max_below_the_interval() {
        // Defensive: validation rejects max < interval, but stored state must
        // never stretch below the base cadence.
        assert_eq!(next_backoff_secs(0, 300, 10, true), 300);
    }

    #[test]
    fn backoff_does_not_overflow_near_u32_max() {
        let out = next_backoff_secs(u32::MAX, u32::MAX, u32::MAX, true);
        assert_eq!(out, u32::MAX);
    }

    #[test]
    fn backoff_zero_interval_is_inert() {
        assert_eq!(next_backoff_secs(0, 0, 100, true), 0);
    }
}
