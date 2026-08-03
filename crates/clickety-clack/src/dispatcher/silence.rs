//! Stage 2 of the dispatch pipeline: drop events matching an active silence.

use crate::dispatcher::matching::matchers_match;
use crate::domain::silence::Silence;
use std::collections::BTreeMap;
use time::OffsetDateTime;
use uuid::Uuid;

/// The id of the first silence that is active at `now` and matches every label via its
/// matchers, or `None` if no silence suppresses these labels. Used by the dispatcher to
/// stamp `alert.silence_id` on the emitted `silenced` log record.
pub fn matching_silence(
    labels: &BTreeMap<String, String>,
    silences: &[Silence],
    now: OffsetDateTime,
) -> Option<Uuid> {
    silences
        .iter()
        .find(|s| s.is_active(now) && matchers_match(&s.matchers, labels))
        .map(|s| s.id)
}

/// True if any silence that is active at `now` matches every label via its matchers.
pub fn is_silenced(
    labels: &BTreeMap<String, String>,
    silences: &[Silence],
    now: OffsetDateTime,
) -> bool {
    matching_silence(labels, silences, now).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::TenantId;
    use crate::domain::routing::{MatchOp, Matcher};
    use time::Duration;
    use uuid::Uuid;

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn silence(matchers: Vec<Matcher>, start: OffsetDateTime, end: OffsetDateTime) -> Silence {
        Silence {
            id: Uuid::nil(),
            tenant: TenantId::from_trusted(Uuid::nil().to_string()),
            matchers,
            starts_at: start,
            ends_at: end,
            comment: String::new(),
            author: String::new(),
            created_at: start,
        }
    }
    fn m(label: &str, value: &str) -> Matcher {
        Matcher {
            label: label.into(),
            op: MatchOp::Eq,
            value: value.into(),
        }
    }

    #[test]
    fn expired_or_future_silence_does_not_silence() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let expired = silence(
            vec![m("svc", "api")],
            now - Duration::seconds(60),
            now - Duration::seconds(1),
        );
        let future = silence(
            vec![m("svc", "api")],
            now + Duration::seconds(1),
            now + Duration::seconds(60),
        );
        let l = labels(&[("svc", "api")]);
        assert!(!is_silenced(&l, std::slice::from_ref(&expired), now));
        assert!(!is_silenced(&l, std::slice::from_ref(&future), now));
    }

    #[test]
    fn matching_silence_returns_the_matching_silence_id() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let sid = Uuid::from_u128(42);
        let mut s = silence(
            vec![m("svc", "api")],
            now - Duration::seconds(1),
            now + Duration::seconds(60),
        );
        s.id = sid;
        assert_eq!(
            matching_silence(&labels(&[("svc", "api")]), std::slice::from_ref(&s), now),
            Some(sid)
        );
        // Non-matching labels yield no silence.
        assert_eq!(
            matching_silence(&labels(&[("svc", "web")]), std::slice::from_ref(&s), now),
            None
        );
    }

    #[test]
    fn empty_matchers_silence_everything_while_active() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let s = silence(
            vec![],
            now - Duration::seconds(1),
            now + Duration::seconds(60),
        );
        assert!(is_silenced(
            &labels(&[("svc", "anything")]),
            std::slice::from_ref(&s),
            now
        ));
    }
}
