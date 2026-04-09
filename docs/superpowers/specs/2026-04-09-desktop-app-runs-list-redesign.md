# Desktop App Redesign: Tray, Runs List, Settings

## Overview

Replace the local notification history with an API-driven runs list, simplify the tray menu, and add email validation in settings.

## 1. Tray Menu

### Current
- Dynamic failure count label
- Conditional "Open failed runs" / "Copy auto-fix prompt" items
- Settings, Quit
- `TraySnapshot`, `TrayMenuModel` supporting structs

### New
Three static items:
- **Open** — opens/focuses the main window
- **Settings** — opens settings window
- **Quit** — exits the app

### Removals
- `TraySnapshot` struct and all snapshot-related logic (`build_tray_snapshot`, `update_tray_snapshot`, `clear_tray_snapshot`, `sync_tray_ui`, `sync_tray_menu`)
- `TrayMenuModel` struct
- `tray_auto_fix_prompt` function
- `open_tray_failed_runs` function
- Constants: `TRAY_MENU_FAILED_STATUS_ID`, `TRAY_MENU_OPEN_FAILED_RUNS_ID`, `TRAY_MENU_COPY_AUTO_FIX_PROMPT_ID`, `TRAY_MENU_DEV_ID`, `TRAY_MENU_INSERTION_INDEX`, `TRAY_FAILURES_WINDOW_MINUTES`
- The `TrayMenu` struct simplifies — no need to hold references to dynamic items
- Remove tray snapshot calls from `notifications.rs`

## 2. Runs List (API-driven)

### Data Source
Call the existing `/api/cli/runs` endpoint filtered by the user's configured emails via a new `authorEmail` query parameter.

### Server Changes

**New query parameter on `GET /api/cli/runs`:**
- `authorEmail` (string, optional) — filters `workflow_runs` by `author_email` column

**Implementation in `packages/app/src/routes/api/cli/runs.ts`:**
- Add `authorEmail: z.string().optional()` to `RunsListQuerySchema`
- Pass it through to `getRunsList`

**Implementation in `packages/app/src/data/runs-list/server.ts`:**
- Add `authorEmail` to `RunsListInputSchema`
- Add SQL clause: `author_email = $N` when provided

### Desktop App — Rust Backend

**New Tauri command: `get_runs_list`**
- Uses `ApiClient::get_runs_list` with the user's configured emails
- Calls the API with `authorEmail` filter for each configured email (or combines them)
- Returns a `Vec<RunListItem>` matching the existing `RunListItem` schema from the server
- Deserializes the API JSON response into Rust structs

**New Tauri command: `open_run_details`**
- Takes a `traceId`, builds the dashboard URL, opens in browser

**New Tauri command: `copy_run_auto_fix_prompt`**
- Takes a `traceId`, fetches notification details from the runs data, builds and copies prompt

### Desktop App — Frontend

**Replace `notifications-page.tsx`:**
- Query `get_runs_list` instead of `get_notification_history`
- Display the same columns: workflow name, repo, branch, conclusion, timestamp
- Add conclusion badge (success/failure/cancellation)
- Keep "Copy auto-fix prompt" and "Open" action buttons per row
- Unread dot based on `SeenRunsStore` (see below)
- Refresh on window focus or manual refresh button

### Cleanup
- Remove `NotificationHistoryStore` (`history.rs`)
- Remove `get_notification_history`, `copy_history_auto_fix_prompt`, `open_history_notification`, `mark_all_notifications_read` Tauri commands
- Remove `NOTIFICATION_HISTORY_CHANGED_EVENT`
- Remove `history` field from `RuntimeState`

## 3. Unread Tracking — SeenRunsStore

A lightweight local store that tracks which notification traceIds the user has seen.

### Data Structure
```rust
struct SeenEntry {
    trace_id: String,
    added_at: String,      // ISO 8601 — when the notification was shown
    seen_at: Option<String>, // ISO 8601 — when the user interacted, None = unread
}
```

Persisted as `seen-runs.json` alongside `session.json`.

### Lifecycle
1. **Notification shown** → `add(traceId)` with `seen_at: None`
2. **User interacts** (dismiss, open, copy prompt) → `mark_seen(traceId)` sets `seen_at` to now
3. **Expiration** → entries older than 1 hour (from `added_at`) are pruned on load and on periodic checks
4. **Persistence** → written to disk on every mutation

### API for Frontend
- **Tauri command `get_unseen_trace_ids`** → returns `Vec<String>` of traceIds where `seen_at` is `None` and not expired
- **Tauri command `mark_run_seen`** → marks a specific traceId as seen
- **Tauri command `mark_all_runs_seen`** → marks all current entries as seen
- **Event `SEEN_RUNS_CHANGED_EVENT`** → emitted on mutations so frontend can refresh

### Frontend Integration
- The runs list page queries both `get_runs_list` and `get_unseen_trace_ids`
- A run shows an unread dot if its `traceId` appears in the unseen set
- "Mark all as read" button calls `mark_all_runs_seen`
- Clicking a run's action buttons calls `mark_run_seen` for that traceId

### Notification Popup Integration
- When `show_notification_window` fires, call `seen_runs.add(trace_id)`
- When `dismiss_active_notification`, `open_notification_target`, or `copy_notification_auto_fix_prompt` fires, call `seen_runs.mark_seen(trace_id)`
- This replaces the current `history.mark_seen` calls

## 4. Settings Changes

### Email Validation
Add client-side email format validation in `notification-emails-section.tsx`:
- Validate against a basic email regex before adding to the list
- Show inline error message when format is invalid
- Prevent saving invalid emails

### Copy Removal
Remove the description text "Emails used to match CI events to you. Matched locally — never sent to our servers." from the `SettingsSection` in all three states (loading, error, normal).

## 5. File Impact Summary

| File | Action |
|------|--------|
| `src-tauri/src/tray.rs` | Rewrite — strip to Open/Settings/Quit |
| `src-tauri/src/lib.rs` | Remove tray constants, add seen-runs state, remove history |
| `src-tauri/src/notifications.rs` | Remove tray snapshot calls, add seen-runs integration |
| `src-tauri/src/history.rs` | Delete |
| `src-tauri/src/commands.rs` | Remove history commands, add runs list + seen-runs commands |
| `src-tauri/src/seen_runs.rs` | New — SeenRunsStore implementation |
| `src/features/notifications/notifications-page.tsx` | Rewrite — API-driven runs list |
| `src/features/notifications/notification-emails-section.tsx` | Add email validation, remove copy |
| `src/lib/tauri.ts` | Update events/commands |
| `packages/app/src/routes/api/cli/runs.ts` | Add authorEmail param |
| `packages/app/src/data/runs-list/server.ts` | Add authorEmail filter |
| `packages/app/src/data/runs-list/schemas.ts` | Add authorEmail to schema |
