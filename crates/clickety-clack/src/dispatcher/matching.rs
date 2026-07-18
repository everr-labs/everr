//! The single matcher engine shared by routing, silences, and inhibition.

use crate::domain::routing::{MatchOp, Matcher};
use std::collections::{BTreeMap, HashMap};
use std::sync::{OnceLock, RwLock};

/// Process-global cache of compiled, anchored patterns, keyed by the raw pattern string.
/// `None` records a pattern that failed to compile (known-invalid, never matches).
/// Patterns come from user routes/silences/inhibitions; the distinct count is bounded by
/// configuration size, so the map is intentionally unbounded (see spec §1c).
static REGEX_CACHE: OnceLock<RwLock<HashMap<String, Option<regex::Regex>>>> = OnceLock::new();

/// Anchored (full-string) regex match. An invalid pattern never matches.
/// Each distinct pattern is compiled at most once; compile failures are cached too.
pub fn regex_full_match(pattern: &str, val: &str) -> bool {
    let cache = REGEX_CACHE.get_or_init(|| RwLock::new(HashMap::new()));
    // Fast path: already compiled (or known-invalid).
    if let Ok(guard) = cache.read() {
        if let Some(entry) = guard.get(pattern) {
            return entry.as_ref().is_some_and(|re| re.is_match(val));
        }
    }
    // Slow path: compile once, store the outcome (including failure), match.
    let compiled = regex::Regex::new(&format!("^(?:{pattern})$")).ok();
    let matched = compiled.as_ref().is_some_and(|re| re.is_match(val));
    if let Ok(mut guard) = cache.write() {
        guard.insert(pattern.to_string(), compiled);
    }
    matched
}

/// Match one matcher against a label set. A missing label is the empty string
/// (Alertmanager-like): `severity != critical` is true when `severity` is absent.
pub fn matcher_matches(m: &Matcher, labels: &BTreeMap<String, String>) -> bool {
    let val = labels.get(&m.label).map(|s| s.as_str()).unwrap_or("");
    match m.op {
        MatchOp::Eq => val == m.value,
        MatchOp::Ne => val != m.value,
        MatchOp::Regex => regex_full_match(&m.value, val),
        MatchOp::NotRegex => !regex_full_match(&m.value, val),
    }
}

/// All matchers must match. An empty matcher list matches everything.
pub fn matchers_match(matchers: &[Matcher], labels: &BTreeMap<String, String>) -> bool {
    matchers.iter().all(|m| matcher_matches(m, labels))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }
    fn m(label: &str, op: MatchOp, value: &str) -> Matcher {
        Matcher {
            label: label.into(),
            op,
            value: value.into(),
        }
    }

    #[test]
    fn empty_matchers_match_everything() {
        assert!(matchers_match(&[], &labels(&[("a", "b")])));
    }

    #[test]
    fn eq_and_ne() {
        let l = labels(&[("svc", "api")]);
        assert!(matcher_matches(&m("svc", MatchOp::Eq, "api"), &l));
        assert!(!matcher_matches(&m("svc", MatchOp::Eq, "web"), &l));
        assert!(matcher_matches(&m("svc", MatchOp::Ne, "web"), &l));
    }

    #[test]
    fn missing_label_is_empty_string() {
        let l = labels(&[]);
        assert!(!matcher_matches(&m("svc", MatchOp::Eq, "api"), &l));
        assert!(matcher_matches(&m("svc", MatchOp::Ne, "api"), &l));
    }

    #[test]
    fn regex_is_anchored() {
        let l = labels(&[("svc", "api")]);
        assert!(matcher_matches(&m("svc", MatchOp::Regex, "api"), &l));
        assert!(
            !matcher_matches(&m("svc", MatchOp::Regex, "ap"), &l),
            "anchored, not a prefix"
        );
        assert!(matcher_matches(&m("svc", MatchOp::Regex, "ap.*"), &l));
        assert!(matcher_matches(&m("svc", MatchOp::NotRegex, "web"), &l));
    }

    #[test]
    fn invalid_pattern_never_matches() {
        let l = labels(&[("svc", "api")]);
        assert!(!matcher_matches(
            &m("svc", MatchOp::Regex, "[unterminated"),
            &l
        ));
    }

    #[test]
    fn repeated_patterns_are_consistent_and_cached() {
        // Same pattern, many calls: behavior identical across calls (cache must not corrupt results).
        for _ in 0..3 {
            assert!(regex_full_match("api-.*", "api-1"));
            assert!(!regex_full_match("api-.*", "web-1"));
            assert!(!regex_full_match("[unterminated", "anything")); // invalid never matches, cached or not
        }
        // Distinct patterns coexist in the cache.
        assert!(regex_full_match("a+", "aaa"));
        assert!(regex_full_match("b+", "bbb"));
        assert!(!regex_full_match("a+", "bbb"));
    }

    #[test]
    fn all_matchers_must_match() {
        let l = labels(&[("svc", "api"), ("env", "prod")]);
        assert!(matchers_match(
            &[m("svc", MatchOp::Eq, "api"), m("env", MatchOp::Eq, "prod")],
            &l
        ));
        assert!(!matchers_match(
            &[m("svc", MatchOp::Eq, "api"), m("env", MatchOp::Eq, "dev")],
            &l
        ));
    }
}
