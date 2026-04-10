# State Management Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the shared state file with atomic writes, file locking, and sub-second change propagation from CLI to desktop via a centralized `StateWatcher`.

**Architecture:** `AppStateStore` in `everr-core` gets atomic writes (temp + rename) and advisory file locking (`fs2`). A new `StateWatcher` in `everr-core` watches the state file via the `notify` crate, diffs against cached state, and broadcasts typed `StateChange` events over a `tokio::sync::broadcast` channel. The desktop app replaces its 30s poll loop and scattered `Notify` handles with a single broadcast subscriber.

**Tech Stack:** Rust, `fs2`, `notify`, `tokio::sync::broadcast`, Tauri

**Spec:** `docs/superpowers/specs/2026-04-10-state-management-hardening-design.md`

---

### Task 1: Add `fs2` dependency and implement atomic writes

**Files:**
- Modify: `crates/everr-core/Cargo.toml`
- Modify: `crates/everr-core/src/state.rs:133-153` (save_state)
- Test: `crates/everr-core/src/state.rs` (existing tests module)

- [ ] **Step 1: Add `fs2` to everr-core dependencies**

In `crates/everr-core/Cargo.toml`, add to `[dependencies]`:

```toml
fs2 = "0.4"
```

- [ ] **Step 2: Write a failing test for atomic write behavior**

In `crates/everr-core/src/state.rs`, add to the `tests` module:

```rust
#[test]
fn save_state_does_not_leave_tmp_file_on_success() {
    with_temp_config_home(|store| {
        let state = AppState {
            session: Some(Session {
                api_base_url: "https://app.example.com".to_string(),
                token: "token-123".to_string(),
            }),
            settings: AppSettings::default(),
        };

        store.save_state(&state).expect("save state");

        let tmp_path = store.session_file_path().expect("path").with_extension("tmp");
        assert!(!tmp_path.exists(), "tmp file should be cleaned up after atomic rename");
        assert_eq!(store.load_state().expect("load state"), state);
    });
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test -p everr-core save_state_does_not_leave_tmp_file`
Expected: PASS (the current `fs::write` doesn't create a `.tmp` file, so assertion passes vacuously — this test becomes meaningful after the implementation change, verifying the tmp file is renamed away)

- [ ] **Step 4: Implement atomic writes in `save_state`**

In `crates/everr-core/src/state.rs`, replace the `save_state` method body. Change:

```rust
let serialized =
    serde_json::to_string_pretty(state).context("failed to serialize app state")?;
fs::write(&path, serialized)
    .with_context(|| format!("failed to write {}", path.display()))?;
Ok(())
```

To:

```rust
let serialized =
    serde_json::to_string_pretty(state).context("failed to serialize app state")?;
let tmp = path.with_extension("tmp");
fs::write(&tmp, serialized)
    .with_context(|| format!("failed to write {}", tmp.display()))?;
fs::rename(&tmp, &path)
    .with_context(|| format!("failed to rename {} to {}", tmp.display(), path.display()))?;
Ok(())
```

- [ ] **Step 5: Run all state tests to verify nothing breaks**

Run: `cargo test -p everr-core`
Expected: All tests pass (existing round-trip tests validate the full save/load cycle still works)

- [ ] **Step 6: Commit**

```bash
git add crates/everr-core/Cargo.toml crates/everr-core/src/state.rs
git commit -m "feat: atomic writes for state file using temp + rename"
```

---

### Task 2: Add file locking to read-modify-write paths

**Files:**
- Modify: `crates/everr-core/src/state.rs` (add locking helpers, wrap update_state, clear_session, clear_mismatched_session, load_state)

- [ ] **Step 1: Write a test that validates locking is used**

In `crates/everr-core/src/state.rs`, add to the `tests` module:

```rust
#[test]
fn update_state_creates_lock_file() {
    with_temp_config_home(|store| {
        store
            .save_state(&AppState {
                session: None,
                settings: AppSettings::default(),
            })
            .expect("initial save");

        store
            .update_state(|state| {
                state.settings.completed_base_url = Some("https://app.example.com".to_string());
            })
            .expect("update state");

        let lock_path = store.session_file_path().expect("path").with_extension("lock");
        assert!(lock_path.exists(), "lock file should exist after update_state");

        let state = store.load_state().expect("load state");
        assert_eq!(
            state.settings.completed_base_url.as_deref(),
            Some("https://app.example.com")
        );
    });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p everr-core update_state_creates_lock_file`
Expected: FAIL — lock file does not exist yet

- [ ] **Step 3: Implement file locking helpers**

At the top of `crates/everr-core/src/state.rs`, add the `fs2` import:

```rust
use fs2::FileExt;
```

Add two private methods to `AppStateStore`:

```rust
fn lock_exclusive(&self) -> Result<fs::File> {
    let lock_path = self.session_file_path()?.with_extension("lock");
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let lock_file = fs::File::create(&lock_path)
        .with_context(|| format!("failed to create lock file {}", lock_path.display()))?;
    lock_file
        .lock_exclusive()
        .with_context(|| format!("failed to acquire exclusive lock on {}", lock_path.display()))?;
    Ok(lock_file)
}

fn lock_shared(&self) -> Result<fs::File> {
    let lock_path = self.session_file_path()?.with_extension("lock");
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let lock_file = fs::File::create(&lock_path)
        .with_context(|| format!("failed to create lock file {}", lock_path.display()))?;
    lock_file
        .lock_shared()
        .with_context(|| format!("failed to acquire shared lock on {}", lock_path.display()))?;
    Ok(lock_file)
}
```

- [ ] **Step 4: Wrap `update_state` with exclusive locking**

Replace the `update_state` method:

```rust
pub fn update_state<F, T>(&self, mutate: F) -> Result<T>
where
    F: FnOnce(&mut AppState) -> T,
{
    let _lock = self.lock_exclusive()?;
    let mut state = self.load_state_unlocked()?;
    let result = mutate(&mut state);
    self.save_state(&state)?;
    Ok(result)
}
```

- [ ] **Step 5: Rename `load_state` to `load_state_unlocked`, add locked `load_state`**

Rename the existing `load_state` to `load_state_unlocked` (private), and add a new public `load_state`:

```rust
pub fn load_state(&self) -> Result<AppState> {
    let _lock = self.lock_shared()?;
    self.load_state_unlocked()
}

fn load_state_unlocked(&self) -> Result<AppState> {
    let path = self.session_file_path()?;
    if !path.exists() {
        return Ok(AppState::default());
    }

    let raw = fs::read_to_string(&path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Ok(AppState::default());
    };
    let Some(object) = value.as_object() else {
        return Ok(AppState::default());
    };
    if object.len() != 2 || !object.contains_key("session") || !object.contains_key("settings")
    {
        return Ok(AppState::default());
    }

    match serde_json::from_value::<AppState>(value) {
        Ok(state) => Ok(state),
        Err(_) => Ok(AppState::default()),
    }
}
```

- [ ] **Step 6: Wrap `clear_session` and `clear_mismatched_session` with exclusive locking**

Replace `clear_session`:

```rust
pub fn clear_session(&self) -> Result<bool> {
    let _lock = self.lock_exclusive()?;
    let mut state = self.load_state_unlocked()?;
    if state.session.is_none() {
        return Ok(false);
    }

    state.session = None;
    self.save_state(&state)?;
    Ok(true)
}
```

Replace `clear_mismatched_session`:

```rust
pub fn clear_mismatched_session(&self, expected_api_base_url: &str) -> Result<bool> {
    let _lock = self.lock_exclusive()?;
    let mut state = self.load_state_unlocked()?;
    let Some(session) = &state.session else {
        return Ok(false);
    };

    if session_matches_api_base_url(&session.api_base_url, expected_api_base_url) {
        return Ok(false);
    }

    state.session = None;
    self.save_state(&state)?;
    Ok(true)
}
```

- [ ] **Step 7: Run all tests**

Run: `cargo test -p everr-core`
Expected: All tests pass

- [ ] **Step 8: Run desktop app tests too**

Run: `cargo test -p everr-app`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add crates/everr-core/src/state.rs
git commit -m "feat: advisory file locking for state read-modify-write paths"
```

---

### Task 3: Add `notify` and `tokio` dependencies, create `StateChange` enum

**Files:**
- Modify: `crates/everr-core/Cargo.toml`
- Create: `crates/everr-core/src/state_watcher.rs`
- Modify: `crates/everr-core/src/lib.rs`

- [ ] **Step 1: Add dependencies**

In `crates/everr-core/Cargo.toml`, add to `[dependencies]`:

```toml
notify = "8"
```

Update the existing `tokio` dependency to include `sync`:

```toml
tokio = { version = "1.44.2", features = ["time", "sync"] }
```

- [ ] **Step 2: Create `state_watcher.rs` with the `StateChange` enum**

Create `crates/everr-core/src/state_watcher.rs`:

```rust
use tokio::sync::broadcast;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StateChange {
    SessionChanged,
    SettingsChanged,
    EmailsChanged,
}

const BROADCAST_CAPACITY: usize = 16;

/// Creates a new broadcast channel for state change events.
/// Returns the sender (for the watcher) and a way to subscribe (clone the sender).
pub fn state_change_channel() -> broadcast::Sender<StateChange> {
    let (tx, _) = broadcast::channel(BROADCAST_CAPACITY);
    tx
}
```

- [ ] **Step 3: Register the module**

In `crates/everr-core/src/lib.rs`, add:

```rust
pub mod state_watcher;
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p everr-core`
Expected: Compiles with no errors

- [ ] **Step 5: Commit**

```bash
git add crates/everr-core/Cargo.toml crates/everr-core/src/state_watcher.rs crates/everr-core/src/lib.rs
git commit -m "feat: add StateChange enum and broadcast channel for state watching"
```

---

### Task 4: Implement `StateWatcher`

**Files:**
- Modify: `crates/everr-core/src/state_watcher.rs`

- [ ] **Step 1: Write failing tests for `StateWatcher` diff logic**

Add to `crates/everr-core/src/state_watcher.rs`:

```rust
#[cfg(test)]
mod tests {
    use crate::state::{AppSettings, AppState, Session, WizardState};
    use super::*;

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
```

- [ ] **Step 2: Run tests to see they pass (diff logic is in test helper for now)**

Run: `cargo test -p everr-core state_watcher`
Expected: All 4 tests pass

- [ ] **Step 3: Implement the `StateWatcher` struct**

Replace the contents of `crates/everr-core/src/state_watcher.rs` (keeping the tests module):

```rust
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
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p everr-core state_watcher`
Expected: All 4 tests pass

- [ ] **Step 5: Verify full crate compiles**

Run: `cargo check -p everr-core`
Expected: Compiles with no errors

- [ ] **Step 6: Commit**

```bash
git add crates/everr-core/src/state_watcher.rs
git commit -m "feat: implement StateWatcher with notify-based file watching and broadcast"
```

---

### Task 5: Integrate StateWatcher into desktop RuntimeState

**Files:**
- Modify: `packages/desktop-app/src-tauri/src/lib.rs`
- Modify: `packages/desktop-app/src-tauri/src/settings.rs`
- Modify: `packages/desktop-app/src-tauri/src/startup.rs`

- [ ] **Step 1: Update `RuntimeState` struct**

In `packages/desktop-app/src-tauri/src/lib.rs`, replace the imports:

```rust
use tokio::sync::Notify;
```

With:

```rust
use everr_core::state_watcher::StateWatcher;
```

Replace the `RuntimeState` struct:

```rust
#[derive(Clone)]
struct RuntimeState {
    store: AppStateStore,
    watcher: Arc<StateWatcher>,
    notifier: Arc<Mutex<NotifierState>>,
    tray: Arc<Mutex<TrayState>>,
    pending_auth: Arc<Mutex<Option<PendingAuthState>>>,
}
```

Note: `StateWatcher` is not `Clone`, so it's wrapped in `Arc`. `RuntimeState` still derives `Clone` because `Arc<StateWatcher>` is `Clone`.

- [ ] **Step 2: Update `RuntimeState` construction in `setup`**

In the `setup` closure in `lib.rs`, replace:

```rust
let runtime = RuntimeState {
    store,
    persisted: Arc::new(Mutex::new(persisted)),
    notifier: Arc::new(Mutex::new(NotifierState::default())),
    tray: Arc::new(Mutex::new(TrayState::default())),
    pending_auth: Arc::new(Mutex::new(None)),
    session_changed: Arc::new(Notify::new()),
    emails_changed: Arc::new(Notify::new()),
};
```

With:

```rust
let watcher = StateWatcher::start(store.clone())
    .expect("failed to start state watcher");
let runtime = RuntimeState {
    store,
    watcher: Arc::new(watcher),
    notifier: Arc::new(Mutex::new(NotifierState::default())),
    tray: Arc::new(Mutex::new(TrayState::default())),
    pending_auth: Arc::new(Mutex::new(None)),
};
```

Note: the `persisted` variable loaded earlier is no longer stored — `StateWatcher` loads initial state internally. The `apply_runtime_base_url` call still needs to happen. Move it before `StateWatcher::start`:

```rust
let _ = store.clear_mismatched_session(build::default_api_base_url())?;
// Apply runtime base URL adjustment directly on disk before the watcher starts
store.update_state(|state| {
    state.settings.apply_runtime_base_url(build::default_api_base_url());
})?;
```

- [ ] **Step 3: Replace `start_session_poll_loop` call with `start_state_change_loop`**

In the `setup` closure, replace:

```rust
start_session_poll_loop(app.handle().clone(), runtime);
```

With:

```rust
start_state_change_loop(app.handle().clone(), runtime);
```

Update the import line:

```rust
use startup::{run_local_startup_maintenance, start_state_change_loop, start_update_check_loop};
```

- [ ] **Step 4: Update `settings.rs` — replace `persisted` access with watcher**

In `packages/desktop-app/src-tauri/src/settings.rs`:

Replace `current_app_state`:

```rust
pub(crate) fn current_app_state(state: &RuntimeState) -> Result<AppState> {
    Ok(state.watcher.cached_state())
}
```

Replace `update_persisted_state` — write through the store, let the watcher handle notification:

```rust
pub(crate) fn update_persisted_state<F>(state: &RuntimeState, mutate: F) -> Result<()>
where
    F: FnOnce(&mut AppState),
{
    state.store.update_state(mutate)?;
    Ok(())
}
```

Replace `replace_persisted_state`:

```rust
pub(crate) fn replace_persisted_state(state: &RuntimeState, next: AppState) -> Result<()> {
    state.store.save_state(&next)?;
    Ok(())
}
```

Remove the `has_active_session_for_current_base_url` function body update — it already calls `current_app_state` which now reads from the watcher cache.

- [ ] **Step 5: Update `startup.rs` — replace poll loop with state change loop**

Replace the entire `start_session_poll_loop` function and `sync_persisted_state_from_disk` with:

```rust
pub(crate) fn start_state_change_loop(app: AppHandle, state: RuntimeState) {
    tauri::async_runtime::spawn(async move {
        let mut rx = state.watcher.subscribe();
        loop {
            match rx.recv().await {
                Ok(change) => {
                    handle_state_change(&app, &state, change);
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    crate::crash_log::log_error(
                        "state change loop",
                        &anyhow::anyhow!("lagged {n} events, re-syncing"),
                    );
                    // On lag, treat everything as changed
                    handle_state_change(&app, &state, StateChange::SessionChanged);
                    handle_state_change(&app, &state, StateChange::SettingsChanged);
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

fn handle_state_change(app: &AppHandle, state: &RuntimeState, change: StateChange) {
    match change {
        StateChange::SessionChanged => {
            if let Err(error) = reset_notification_state(app, state) {
                crate::crash_log::log_error("reset notification state", &error);
            }
            emit_auth_changed(app);
        }
        StateChange::SettingsChanged => {
            emit_settings_changed(app);
        }
        StateChange::EmailsChanged => {
            // Handled by notifier loop's own subscriber
        }
    }
}
```

Add the necessary imports at the top of `startup.rs`:

```rust
use everr_core::state_watcher::StateChange;
use tokio::sync::broadcast;
```

Remove the now-unused `PolledStateChanges` struct and `sync_persisted_state_from_disk` function.

- [ ] **Step 6: Verify it compiles**

Run: `cargo check -p everr-app`
Expected: Compiles (there will be some unused import warnings to clean up — handle those in the next step)

- [ ] **Step 7: Clean up unused imports across modified files**

Remove any dead imports flagged by the compiler (e.g., `tokio::sync::Notify` in `lib.rs`, `AppState` in `startup.rs`, etc.).

- [ ] **Step 8: Run tests**

Run: `cargo test -p everr-app`
Expected: Tests pass. Some tests that referenced `sync_persisted_state_from_disk` (in `tests.rs`) will need to be updated — see Task 7.

- [ ] **Step 9: Commit**

```bash
git add packages/desktop-app/src-tauri/src/lib.rs packages/desktop-app/src-tauri/src/settings.rs packages/desktop-app/src-tauri/src/startup.rs
git commit -m "feat: integrate StateWatcher into desktop RuntimeState, replace poll loop"
```

---

### Task 6: Update notifier SSE loop to use broadcast subscriber

**Files:**
- Modify: `packages/desktop-app/src-tauri/src/notifications.rs`

- [ ] **Step 1: Replace `Notify` awaits with broadcast receiver**

In `packages/desktop-app/src-tauri/src/notifications.rs`, update the `run_sse_notifier` function.

Add import at the top:

```rust
use everr_core::state_watcher::StateChange;
```

Replace the session check block that awaits `session_changed`:

```rust
let Some(session) = current_app_state(state)?.session else {
    reset_notification_state(app, state)?;
    wait_for_change(&mut rx, &[StateChange::SessionChanged]).await;
    return Ok(());
};
if session.api_base_url.trim_end_matches('/') != current_base_url().trim_end_matches('/') {
    reset_notification_state(app, state)?;
    wait_for_change(&mut rx, &[StateChange::SessionChanged]).await;
    return Ok(());
};
```

Replace the email fallback block:

```rust
// No emails configured and no profile cached — wait for session or filter changes.
reset_notification_state(app, state)?;
wait_for_change(&mut rx, &[StateChange::SessionChanged, StateChange::EmailsChanged]).await;
return Ok(());
```

Replace the `tokio::select!` in the SSE event loop:

```rust
tokio::select! {
    event = stream.next() => {
        // ... existing event handling unchanged ...
    }
    change = wait_for_change(&mut rx, &[StateChange::SessionChanged, StateChange::EmailsChanged]) => {
        dbg_notifier!("state changed ({:?}) — restarting SSE loop", change);
        break;
    }
}
```

Add the helper function:

```rust
async fn wait_for_change(
    rx: &mut tokio::sync::broadcast::Receiver<StateChange>,
    filter: &[StateChange],
) -> StateChange {
    loop {
        match rx.recv().await {
            Ok(change) if filter.contains(&change) => return change,
            Ok(_) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                // Channel closed — sleep forever (app is shutting down)
                std::future::pending::<()>().await;
                unreachable!();
            }
        }
    }
}
```

- [ ] **Step 2: Update `run_sse_notifier` signature to accept a broadcast receiver**

Change the function to create its own subscriber from the watcher:

```rust
async fn run_sse_notifier(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    let mut rx = state.watcher.subscribe();
    // ... rest of function uses rx ...
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check -p everr-app`
Expected: Compiles with no errors

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/src-tauri/src/notifications.rs
git commit -m "feat: notifier SSE loop subscribes to StateWatcher broadcast"
```

---

### Task 7: Update desktop app tests

**Files:**
- Modify: `packages/desktop-app/src-tauri/src/tests.rs`

- [ ] **Step 1: Remove `sync_persisted_state_from_disk` test**

In `packages/desktop-app/src-tauri/src/tests.rs`, remove the import:

```rust
use crate::startup::sync_persisted_state_from_disk;
```

And remove the test `disk_sync_detects_wizard_only_settings_changes` (the function it tested no longer exists — the equivalent logic now lives in `StateWatcher::diff_changes` which is tested in `everr-core`).

- [ ] **Step 2: Verify tests compile and pass**

Run: `cargo test -p everr-app`
Expected: All remaining tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/desktop-app/src-tauri/src/tests.rs
git commit -m "test: remove poll-loop test replaced by StateWatcher diff tests"
```

---

### Task 8: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run all everr-core tests**

Run: `cargo test -p everr-core`
Expected: All tests pass

- [ ] **Step 2: Run all desktop app tests**

Run: `cargo test -p everr-app`
Expected: All tests pass

- [ ] **Step 3: Run CLI tests**

Run: `cargo test -p everr-cli`
Expected: All tests pass (CLI behavior unchanged, just benefits from atomic writes and locking)

- [ ] **Step 4: Build the desktop app in dev mode**

Run: `cargo build -p everr-app`
Expected: Build succeeds

- [ ] **Step 5: Verify no compiler warnings**

Run: `cargo build -p everr-core -p everr-app -p everr-cli 2>&1 | grep warning`
Expected: No warnings related to our changes
