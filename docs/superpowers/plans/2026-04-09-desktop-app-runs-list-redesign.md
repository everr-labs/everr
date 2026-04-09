# Desktop App Runs List Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local notification history with an API-driven runs list, simplify the tray to Open/Settings/Quit, and add email validation in settings.

**Architecture:** The server gets a new `authorEmail` filter on `GET /api/cli/runs`. The desktop app calls it via the existing `ApiClient`. A new `SeenRunsStore` (persisted JSON, 1h expiry) tracks unread state from shown notifications. The tray is stripped to three static items.

**Tech Stack:** Rust (Tauri), TypeScript (React + TanStack Query), PostgreSQL (server-side)

**Spec:** `docs/superpowers/specs/2026-04-09-desktop-app-runs-list-redesign.md`

---

### Task 1: Add `authorEmail` filter to the server runs endpoint

**Files:**
- Modify: `packages/app/src/routes/api/cli/runs.ts`
- Modify: `packages/app/src/data/runs-list/server.ts`
- Modify: `packages/app/src/data/runs-list/schemas.ts`

- [ ] **Step 1: Add `authorEmail` to `RunsListInputSchema`**

In `packages/app/src/data/runs-list/schemas.ts`, add the field:

```typescript
export const RunsListInputSchema = z.object({
  timeRange: TimeRangeSchema,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  repos: z.array(z.string()).optional(),
  branches: z.array(z.string()).optional(),
  conclusions: z
    .array(z.enum(["success", "failure", "cancellation"]))
    .optional(),
  workflowNames: z.array(z.string()).optional(),
  runId: z.string().optional(),
  authorEmail: z.string().optional(),
});
```

- [ ] **Step 2: Add SQL clause in `getRunsList`**

In `packages/app/src/data/runs-list/server.ts`, inside the `handler` after the `runId` clause (after line 61):

```typescript
    if (data.authorEmail) {
      params.push(data.authorEmail);
      clauses.push(`author_email = $${params.length}`);
    }
```

- [ ] **Step 3: Wire the query param in the API route**

In `packages/app/src/routes/api/cli/runs.ts`, add `authorEmail` to the schema (line 17):

```typescript
const RunsListQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    repo: z.string().optional(),
    branch: z.string().optional(),
    conclusion: z.enum(["success", "failure", "cancellation"]).optional(),
    workflowName: z.string().optional(),
    runId: z.string().optional(),
    authorEmail: z.string().optional(),
  })
  .strict();
```

And pass it through in the handler (inside the `getRunsList` call, after line 59):

```typescript
        const result = await getRunsList({
          data: {
            timeRange,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
            repos: parsed.data.repo ? [parsed.data.repo] : undefined,
            branches: parsed.data.branch ? [parsed.data.branch] : undefined,
            conclusions: parsed.data.conclusion
              ? [parsed.data.conclusion]
              : undefined,
            workflowNames: parsed.data.workflowName
              ? [parsed.data.workflowName]
              : undefined,
            runId: parsed.data.runId,
            authorEmail: parsed.data.authorEmail,
          },
        });
```

Also add it to the filters response object:

```typescript
          filters: {
            ...existing filters,
            authorEmail: parsed.data.authorEmail ?? undefined,
          },
```

- [ ] **Step 4: Verify build**

Run: `cd packages/app && npx tsc --noEmit`
Expected: Clean compilation

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes/api/cli/runs.ts packages/app/src/data/runs-list/server.ts packages/app/src/data/runs-list/schemas.ts
git commit -m "feat(api): add authorEmail filter to runs list endpoint"
```

---

### Task 2: Create `SeenRunsStore` in Rust

**Files:**
- Create: `packages/desktop-app/src-tauri/src/seen_runs.rs`

- [ ] **Step 1: Create the seen runs store**

Create `packages/desktop-app/src-tauri/src/seen_runs.rs`:

```rust
use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

const EXPIRY_HOURS: i64 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeenEntry {
    trace_id: String,
    added_at: String,
    seen_at: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SeenRunsFile {
    entries: Vec<SeenEntry>,
}

#[derive(Debug)]
pub(crate) struct SeenRunsStore {
    path: PathBuf,
    entries: Mutex<Vec<SeenEntry>>,
}

impl SeenRunsStore {
    pub fn load(path: PathBuf) -> Result<Self> {
        let entries = if path.exists() {
            let data = std::fs::read_to_string(&path)
                .with_context(|| format!("failed to read {}", path.display()))?;
            let file: SeenRunsFile =
                serde_json::from_str(&data).unwrap_or_else(|_| SeenRunsFile::default());
            prune_expired(file.entries)
        } else {
            Vec::new()
        };

        Ok(Self {
            path,
            entries: Mutex::new(entries),
        })
    }

    /// Record that a notification was shown for this traceId (unread).
    pub fn add(&self, trace_id: &str) -> Result<()> {
        let mut entries = self.entries.lock().map_err(|_| anyhow::anyhow!("lock"))?;
        if entries.iter().any(|e| e.trace_id == trace_id) {
            return Ok(());
        }
        let now = OffsetDateTime::now_utc().format(&Rfc3339).unwrap();
        entries.push(SeenEntry {
            trace_id: trace_id.to_string(),
            added_at: now,
            seen_at: None,
        });
        self.save(&entries)
    }

    /// Mark a specific traceId as read.
    pub fn mark_seen(&self, trace_id: &str) -> Result<()> {
        let mut entries = self.entries.lock().map_err(|_| anyhow::anyhow!("lock"))?;
        let now = OffsetDateTime::now_utc().format(&Rfc3339).unwrap();
        if let Some(entry) = entries.iter_mut().find(|e| e.trace_id == trace_id) {
            entry.seen_at = Some(now);
        }
        self.save(&entries)
    }

    /// Mark all current entries as read.
    pub fn mark_all_seen(&self) -> Result<()> {
        let mut entries = self.entries.lock().map_err(|_| anyhow::anyhow!("lock"))?;
        let now = OffsetDateTime::now_utc().format(&Rfc3339).unwrap();
        for entry in entries.iter_mut() {
            if entry.seen_at.is_none() {
                entry.seen_at = Some(now.clone());
            }
        }
        self.save(&entries)
    }

    /// Returns traceIds that are unseen (notification shown but not interacted with).
    pub fn unseen_trace_ids(&self) -> Result<Vec<String>> {
        let entries = self.entries.lock().map_err(|_| anyhow::anyhow!("lock"))?;
        let now = OffsetDateTime::now_utc();
        Ok(entries
            .iter()
            .filter(|e| e.seen_at.is_none() && !is_expired(e, now))
            .map(|e| e.trace_id.clone())
            .collect())
    }

    fn save(&self, entries: &[SeenEntry]) -> Result<()> {
        let pruned = prune_expired(entries.to_vec());
        let file = SeenRunsFile { entries: pruned };
        let json = serde_json::to_string_pretty(&file)
            .context("failed to serialize seen runs")?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(&self.path, json)
            .with_context(|| format!("failed to write {}", self.path.display()))
    }
}

fn is_expired(entry: &SeenEntry, now: OffsetDateTime) -> bool {
    let cutoff = now - time::Duration::hours(EXPIRY_HOURS);
    OffsetDateTime::parse(&entry.added_at, &Rfc3339)
        .map(|t| t < cutoff)
        .unwrap_or(true)
}

fn prune_expired(entries: Vec<SeenEntry>) -> Vec<SeenEntry> {
    let now = OffsetDateTime::now_utc();
    entries.into_iter().filter(|e| !is_expired(e, now)).collect()
}
```

- [ ] **Step 2: Register the module**

In `packages/desktop-app/src-tauri/src/lib.rs`, add `mod seen_runs;` next to the other module declarations. Find the existing `mod` block and add it there.

- [ ] **Step 3: Verify build**

Run: `cd packages/desktop-app/src-tauri && cargo check`
Expected: Clean compilation

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/src-tauri/src/seen_runs.rs packages/desktop-app/src-tauri/src/lib.rs
git commit -m "feat(desktop-app): add SeenRunsStore for notification read tracking"
```

---

### Task 3: Wire `SeenRunsStore` into `RuntimeState` and notifications

**Files:**
- Modify: `packages/desktop-app/src-tauri/src/lib.rs`
- Modify: `packages/desktop-app/src-tauri/src/notifications.rs`

- [ ] **Step 1: Add `seen_runs` to `RuntimeState`**

In `packages/desktop-app/src-tauri/src/lib.rs`, update the `RuntimeState` struct. Replace the `history` field:

```rust
#[derive(Clone)]
struct RuntimeState {
    store: AppStateStore,
    persisted: Arc<Mutex<AppState>>,
    notifier: Arc<Mutex<NotifierState>>,
    tray: Arc<Mutex<TrayState>>,
    pending_auth: Arc<Mutex<Option<PendingAuthState>>>,
    session_changed: Arc<Notify>,
    emails_changed: Arc<Notify>,
    seen_runs: Arc<seen_runs::SeenRunsStore>,
}
```

- [ ] **Step 2: Update initialization in `setup()`**

In the `setup` closure in `lib.rs`, replace the history loading (lines ~303-310) with:

```rust
            let seen_runs_path = {
                let session_path = store.session_file_path()?;
                session_path
                    .parent()
                    .expect("session file has parent")
                    .join("seen-runs.json")
            };
            let seen_runs = Arc::new(seen_runs::SeenRunsStore::load(seen_runs_path)?);
```

And update the `RuntimeState` initialization to use `seen_runs` instead of `history`:

```rust
            let runtime = RuntimeState {
                store,
                persisted: Arc::new(Mutex::new(persisted)),
                notifier: Arc::new(Mutex::new(NotifierState::default())),
                tray: Arc::new(Mutex::new(TrayState::default())),
                pending_auth: Arc::new(Mutex::new(None)),
                session_changed: Arc::new(Notify::new()),
                emails_changed: Arc::new(Notify::new()),
                seen_runs,
            };
```

- [ ] **Step 3: Add `SEEN_RUNS_CHANGED_EVENT` constant**

In `lib.rs`, add near the other event constants:

```rust
const SEEN_RUNS_CHANGED_EVENT: &str = "everr://seen-runs-changed";
```

- [ ] **Step 4: Remove `NOTIFICATION_HISTORY_CHANGED_EVENT`**

Remove the constant `NOTIFICATION_HISTORY_CHANGED_EVENT` from `lib.rs`.

- [ ] **Step 5: Update `notifications.rs` — replace history calls with seen_runs**

In `packages/desktop-app/src-tauri/src/notifications.rs`:

Update imports: remove `NOTIFICATION_HISTORY_CHANGED_EVENT`, add `SEEN_RUNS_CHANGED_EVENT`.

In `enqueue_notification()` (lines ~302-322), replace the history append with seen_runs add:

```rust
fn enqueue_notification(
    app: &AppHandle,
    state: &RuntimeState,
    notification: FailureNotification,
) -> Result<()> {
    state.seen_runs.add(&notification.trace_id)?;
    let _ = app.emit(SEEN_RUNS_CHANGED_EVENT, ());

    let active_changed = {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.queue.enqueue(notification)
    };

    if active_changed {
        sync_notification_window(app, state)?;
    }

    Ok(())
}
```

In `dismiss_active_notification_inner()` (lines ~325-355), replace `history.mark_seen` with `seen_runs.mark_seen` using the trace_id:

```rust
pub(crate) fn dismiss_active_notification_inner(
    app: &AppHandle,
    state: &RuntimeState,
) -> Result<()> {
    let dismissed_trace_id = {
        let notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.queue.active().map(|n| n.trace_id.clone())
    };

    if let Some(trace_id) = &dismissed_trace_id {
        let _ = state.seen_runs.mark_seen(trace_id);
        let _ = app.emit(SEEN_RUNS_CHANGED_EVENT, ());
    }

    let active_changed = {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.queue.advance()
    };

    if active_changed {
        sync_notification_window(app, state)?;
    }

    Ok(())
}
```

Also update `open_notification_target_inner` — it already calls `dismiss_active_notification_inner`, so it will mark seen via that call. No changes needed there.

And `copy_notification_auto_fix_prompt_inner` — this should also mark as seen. Find this function and add after the clipboard copy:

```rust
    if let Some(trace_id) = trace_id {
        let _ = state.seen_runs.mark_seen(&trace_id);
    }
```

You'll need to capture the trace_id from the active notification before copying. Read the existing function to see how it accesses the queue.

- [ ] **Step 6: Verify build**

Run: `cd packages/desktop-app/src-tauri && cargo check`
Expected: Clean compilation (may have warnings about unused history imports — that's fine, we remove them in the next task)

- [ ] **Step 7: Commit**

```bash
git add packages/desktop-app/src-tauri/src/lib.rs packages/desktop-app/src-tauri/src/notifications.rs
git commit -m "feat(desktop-app): wire SeenRunsStore into RuntimeState and notifications"
```

---

### Task 4: Add runs list and seen runs Tauri commands

**Files:**
- Modify: `packages/desktop-app/src-tauri/src/commands.rs`
- Modify: `packages/desktop-app/src-tauri/src/lib.rs` (invoke_handler)

- [ ] **Step 1: Add `RunListItem` struct for deserialization**

At the top of `commands.rs`, add a struct to deserialize the API response:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunListItem {
    pub trace_id: String,
    pub run_id: String,
    pub run_attempt: u32,
    pub workflow_name: String,
    pub repo: String,
    pub branch: String,
    pub conclusion: String,
    pub duration: u64,
    pub timestamp: String,
    pub sender: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunsListApiResponse {
    runs: Vec<RunListItem>,
    total_count: u64,
}
```

- [ ] **Step 2: Add `get_runs_list` command**

```rust
#[tauri::command]
pub(crate) async fn get_runs_list(
    state: State<'_, RuntimeState>,
) -> CommandResult<Vec<RunListItem>> {
    let state = state.inner().clone();
    let (client, emails) = run_blocking_command({
        let state = state.clone();
        move || {
            let app_state = current_app_state(&state)?;
            let session = app_state
                .session
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("not signed in"))?;
            let client = everr_core::api::ApiClient::from_session(session)?;
            let emails = app_state.settings.notification_emails.clone();
            Ok((client, emails))
        }
    })
    .await?;

    let mut all_runs: Vec<RunListItem> = Vec::new();
    for email in &emails {
        let query = vec![
            ("from", "now-24h".to_string()),
            ("to", "now".to_string()),
            ("limit", "50".to_string()),
            ("authorEmail", email.clone()),
        ];
        let response: serde_json::Value = client
            .get_runs_list(&query)
            .await
            .map_err(|e| e.to_string())?;
        if let Ok(parsed) = serde_json::from_value::<RunsListApiResponse>(response) {
            all_runs.extend(parsed.runs);
        }
    }

    // Deduplicate by traceId (in case multiple emails match the same run)
    all_runs.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    all_runs.dedup_by(|a, b| a.trace_id == b.trace_id);

    Ok(all_runs)
}
```

- [ ] **Step 3: Add seen runs commands**

```rust
#[tauri::command]
pub(crate) fn get_unseen_trace_ids(
    state: State<'_, RuntimeState>,
) -> CommandResult<Vec<String>> {
    state.seen_runs.unseen_trace_ids().into_command_result()
}

#[tauri::command]
pub(crate) fn mark_run_seen(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    trace_id: String,
) -> CommandResult<()> {
    state.seen_runs.mark_seen(&trace_id).into_command_result()?;
    let _ = app.emit(SEEN_RUNS_CHANGED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub(crate) fn mark_all_runs_seen(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<()> {
    state.seen_runs.mark_all_seen().into_command_result()?;
    let _ = app.emit(SEEN_RUNS_CHANGED_EVENT, ());
    Ok(())
}
```

- [ ] **Step 4: Remove old history commands**

Remove these functions from `commands.rs`:
- `get_notification_history`
- `copy_history_auto_fix_prompt`
- `open_history_notification`
- `mark_all_notifications_read`

Also remove the import of `HistoryEntry` from crate::history.

- [ ] **Step 5: Update `trigger_test_notification`**

Replace the `state.history.append` call with `state.seen_runs.add`:

```rust
#[tauri::command]
pub(crate) fn trigger_test_notification(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<TestNotificationResponse> {
    let notification = build_test_notification().into_command_result()?;

    let _ = state.seen_runs.add(&notification.trace_id);
    let _ = app.emit(SEEN_RUNS_CHANGED_EVENT, ());

    let shown = {
        let mut notifier = state
            .notifier
            .lock()
            .map_err(|_| "failed to lock notifier state".to_string())?;
        notifier.queue.enqueue(notification)
    };

    if shown {
        sync_notification_window(&app, state.inner()).into_command_result()?;
    }

    Ok(TestNotificationResponse {
        status: if shown { "shown" } else { "queued" },
    })
}
```

- [ ] **Step 6: Update invoke_handler in `lib.rs`**

Replace the old history commands with the new ones in the `invoke_handler` macro:

```rust
        .invoke_handler(tauri::generate_handler![
            get_auth_status,
            get_assistant_setup,
            get_wizard_status,
            get_active_notification,
            start_sign_in,
            get_pending_sign_in,
            poll_sign_in,
            open_sign_in_browser,
            sign_out,
            reset_dev_onboarding,
            configure_assistants,
            complete_setup_wizard,
            dismiss_active_notification,
            open_notification_target,
            copy_notification_auto_fix_prompt,
            trigger_test_notification,
            get_notification_emails,
            set_notification_emails,
            get_user_profile,
            get_runs_list,
            get_unseen_trace_ids,
            mark_run_seen,
            mark_all_runs_seen
        ])
```

- [ ] **Step 7: Update imports in `commands.rs`**

Remove `NOTIFICATION_HISTORY_CHANGED_EVENT` from the crate import, add `SEEN_RUNS_CHANGED_EVENT`. Remove `use crate::history::HistoryEntry`. Add `use serde::Deserialize` if not already present.

- [ ] **Step 8: Verify build**

Run: `cd packages/desktop-app/src-tauri && cargo check`
Expected: Clean compilation

- [ ] **Step 9: Commit**

```bash
git add packages/desktop-app/src-tauri/src/commands.rs packages/desktop-app/src-tauri/src/lib.rs
git commit -m "feat(desktop-app): add runs list and seen runs Tauri commands"
```

---

### Task 5: Simplify the tray menu

**Files:**
- Rewrite: `packages/desktop-app/src-tauri/src/tray.rs`
- Modify: `packages/desktop-app/src-tauri/src/lib.rs`
- Modify: `packages/desktop-app/src-tauri/src/notifications.rs`

- [ ] **Step 1: Rewrite `tray.rs`**

Replace the entire file with:

```rust
use anyhow::{Context, Result};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;

use crate::settings::open_settings_window;
use crate::{current_app_name, QUIT_MENU_ID, SETTINGS_MENU_ID, TRAY_ICON_ID};

const OPEN_MENU_ID: &str = "open";

pub(crate) fn build_tray(app: &AppHandle) -> Result<()> {
    let open = MenuItem::with_id(app, OPEN_MENU_ID, "Open", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let settings = MenuItem::with_id(app, SETTINGS_MENU_ID, "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &separator, &settings, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .menu(&menu)
        .tooltip(current_app_name());
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
        #[cfg(target_os = "macos")]
        {
            if !tauri::is_dev() {
                builder = builder.icon_as_template(true);
            }
        }
    }

    builder
        .on_menu_event(move |app, event| match event.id().as_ref() {
            OPEN_MENU_ID => {
                let _ = open_main_window(app);
            }
            SETTINGS_MENU_ID => {
                let _ = open_settings_window(app);
            }
            QUIT_MENU_ID => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn open_main_window(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().context("failed to show main window")?;
        window
            .set_focus()
            .context("failed to focus main window")?;
    } else {
        open_settings_window(app)?;
    }
    Ok(())
}
```

- [ ] **Step 2: Remove tray-related structs and constants from `lib.rs`**

Remove from `lib.rs`:
- Constants: `TRAY_MENU_FAILED_STATUS_ID`, `TRAY_MENU_OPEN_FAILED_RUNS_ID`, `TRAY_MENU_COPY_AUTO_FIX_PROMPT_ID`, `TRAY_MENU_DEV_ID`, `TRAY_MENU_INSERTION_INDEX`, `TRAY_FAILURES_WINDOW_MINUTES`
- Structs: `TraySnapshot` (and its `impl`), `TrayState` (and its `impl`), `TrayMenu`, `TrayMenuModel`
- Remove the `tray` field from `RuntimeState`
- Remove the `tray: Arc<Mutex<TrayState>>` initialization from `setup()`
- Remove the `tray_menu` variable and the block that sets `tray.menu = Some(tray_menu)`
- Remove the `sync_tray_ui` call from setup
- Update `build_tray` call — it now returns `Result<()>` instead of `Result<TrayMenu>`:
  ```rust
  build_tray(app.handle())?;
  ```

Also add `use tauri::Manager;` to tray.rs imports if `get_webview_window` needs it.

- [ ] **Step 3: Remove tray snapshot calls from `notifications.rs`**

Remove from `notifications.rs`:
- All calls to `update_tray_snapshot()`, `clear_tray_snapshot()`, `build_tray_snapshot()`
- The `expire_old_failures()` function
- The `known_failures` HashMap and its usage in `run_sse_notifier()` / `handle_notify_event()`
- The `TRAY_FAILURES_WINDOW_MINUTES` import
- All tray-related imports from `crate::tray`

The `handle_notify_event` function should be simplified to only enqueue fresh failure notifications. Remove the known_failures tracking entirely — the notifier just needs to check if a failure event is new (via `FailureTracker`) and enqueue it.

Remove the `known_failures` parameter from `handle_notify_event` and from the loop in `run_sse_notifier`.

- [ ] **Step 4: Remove `use crate::tray::clear_tray_snapshot` from `commands.rs`**

This import is no longer needed.

- [ ] **Step 5: Delete `history.rs`**

Delete `packages/desktop-app/src-tauri/src/history.rs` and remove `mod history;` from `lib.rs`.

- [ ] **Step 6: Verify build**

Run: `cd packages/desktop-app/src-tauri && cargo check`
Expected: Clean compilation

- [ ] **Step 7: Commit**

```bash
git add -A packages/desktop-app/src-tauri/src/
git commit -m "refactor(desktop-app): simplify tray to Open/Settings/Quit, remove history store"
```

---

### Task 6: Update frontend — events and Tauri commands

**Files:**
- Modify: `packages/desktop-app/src/lib/tauri.ts`

- [ ] **Step 1: Update events and remove old ones**

In `packages/desktop-app/src/lib/tauri.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const AUTH_CHANGED_EVENT = "everr://auth-changed";
export const SETTINGS_CHANGED_EVENT = "everr://settings-changed";
export const NOTIFICATION_CHANGED_EVENT = "everr://notification-changed";
export const NOTIFICATION_HOVER_EVENT = "everr://notification-hover";
export const NOTIFICATION_EXIT_EVENT = "everr://notification-exit";
export const SEEN_RUNS_CHANGED_EVENT = "everr://seen-runs-changed";
export const NOTIFICATION_WINDOW_LABEL = "notification";

// ... rest unchanged
```

Remove `NOTIFICATION_HISTORY_CHANGED_EVENT`.

- [ ] **Step 2: Commit**

```bash
git add packages/desktop-app/src/lib/tauri.ts
git commit -m "refactor(desktop-app): update frontend event constants"
```

---

### Task 7: Rewrite the notifications page (runs list)

**Files:**
- Rewrite: `packages/desktop-app/src/features/notifications/notifications-page.tsx`

- [ ] **Step 1: Rewrite the page**

Replace the entire file with:

```typescript
import { Button } from "@everr/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clipboard, ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import { invokeCommand, SEEN_RUNS_CHANGED_EVENT } from "@/lib/tauri";
import { useInvalidateOnTauriEvent } from "@/lib/tauri-events";
import { formatNotificationRelativeTime } from "../../notification-time";

type RunListItem = {
  traceId: string;
  runId: string;
  runAttempt: number;
  workflowName: string;
  repo: string;
  branch: string;
  conclusion: string;
  duration: number;
  timestamp: string;
  sender: string;
};

const runsListQueryKey = ["desktop-app", "runs-list"] as const;
const unseenQueryKey = ["desktop-app", "unseen-trace-ids"] as const;

function getRunsList() {
  return invokeCommand<RunListItem[]>("get_runs_list");
}

function getUnseenTraceIds() {
  return invokeCommand<string[]>("get_unseen_trace_ids");
}

function markRunSeen(traceId: string) {
  return invokeCommand<void>("mark_run_seen", { traceId });
}

function markAllRunsSeen() {
  return invokeCommand<void>("mark_all_runs_seen");
}

function copyRunAutoFixPrompt(traceId: string) {
  return invokeCommand<void>("copy_notification_auto_fix_prompt");
}

export function NotificationsPage() {
  useInvalidateOnTauriEvent(SEEN_RUNS_CHANGED_EVENT, (queryClient) => {
    void queryClient.invalidateQueries({ queryKey: unseenQueryKey });
  });

  const runsQuery = useQuery({
    queryKey: runsListQueryKey,
    queryFn: getRunsList,
    refetchOnWindowFocus: true,
  });

  const unseenQuery = useQuery({
    queryKey: unseenQueryKey,
    queryFn: getUnseenTraceIds,
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllRunsSeen,
  });

  const runs = runsQuery.data ?? [];
  const unseenSet = new Set(unseenQuery.data ?? []);
  const hasUnread = unseenSet.size > 0;

  return (
    <div className="pt-8">
      <div className="flex items-start justify-between gap-4 px-5 pb-4">
        <div className="grid gap-1.5">
          <h1 className="m-0 text-[clamp(1.4rem,3vw,1.8rem)] font-medium leading-none tracking-[-0.04em]">
            Runs
          </h1>
          <p className="m-0 max-w-[52ch] text-[0.92rem] leading-6 text-[var(--settings-text-muted)]">
            Recent CI pipeline runs.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {hasUnread && (
            <Button
              variant="outline"
              size="sm"
              disabled={markAllReadMutation.isPending}
              onClick={() => void markAllReadMutation.mutateAsync()}
            >
              Mark all as read
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={runsQuery.isFetching}
            onClick={() => void runsQuery.refetch()}
          >
            {runsQuery.isFetching ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      {runsQuery.isPending ? (
        <div className="px-5 py-4">
          <p className="m-0 text-sm text-[var(--settings-text-muted)]">
            Loading runs...
          </p>
        </div>
      ) : runsQuery.isError ? (
        <div className="px-5 py-12 text-center">
          <p className="m-0 text-sm text-[var(--settings-text-muted)]">
            Failed to load runs. Check your connection and try again.
          </p>
        </div>
      ) : runs.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="m-0 text-sm text-[var(--settings-text-muted)]">
            No runs found. CI pipeline runs will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[0.78rem]">
            <thead>
              <tr className="border-b border-white/[0.06] text-[0.7rem] font-medium uppercase tracking-wider text-[var(--settings-text-muted)]">
                <th className="w-8 py-2 pl-5 pr-1 font-medium" />
                <th className="py-2 px-2 font-medium">Workflow</th>
                <th className="py-2 px-2 font-medium">Repository</th>
                <th className="py-2 px-2 font-medium">Branch</th>
                <th className="py-2 px-2 font-medium">Result</th>
                <th className="py-2 px-2 font-medium">When</th>
                <th className="w-16 py-2 pl-2 pr-5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <RunRow
                  key={run.traceId}
                  run={run}
                  unseen={unseenSet.has(run.traceId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const conclusionStyles: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-400",
  failure: "bg-red-500/15 text-red-400",
  cancellation: "bg-yellow-500/15 text-yellow-400",
};

function RunRow({ run, unseen }: { run: RunListItem; unseen: boolean }) {
  const relativeTime = formatNotificationRelativeTime(run.timestamp);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const queryClient = useQueryClient();

  const markSeenMutation = useMutation({
    mutationFn: () => markRunSeen(run.traceId),
  });

  const openMutation = useMutation({
    mutationFn: async () => {
      await invokeCommand<void>("open_notification_target");
      if (unseen) void markSeenMutation.mutateAsync();
    },
  });

  const style = conclusionStyles[run.conclusion] ?? "bg-white/[0.06] text-[var(--settings-text-muted)]";

  return (
    <tr className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.03]">
      <td className="py-2 pl-5 pr-1">
        {unseen ? (
          <span className="block size-2 rounded-full bg-red-500" />
        ) : (
          <span className="block size-2" />
        )}
      </td>
      <td className="py-2 px-2 font-medium text-[var(--settings-text)]">
        {run.workflowName}
      </td>
      <td className="py-2 px-2 text-[var(--settings-text-muted)]">
        {run.repo}
      </td>
      <td className="py-2 px-2">
        <span className="inline-block rounded bg-white/[0.06] px-1.5 py-0.5 text-[0.72rem] text-[var(--settings-text-muted)]">
          {run.branch}
        </span>
      </td>
      <td className="py-2 px-2">
        <span className={`inline-block rounded px-1.5 py-0.5 text-[0.72rem] font-medium ${style}`}>
          {run.conclusion}
        </span>
      </td>
      <td className="py-2 px-2 text-[var(--settings-text-muted)]">
        {relativeTime}
      </td>
      <td className="py-2 pl-2 pr-5">
        <TooltipProvider>
          <div className="flex items-center gap-1">
            {run.conclusion === "failure" && (
              <CopyPromptButton traceId={run.traceId} unseen={unseen} />
            )}
            <Tooltip>
              <TooltipTrigger
                className="flex size-7 cursor-pointer items-center justify-center rounded text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.08] hover:text-[var(--settings-text)] disabled:pointer-events-none disabled:opacity-50"
                onClick={() => {
                  void invokeCommand("open_history_notification", {
                    dedupeKey: run.traceId,
                  }).catch(() => {
                    // Fallback: open via trace ID URL pattern
                  });
                }}
              >
                <ExternalLink className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top">Open in browser</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </td>
    </tr>
  );
}

function CopyPromptButton({
  traceId,
  unseen,
}: {
  traceId: string;
  unseen: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copyMutation = useMutation({
    mutationFn: async () => {
      // TODO: This needs a new command that works with traceId instead of dedupeKey
      await invokeCommand<void>("copy_history_auto_fix_prompt", {
        dedupeKey: traceId,
      });
      if (unseen) await markRunSeen(traceId);
    },
    onSuccess() {
      clearTimeout(copyTimerRef.current);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    },
  });

  return (
    <Tooltip>
      <TooltipTrigger
        className="flex size-7 cursor-pointer items-center justify-center rounded text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.08] hover:text-[var(--settings-text)] disabled:pointer-events-none disabled:opacity-50"
        disabled={copyMutation.isPending}
        onClick={() => void copyMutation.mutateAsync()}
      >
        <span className="relative grid size-3.5 place-items-center">
          <Clipboard
            className={`col-start-1 row-start-1 size-3.5 transition-all duration-200 ${copied ? "scale-0 opacity-0" : "scale-100 opacity-100"}`}
          />
          <Check
            className={`col-start-1 row-start-1 size-3.5 text-emerald-400 transition-all duration-200 ${copied ? "scale-100 opacity-100" : "scale-0 opacity-0"}`}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {copied ? "Copied!" : "Copy auto-fix prompt"}
      </TooltipContent>
    </Tooltip>
  );
}
```

**Note:** The copy/open commands reference old history commands that were removed. These will need new Tauri commands that work with traceId. This is addressed in the next step.

- [ ] **Step 2: Add `open_run_in_browser` and `copy_run_auto_fix_prompt` Tauri commands**

In `packages/desktop-app/src-tauri/src/commands.rs`, add:

```rust
#[tauri::command]
pub(crate) async fn open_run_in_browser(
    state: State<'_, RuntimeState>,
    trace_id: String,
) -> CommandResult<()> {
    let state = state.inner().clone();
    let url = run_blocking_command({
        let state = state.clone();
        let trace_id = trace_id.clone();
        move || {
            let app_state = current_app_state(&state)?;
            let base_url = app_state
                .settings
                .completed_base_url
                .as_deref()
                .unwrap_or(everr_core::build::default_api_base_url());
            Ok(format!("{}/trace/{}", base_url.trim_end_matches('/'), trace_id))
        }
    })
    .await?;

    webbrowser::open(&url).map_err(|e| format!("failed to open browser: {e}"))?;

    let _ = state.seen_runs.mark_seen(&trace_id);
    Ok(())
}

#[tauri::command]
pub(crate) async fn copy_run_auto_fix_prompt(
    state: State<'_, RuntimeState>,
    trace_id: String,
) -> CommandResult<()> {
    let state = state.inner().clone();
    let notification = run_blocking_command({
        let state = state.clone();
        let trace_id = trace_id.clone();
        move || {
            let app_state = current_app_state(&state)?;
            let session = app_state
                .session
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("not signed in"))?;
            Ok((everr_core::api::ApiClient::from_session(session)?, trace_id))
        }
    })
    .await?;

    let (client, trace_id) = notification;
    let notification = client
        .get_notification_for_trace(&trace_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "run not found".to_string())?;

    let prompt = build_notification_auto_fix_prompt(&notification);
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("failed to access clipboard: {e}"))?;
    clipboard
        .set_text(prompt)
        .map_err(|e| format!("failed to copy to clipboard: {e}"))?;

    let _ = state.seen_runs.mark_seen(&trace_id);
    Ok(())
}
```

Register these in the `invoke_handler` in `lib.rs`:

```rust
            open_run_in_browser,
            copy_run_auto_fix_prompt
```

- [ ] **Step 3: Update the frontend to use the new commands**

In `notifications-page.tsx`, update the `RunRow` and `CopyPromptButton` to use the correct commands:

Replace the open button onClick:
```typescript
onClick={() => void invokeCommand("open_run_in_browser", { traceId: run.traceId })}
```

Replace the copy mutation:
```typescript
    mutationFn: async () => {
      await invokeCommand<void>("copy_run_auto_fix_prompt", { traceId });
      if (unseen) await markRunSeen(traceId);
    },
```

Remove the unused `copyRunAutoFixPrompt` function near the top of the file.

- [ ] **Step 4: Update sidebar unread badge**

In `packages/desktop-app/src/features/desktop-shell/app-shell.tsx`, update `NotificationsLink` to use `SEEN_RUNS_CHANGED_EVENT` and `get_unseen_trace_ids` instead of the old history query:

```typescript
function NotificationsLink() {
  useInvalidateOnTauriEvent(
    SEEN_RUNS_CHANGED_EVENT,
    (queryClient) => {
      void queryClient.invalidateQueries({
        queryKey: ["desktop-app", "unseen-trace-ids"],
      });
    },
  );

  const unseenQuery = useQuery({
    queryKey: ["desktop-app", "unseen-trace-ids"] as const,
    queryFn: () => invokeCommand<string[]>("get_unseen_trace_ids"),
  });

  const unreadCount = unseenQuery.data?.length ?? 0;

  return (
    <Link
      to="/"
      aria-label="Runs"
      className="relative flex size-9 items-center justify-center rounded-md text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--settings-text)] [&.active]:bg-white/[0.08] [&.active]:text-[var(--settings-text)]"
    >
      <Bell className="size-[18px]" />
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[0.6rem] font-semibold leading-none text-primary-foreground">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
```

Update the imports at the top of `app-shell.tsx`: replace `NOTIFICATION_HISTORY_CHANGED_EVENT` with `SEEN_RUNS_CHANGED_EVENT`.

- [ ] **Step 5: Verify build**

Run: `cd packages/desktop-app && npx tsc --noEmit` and `cd packages/desktop-app/src-tauri && cargo check`
Expected: Both pass

- [ ] **Step 6: Commit**

```bash
git add packages/desktop-app/src/features/notifications/notifications-page.tsx packages/desktop-app/src/features/desktop-shell/app-shell.tsx packages/desktop-app/src-tauri/src/commands.rs packages/desktop-app/src-tauri/src/lib.rs
git commit -m "feat(desktop-app): rewrite notifications page as API-driven runs list"
```

---

### Task 8: Settings — email validation and copy removal

**Files:**
- Modify: `packages/desktop-app/src/features/notifications/notification-emails-section.tsx`

- [ ] **Step 1: Add email validation and remove description copy**

```typescript
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
```

Add inside `NotificationEmailsSection`, alongside the `newEmail` state:

```typescript
  const [emailError, setEmailError] = useState("");
```

Update `addEmail()`:

```typescript
  function addEmail() {
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    if (!EMAIL_REGEX.test(trimmed)) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    if (emails.includes(trimmed)) {
      setEmailError("This email is already added.");
      return;
    }
    setEmailError("");
    mutation.mutate([...emails, trimmed]);
    setNewEmail("");
  }
```

Clear the error when typing:

```typescript
  onChange={(e) => {
    setNewEmail(e.target.value);
    if (emailError) setEmailError("");
  }}
```

Add error display below the input `<div>`:

```typescript
      {emailError && (
        <p className="m-0 text-[0.78rem] text-red-400">{emailError}</p>
      )}
```

Remove the description prop from all three `<SettingsSection>` instances. Change them from:
```typescript
description="Emails used to match CI events to you. Matched locally — never sent to our servers."
```
to:
```typescript
description="Emails used to match CI events to you."
```

- [ ] **Step 2: Verify build**

Run: `cd packages/desktop-app && npx tsc --noEmit`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add packages/desktop-app/src/features/notifications/notification-emails-section.tsx
git commit -m "feat(desktop-app): add email validation and update settings copy"
```

---

### Task 9: Cleanup — remove dead code and unused imports

**Files:**
- Various files across `packages/desktop-app/src-tauri/src/`
- `packages/desktop-app/src/features/notifications/notification-window.tsx`

- [ ] **Step 1: Remove `auto_fix_prompt` tray-related code**

Check if `packages/desktop-app/src-tauri/src/auto_fix_prompt.rs` has a `build_tray_auto_fix_prompt` function. If so and it's no longer called anywhere, remove it.

- [ ] **Step 2: Clean unused imports**

Run `cargo check` and fix any unused import warnings across the crate. Common ones:
- `crate::tray::clear_tray_snapshot` in `commands.rs`
- `NOTIFICATION_HISTORY_CHANGED_EVENT` in various files
- `TRAY_FAILURES_WINDOW_MINUTES` in `notifications.rs`

- [ ] **Step 3: Remove unused frontend imports**

Check `notification-window.tsx` — the `FailureNotification` type export is used by the notification popup, so keep it. But remove any `NOTIFICATION_HISTORY_CHANGED_EVENT` references in the frontend.

- [ ] **Step 4: Remove `notificationHistoryQueryKey` from `app-shell.tsx`**

The old query key constant is no longer needed.

- [ ] **Step 5: Verify full build**

Run both:
```bash
cd packages/desktop-app/src-tauri && cargo check
cd packages/desktop-app && npx tsc --noEmit
```

Run the app to smoke test:
```bash
cd packages/desktop-app && pnpm tauri dev
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(desktop-app): remove dead code and unused imports"
```
