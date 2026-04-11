# State Management Hardening

Harden the shared state file (`~/.config/everr/session.json`) used by both the CLI and desktop app. Three concerns: write safety, cross-process coordination, and sub-second change propagation from CLI to desktop.

## Current state

A single JSON file is the shared source of truth. The CLI reads fresh from disk on every invocation. The desktop app caches state in `Arc<Mutex<AppState>>` and polls every 30 seconds. Both sides write with plain `fs::write`. There is no file locking and no filesystem event watching.

### Problems

1. **Non-atomic writes** — `fs::write` can leave a truncated file on crash. The loader silently returns `AppState::default()` for any parse failure, so session + settings are lost without error.
2. **Read-modify-write race** — `update_state` does load-mutate-save with no cross-process coordination. The desktop's in-memory mutex doesn't protect against the CLI writing simultaneously. A CLI login during a desktop settings save can clobber the session token.
3. **30-second stale window** — after CLI login, the desktop can show stale auth state for up to 30 seconds.
4. **Scattered reaction logic** — state change reactions are wired ad-hoc across `startup.rs`, `notifications.rs`, and `settings.rs` using per-concern `tokio::sync::Notify` handles.

## Design

### 1. Atomic writes

`AppStateStore::save_state` writes to a temp file in the same directory, then renames atomically:

```rust
let tmp = path.with_extension("tmp");
fs::write(&tmp, serialized)?;
fs::rename(&tmp, &path)?;
```

Same-directory rename is atomic on macOS and Linux. If the process dies mid-write, the temp file is left behind but the real state file stays intact.

### 2. File locking

All read-modify-write paths in `AppStateStore` (`update_state`, `clear_session`, `save_session`, `clear_mismatched_session`) acquire an exclusive advisory lock before touching the file:

```rust
let lock_path = self.session_file_path()?.with_extension("lock");
let lock_file = fs::File::create(&lock_path)?;
lock_file.lock_exclusive()?;

let mut state = self.load_state()?;
let result = mutate(&mut state);
self.save_state(&state)?;

lock_file.unlock()?;
Ok(result)
```

Read-only paths (`load_state`) acquire a shared lock, so concurrent reads don't block each other but wait for any in-progress write.

Uses `fs2::FileExt` for cross-platform `flock`/`LockFileEx`.

### 3. StateWatcher

A new struct in `everr-core` that owns filesystem watching and a typed broadcast channel.

#### Change event

```rust
pub enum StateChange {
    SessionChanged,
    SettingsChanged,
    EmailsChanged,
}
```

A single file modification can emit multiple events (e.g., CLI login that also sets profile data emits both `SessionChanged` and `SettingsChanged`).

#### Struct

```rust
pub struct StateWatcher {
    store: AppStateStore,
    cached: Mutex<AppState>,
    tx: broadcast::Sender<StateChange>,
    _watcher: notify::RecommendedWatcher,
}
```

On construction:
- Reads current state from disk into `cached`
- Starts a `notify::RecommendedWatcher` on the state file's parent directory (watching a single file directly is flaky on some platforms — watching the parent and filtering by filename is the standard pattern)

On filesystem event matching the state filename:
- Loads from disk (with shared file lock)
- Diffs against `cached`
- Updates `cached`
- Sends appropriate `StateChange` variants through the broadcast channel

Debounce: ~50ms window to collapse duplicate events from `notify` (especially on macOS FSEvents).

Broadcast channel capacity: 16. This is generous for the event rate (state changes are infrequent). If a slow subscriber lags past 16 unread events, it gets `RecvError::Lagged` and re-syncs on next recv.

#### Consumer API

```rust
let mut rx = state_watcher.subscribe();
loop {
    match rx.recv().await {
        Ok(StateChange::SessionChanged) => { /* ... */ }
        Ok(StateChange::SettingsChanged) => { /* ... */ }
        Ok(StateChange::EmailsChanged) => { /* ... */ }
        Err(broadcast::error::RecvError::Lagged(_)) => continue,
    }
}
```

### 4. Desktop app integration

#### RuntimeState simplification

```rust
struct RuntimeState {
    store: AppStateStore,
    watcher: Arc<StateWatcher>,
    notifier: Arc<Mutex<NotifierState>>,
    tray: Arc<Mutex<TrayState>>,
    pending_auth: Arc<Mutex<Option<PendingAuthState>>>,
}
```

`persisted: Arc<Mutex<AppState>>` moves inside `StateWatcher.cached`. The `session_changed` and `emails_changed` `Notify` handles are replaced by the broadcast channel.

#### Poll loop removed

`start_session_poll_loop` is deleted. Replaced by `start_state_change_loop` which subscribes to `watcher.subscribe()` and dispatches:

- `SessionChanged` → reset notification state, update tray, emit `AUTH_CHANGED_EVENT` to UI
- `SettingsChanged` → emit `SETTINGS_CHANGED_EVENT` to UI
- `EmailsChanged` → consumed by notifier SSE loop directly

#### settings.rs

`update_persisted_state` and `replace_persisted_state` write through `AppStateStore` (now with file locking). After the write, the `notify` watcher fires, `StateWatcher` diffs and broadcasts. No more manual `session_changed.notify_one()` calls — the watcher handles it uniformly whether the change came from this process or the CLI.

#### notifications.rs

The SSE loop replaces `session_changed.notified()` / `emails_changed.notified()` with its own `watcher.subscribe()` receiver, filtering for `SessionChanged` and `EmailsChanged`.

When the desktop app writes a state change (e.g., sign-out), the `notify` watcher fires and broadcasts the event back to the same process. This is intentional — all reactions go through one code path regardless of who triggered the change.

## What stays the same

- **CLI** — no behavioral changes. Reads fresh from disk per invocation, now protected by shared file locks and atomic writes. Never instantiates a `StateWatcher`.
- **`AppState`, `Session`, `AppSettings` structs** — unchanged.
- **`AppStateStore` public API** — same methods, hardened internals.
- **Desktop Tauri commands** (`commands.rs`) — same signatures and behavior.
- **Frontend** — no changes. Same `AUTH_CHANGED_EVENT` / `SETTINGS_CHANGED_EVENT` Tauri events.

## New dependencies

| Crate | Where | Purpose |
|-------|-------|---------|
| `fs2` | `everr-core` | Advisory file locking |
| `notify` | `everr-core` | Filesystem event watching (FSEvents/inotify) |
| `tokio` `sync` feature | `everr-core` | `broadcast::channel` for typed change events |

## Key files affected

| File | Change |
|------|--------|
| `crates/everr-core/src/state.rs` | Atomic writes, file locking in all write paths |
| `crates/everr-core/src/state_watcher.rs` | New: `StateWatcher`, `StateChange` |
| `crates/everr-core/Cargo.toml` | Add `fs2`, `notify`, `tokio` sync feature |
| `packages/desktop-app/src-tauri/src/lib.rs` | `RuntimeState` simplified |
| `packages/desktop-app/src-tauri/src/startup.rs` | Remove poll loop, add `start_state_change_loop` |
| `packages/desktop-app/src-tauri/src/settings.rs` | Remove manual `Notify` calls, read cached state from watcher |
| `packages/desktop-app/src-tauri/src/notifications.rs` | Subscribe to broadcast instead of `Notify` handles |
