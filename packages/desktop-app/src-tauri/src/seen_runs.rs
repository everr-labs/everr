use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

const EXPIRY_SECONDS: i64 = 3600; // 1 hour

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeenEntry {
    trace_id: String,
    added_at: String,        // ISO 8601 — when notification was shown
    seen_at: Option<String>, // ISO 8601 — when user interacted, None = unread
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeenRunsFile {
    entries: Vec<SeenEntry>,
}

pub(crate) struct SeenRunsStore {
    path: PathBuf,
    entries: Mutex<Vec<SeenEntry>>,
}

fn is_expired(entry: &SeenEntry) -> bool {
    let Ok(added_at) = OffsetDateTime::parse(&entry.added_at, &Rfc3339) else {
        return true;
    };
    let now = OffsetDateTime::now_utc();
    (now - added_at).whole_seconds() >= EXPIRY_SECONDS
}

fn prune(entries: Vec<SeenEntry>) -> Vec<SeenEntry> {
    entries.into_iter().filter(|e| !is_expired(e)).collect()
}

impl SeenRunsStore {
    pub fn load(path: PathBuf) -> Result<Self> {
        let entries = if path.exists() {
            let data = std::fs::read_to_string(&path)
                .with_context(|| format!("failed to read seen-runs file: {}", path.display()))?;
            let file: SeenRunsFile = serde_json::from_str(&data)
                .with_context(|| "failed to parse seen-runs file")?;
            prune(file.entries)
        } else {
            Vec::new()
        };

        Ok(Self {
            path,
            entries: Mutex::new(entries),
        })
    }

    pub fn add(&self, trace_id: &str) -> Result<()> {
        let mut entries = self.entries.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        if entries.iter().any(|e| e.trace_id == trace_id) {
            return Ok(());
        }
        let now = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .context("failed to format timestamp")?;
        entries.push(SeenEntry {
            trace_id: trace_id.to_string(),
            added_at: now,
            seen_at: None,
        });
        self.save(&entries)
    }

    pub fn mark_seen(&self, trace_id: &str) -> Result<()> {
        let mut entries = self.entries.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let now = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .context("failed to format timestamp")?;
        let mut changed = false;
        for entry in entries.iter_mut() {
            if entry.trace_id == trace_id && entry.seen_at.is_none() {
                entry.seen_at = Some(now.clone());
                changed = true;
            }
        }
        if changed {
            self.save(&entries)?;
        }
        Ok(())
    }

    pub fn mark_all_seen(&self) -> Result<()> {
        let mut entries = self.entries.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let now = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .context("failed to format timestamp")?;
        let mut changed = false;
        for entry in entries.iter_mut() {
            if entry.seen_at.is_none() {
                entry.seen_at = Some(now.clone());
                changed = true;
            }
        }
        if changed {
            self.save(&entries)?;
        }
        Ok(())
    }

    pub fn unseen_trace_ids(&self) -> Result<Vec<String>> {
        let entries = self.entries.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let ids = entries
            .iter()
            .filter(|e| e.seen_at.is_none() && !is_expired(e))
            .map(|e| e.trace_id.clone())
            .collect();
        Ok(ids)
    }

    fn save(&self, entries: &[SeenEntry]) -> Result<()> {
        let pruned: Vec<SeenEntry> = entries.iter().filter(|e| !is_expired(e)).cloned().collect();
        let file = SeenRunsFile { entries: pruned };
        let data = serde_json::to_string_pretty(&file).context("failed to serialize seen-runs")?;

        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create directory: {}", parent.display()))?;
        }

        std::fs::write(&self.path, data)
            .with_context(|| format!("failed to write seen-runs file: {}", self.path.display()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_and_retrieve_unseen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seen-runs.json");
        let store = SeenRunsStore::load(path).unwrap();

        store.add("trace-a").unwrap();
        store.add("trace-b").unwrap();

        let ids = store.unseen_trace_ids().unwrap();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"trace-a".to_string()));
        assert!(ids.contains(&"trace-b".to_string()));
    }

    #[test]
    fn add_skips_duplicate() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seen-runs.json");
        let store = SeenRunsStore::load(path).unwrap();

        store.add("trace-a").unwrap();
        store.add("trace-a").unwrap();

        let ids = store.unseen_trace_ids().unwrap();
        assert_eq!(ids.len(), 1);
    }

    #[test]
    fn mark_seen_removes_from_unseen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seen-runs.json");
        let store = SeenRunsStore::load(path).unwrap();

        store.add("trace-a").unwrap();
        store.add("trace-b").unwrap();
        store.mark_seen("trace-a").unwrap();

        let ids = store.unseen_trace_ids().unwrap();
        assert_eq!(ids, vec!["trace-b".to_string()]);
    }

    #[test]
    fn mark_all_seen_clears_unseen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seen-runs.json");
        let store = SeenRunsStore::load(path).unwrap();

        store.add("trace-a").unwrap();
        store.add("trace-b").unwrap();
        store.mark_all_seen().unwrap();

        let ids = store.unseen_trace_ids().unwrap();
        assert!(ids.is_empty());
    }

    #[test]
    fn persists_across_loads() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seen-runs.json");

        {
            let store = SeenRunsStore::load(path.clone()).unwrap();
            store.add("trace-persist").unwrap();
        }

        let store = SeenRunsStore::load(path).unwrap();
        let ids = store.unseen_trace_ids().unwrap();
        assert_eq!(ids, vec!["trace-persist".to_string()]);
    }

    #[test]
    fn expired_entries_pruned_on_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seen-runs.json");

        // Write a file with an already-expired entry manually
        let expired_entry = SeenEntry {
            trace_id: "expired".to_string(),
            added_at: "2000-01-01T00:00:00Z".to_string(),
            seen_at: None,
        };
        let file = SeenRunsFile {
            entries: vec![expired_entry],
        };
        std::fs::write(&path, serde_json::to_string(&file).unwrap()).unwrap();

        let store = SeenRunsStore::load(path).unwrap();
        let ids = store.unseen_trace_ids().unwrap();
        assert!(ids.is_empty());
    }
}
