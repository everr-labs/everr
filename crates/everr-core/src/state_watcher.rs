use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::broadcast;

use crate::state::{AppState, AppStateStore};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StateChange {
    SessionChanged,
    SettingsChanged,
    EmailsChanged,
}

const BROADCAST_CAPACITY: usize = 16;
const DEBOUNCE_MS: u64 = 50;

pub struct StateWatcher {
    store: AppStateStore,
    cached: Arc<Mutex<AppState>>,
    tx: broadcast::Sender<StateChange>,
    _watcher: RecommendedWatcher,
}

impl StateWatcher {
    pub fn start(store: AppStateStore) -> Result<Self> {
        let initial_state = store.load_state()?;
        let tx = state_change_channel();
        let cached = Arc::new(Mutex::new(initial_state));

        let state_file_path = store.session_file_path()?;
        let state_file_name = state_file_path
            .file_name()
            .context("state file has no filename")?
            .to_os_string();

        let watch_dir = state_file_path
            .parent()
            .context("state file has no parent directory")?
            .to_path_buf();

        // Create the watch directory if it doesn't exist yet (first launch)
        std::fs::create_dir_all(&watch_dir)
            .with_context(|| format!("failed to create {}", watch_dir.display()))?;

        let debounce_tx = tx.clone();
        let debounce_store = store.clone();
        let debounce_cached = cached.clone();

        // Channel from notify callback to debounce thread
        let (notify_tx, notify_rx) = std::sync::mpsc::channel::<()>();

        // Spawn a debounce thread that processes filesystem events
        std::thread::spawn(move || {
            while notify_rx.recv().is_ok() {
                // Drain any additional events that arrived during debounce window
                std::thread::sleep(Duration::from_millis(DEBOUNCE_MS));
                while notify_rx.try_recv().is_ok() {}

                // Diff and broadcast
                let Ok(file_state) = debounce_store.load_state() else {
                    continue;
                };

                let Ok(mut cached) = debounce_cached.lock() else {
                    continue;
                };

                let changes = diff_changes(&cached, &file_state);
                if !changes.is_empty() {
                    *cached = file_state;
                    for change in changes {
                        let _ = debounce_tx.send(change);
                    }
                }
            }
        });

        let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            let Ok(event) = event else {
                return;
            };

            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                    let matches_state_file = event.paths.iter().any(|p| {
                        p.file_name()
                            .map(|name| name == state_file_name)
                            .unwrap_or(false)
                    });
                    if matches_state_file {
                        let _ = notify_tx.send(());
                    }
                }
                _ => {}
            }
        })
        .context("failed to create filesystem watcher")?;

        watcher
            .watch(&watch_dir, RecursiveMode::NonRecursive)
            .with_context(|| format!("failed to watch {}", watch_dir.display()))?;

        Ok(Self {
            store,
            cached,
            tx,
            _watcher: watcher,
        })
    }

    /// Subscribe to state change events.
    pub fn subscribe(&self) -> broadcast::Receiver<StateChange> {
        self.tx.subscribe()
    }

    /// Read the current cached state.
    pub fn cached_state(&self) -> AppState {
        self.cached
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }

    /// Access the underlying store for writes.
    pub fn store(&self) -> &AppStateStore {
        &self.store
    }
}

fn state_change_channel() -> broadcast::Sender<StateChange> {
    let (tx, _) = broadcast::channel(BROADCAST_CAPACITY);
    tx
}

fn diff_changes(old: &AppState, new: &AppState) -> Vec<StateChange> {
    let mut changes = Vec::new();
    if old.session != new.session {
        changes.push(StateChange::SessionChanged);
    }
    if old.settings != new.settings {
        changes.push(StateChange::SettingsChanged);
    }
    if old.settings.notification_emails != new.settings.notification_emails {
        changes.push(StateChange::EmailsChanged);
    }
    changes
}

#[cfg(test)]
mod tests {
    use crate::state::{AppSettings, AppState, Session, WizardState};
    use super::*;

    #[test]
    fn diff_detects_session_change() {
        let old = AppState::default();
        let new = AppState {
            session: Some(Session {
                api_base_url: "https://app.example.com".to_string(),
                token: "token-123".to_string(),
            }),
            settings: AppSettings::default(),
        };

        let changes = diff_changes(&old, &new);
        assert_eq!(changes, vec![StateChange::SessionChanged]);
    }

    #[test]
    fn diff_detects_settings_and_emails_change() {
        let old = AppState::default();
        let new = AppState {
            session: None,
            settings: AppSettings {
                notification_emails: vec!["user@example.com".to_string()],
                ..AppSettings::default()
            },
        };

        let changes = diff_changes(&old, &new);
        assert_eq!(
            changes,
            vec![StateChange::SettingsChanged, StateChange::EmailsChanged]
        );
    }

    #[test]
    fn diff_detects_settings_only_without_email_change() {
        let old = AppState::default();
        let new = AppState {
            session: None,
            settings: AppSettings {
                completed_base_url: Some("https://app.example.com".to_string()),
                wizard_state: WizardState {
                    wizard_completed: true,
                },
                ..AppSettings::default()
            },
        };

        let changes = diff_changes(&old, &new);
        assert_eq!(changes, vec![StateChange::SettingsChanged]);
    }

    #[test]
    fn diff_returns_empty_when_no_changes() {
        let state = AppState::default();
        let changes = diff_changes(&state, &state);
        assert!(changes.is_empty());
    }
}
