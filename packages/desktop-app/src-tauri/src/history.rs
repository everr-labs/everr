use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use everr_core::api::FailureNotification;
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

const MAX_ENTRIES: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub notification: FailureNotification,
    pub seen: bool,
    pub received_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryFile {
    entries: Vec<HistoryEntry>,
}

#[derive(Clone)]
pub struct NotificationHistoryStore {
    path: PathBuf,
    state: Arc<Mutex<VecDeque<HistoryEntry>>>,
}

impl NotificationHistoryStore {
    pub fn load(path: PathBuf) -> Result<Self> {
        let entries = if path.exists() {
            let data = std::fs::read_to_string(&path)
                .with_context(|| format!("failed to read history file: {}", path.display()))?;
            let file: HistoryFile = serde_json::from_str(&data)
                .with_context(|| "failed to parse history file")?;
            VecDeque::from(file.entries)
        } else {
            VecDeque::new()
        };

        Ok(Self {
            path,
            state: Arc::new(Mutex::new(entries)),
        })
    }

    pub fn append(&self, notification: FailureNotification) -> Result<()> {
        let mut entries = self.state.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let now = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .context("failed to format timestamp")?;

        entries.push_back(HistoryEntry {
            notification,
            seen: false,
            received_at: now,
        });

        while entries.len() > MAX_ENTRIES {
            entries.pop_front();
        }

        self.save_locked(&entries)
    }

    pub fn mark_seen(&self, dedupe_key: &str) -> Result<()> {
        let mut entries = self.state.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut changed = false;
        for entry in entries.iter_mut() {
            if entry.notification.dedupe_key == dedupe_key {
                entry.seen = true;
                changed = true;
            }
        }
        if changed {
            self.save_locked(&entries)?;
        }
        Ok(())
    }

    pub fn mark_all_seen(&self) -> Result<()> {
        let mut entries = self.state.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut changed = false;
        for entry in entries.iter_mut() {
            if !entry.seen {
                entry.seen = true;
                changed = true;
            }
        }
        if changed {
            self.save_locked(&entries)?;
        }
        Ok(())
    }

    pub fn get_all(&self) -> Result<Vec<HistoryEntry>> {
        let entries = self.state.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut result: Vec<HistoryEntry> = entries.iter().cloned().collect();
        result.reverse();
        Ok(result)
    }

    pub fn save_locked(&self, entries: &VecDeque<HistoryEntry>) -> Result<()> {
        let file = HistoryFile {
            entries: entries.iter().cloned().collect(),
        };
        let data = serde_json::to_string_pretty(&file)
            .context("failed to serialize history")?;

        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create directory: {}", parent.display()))?;
        }

        std::fs::write(&self.path, data)
            .with_context(|| format!("failed to write history file: {}", self.path.display()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_notification(dedupe_key: &str) -> FailureNotification {
        FailureNotification {
            dedupe_key: dedupe_key.to_string(),
            trace_id: format!("trace-{dedupe_key}"),
            repo: "test/repo".to_string(),
            branch: "main".to_string(),
            workflow_name: "CI".to_string(),
            failed_at: "2025-01-01T00:00:00Z".to_string(),
            details_url: "https://example.com".to_string(),
            job_name: None,
            step_number: None,
            step_name: None,
        }
    }

    #[test]
    fn append_and_retrieve_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.json");
        let store = NotificationHistoryStore::load(path).unwrap();

        store.append(make_notification("a")).unwrap();
        store.append(make_notification("b")).unwrap();

        let entries = store.get_all().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].notification.dedupe_key, "b");
        assert_eq!(entries[1].notification.dedupe_key, "a");
    }

    #[test]
    fn mark_seen_updates_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.json");
        let store = NotificationHistoryStore::load(path).unwrap();

        store.append(make_notification("a")).unwrap();
        assert!(!store.get_all().unwrap()[0].seen);

        store.mark_seen("a").unwrap();
        assert!(store.get_all().unwrap()[0].seen);
    }

    #[test]
    fn mark_all_seen_updates_all_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.json");
        let store = NotificationHistoryStore::load(path).unwrap();

        store.append(make_notification("a")).unwrap();
        store.append(make_notification("b")).unwrap();

        store.mark_all_seen().unwrap();

        let entries = store.get_all().unwrap();
        assert!(entries.iter().all(|e| e.seen));
    }

    #[test]
    fn cap_at_max_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.json");
        let store = NotificationHistoryStore::load(path).unwrap();

        for i in 0..210 {
            store.append(make_notification(&format!("n-{i}"))).unwrap();
        }

        let entries = store.get_all().unwrap();
        assert_eq!(entries.len(), 200);
        // Newest should be n-209, oldest should be n-10
        assert_eq!(entries[0].notification.dedupe_key, "n-209");
        assert_eq!(entries[199].notification.dedupe_key, "n-10");
    }

    #[test]
    fn persists_across_loads() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.json");

        {
            let store = NotificationHistoryStore::load(path.clone()).unwrap();
            store.append(make_notification("persist-me")).unwrap();
        }

        let store = NotificationHistoryStore::load(path).unwrap();
        let entries = store.get_all().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].notification.dedupe_key, "persist-me");
    }
}
