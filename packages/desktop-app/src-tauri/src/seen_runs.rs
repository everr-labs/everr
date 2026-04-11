use anyhow::Result;
use everr_core::state::SeenRunEntry;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::settings::update_persisted_state;
use crate::RuntimeState;

const EXPIRY_SECONDS: i64 = 3600; // 1 hour

fn is_expired(entry: &SeenRunEntry) -> bool {
    let Ok(added_at) = OffsetDateTime::parse(&entry.added_at, &Rfc3339) else {
        return true;
    };
    let now = OffsetDateTime::now_utc();
    (now - added_at).whole_seconds() >= EXPIRY_SECONDS
}

pub(crate) fn add_seen_run(state: &RuntimeState, trace_id: &str) -> Result<()> {
    let trace_id = trace_id.to_string();
    update_persisted_state(state, |persisted| {
        let entries = &mut persisted.settings.seen_runs;
        if entries.iter().any(|e| e.trace_id == trace_id) {
            return;
        }
        let now = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_default();
        entries.push(SeenRunEntry {
            trace_id,
            added_at: now,
            seen_at: None,
        });
        entries.retain(|e| !is_expired(e));
    })
}

pub(crate) fn mark_seen(state: &RuntimeState, trace_id: &str) -> Result<()> {
    let trace_id = trace_id.to_string();
    update_persisted_state(state, |persisted| {
        let now = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_default();
        for entry in &mut persisted.settings.seen_runs {
            if entry.trace_id == trace_id && entry.seen_at.is_none() {
                entry.seen_at = Some(now.clone());
            }
        }
        persisted.settings.seen_runs.retain(|e| !is_expired(e));
    })
}

pub(crate) fn mark_all_seen(state: &RuntimeState) -> Result<()> {
    update_persisted_state(state, |persisted| {
        let now = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_default();
        for entry in &mut persisted.settings.seen_runs {
            if entry.seen_at.is_none() {
                entry.seen_at = Some(now.clone());
            }
        }
        persisted.settings.seen_runs.retain(|e| !is_expired(e));
    })
}

pub(crate) fn unseen_trace_ids(state: &RuntimeState) -> Result<Vec<String>> {
    let persisted = state
        .persisted
        .lock()
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(persisted
        .settings
        .seen_runs
        .iter()
        .filter(|e| e.seen_at.is_none() && !is_expired(e))
        .map(|e| e.trace_id.clone())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::test_runtime_state;

    #[test]
    fn add_and_retrieve_unseen() {
        let state = test_runtime_state();
        add_seen_run(&state, "trace-a").unwrap();
        add_seen_run(&state, "trace-b").unwrap();

        let ids = unseen_trace_ids(&state).unwrap();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"trace-a".to_string()));
        assert!(ids.contains(&"trace-b".to_string()));
    }

    #[test]
    fn add_skips_duplicate() {
        let state = test_runtime_state();
        add_seen_run(&state, "trace-a").unwrap();
        add_seen_run(&state, "trace-a").unwrap();

        let ids = unseen_trace_ids(&state).unwrap();
        assert_eq!(ids.len(), 1);
    }

    #[test]
    fn mark_seen_removes_from_unseen() {
        let state = test_runtime_state();
        add_seen_run(&state, "trace-a").unwrap();
        add_seen_run(&state, "trace-b").unwrap();
        mark_seen(&state, "trace-a").unwrap();

        let ids = unseen_trace_ids(&state).unwrap();
        assert_eq!(ids, vec!["trace-b".to_string()]);
    }

    #[test]
    fn mark_all_seen_clears_unseen() {
        let state = test_runtime_state();
        add_seen_run(&state, "trace-a").unwrap();
        add_seen_run(&state, "trace-b").unwrap();
        mark_all_seen(&state).unwrap();

        let ids = unseen_trace_ids(&state).unwrap();
        assert!(ids.is_empty());
    }

    #[test]
    fn expired_entries_are_pruned_on_mutation() {
        let state = test_runtime_state();

        // Inject an already-expired entry directly into persisted state
        {
            let mut persisted = state.persisted.lock().unwrap();
            persisted.settings.seen_runs.push(SeenRunEntry {
                trace_id: "expired".to_string(),
                added_at: "2000-01-01T00:00:00Z".to_string(),
                seen_at: None,
            });
        }

        // The expired entry should not appear in unseen
        let ids = unseen_trace_ids(&state).unwrap();
        assert!(ids.is_empty());

        // Adding a new entry should prune the expired one from storage
        add_seen_run(&state, "fresh").unwrap();
        let persisted = state.persisted.lock().unwrap();
        assert_eq!(persisted.settings.seen_runs.len(), 1);
        assert_eq!(persisted.settings.seen_runs[0].trace_id, "fresh");
    }
}
