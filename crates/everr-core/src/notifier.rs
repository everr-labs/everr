use std::collections::HashSet;

use crate::api::FailureNotification;

#[derive(Debug, Default)]
pub struct FailureTracker {
    seen: HashSet<String>,
}

impl FailureTracker {
    pub fn retain_new(&mut self, failures: Vec<FailureNotification>) -> Vec<FailureNotification> {
        let mut fresh = Vec::new();
        for failure in failures {
            if self.seen.insert(failure.dedupe_key.clone()) {
                fresh.push(failure);
            }
        }
        fresh
    }
}

#[cfg(test)]
mod tests {
    use crate::api::FailureNotification;

    use super::FailureTracker;

    #[test]
    fn retain_new_filters_seen_failures() {
        let mut tracker = FailureTracker::default();
        let failure = FailureNotification {
            dedupe_key: "key-1".to_string(),
            trace_id: "trace-1".to_string(),
            repo: "everr-labs/everr".to_string(),
            branch: "main".to_string(),
            workflow_name: "build".to_string(),
            failed_at: "2026-03-07T10:00:00Z".to_string(),
            details_url: "https://example.com".to_string(),
            failed_jobs: vec![],
        };

        assert_eq!(tracker.retain_new(vec![failure.clone()]).len(), 1);
        assert!(tracker.retain_new(vec![failure]).is_empty());
    }
}
