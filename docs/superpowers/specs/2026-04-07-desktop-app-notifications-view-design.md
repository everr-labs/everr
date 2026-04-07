# Desktop App: Multi-View Shell with Notifications List

## Overview

Transform the desktop app from a single settings window into a multi-view application with sidebar navigation. The notifications list becomes the default home view, showing a persistent history of CI failure notifications. Settings becomes a secondary route.

## Architecture

### App Shell & Routing

**Router**: TanStack Router with two routes:
- `/` — Notifications list (default/home)
- `/settings` — Current settings screen

**App Shell layout** (post-wizard):
- Left sidebar (~48-56px wide, icon-only) with bell icon (notifications) and gear icon (settings), with an active state indicator on the current route
- Right content area renders the matched route
- Titlebar drag region stays at the top spanning full width; sidebar sits below it

**Window label routing preserved**: The floating `NotificationWindow` still uses the window-label check in `App.tsx`. The router only applies to the main window.

**Wizard flow**: When wizard is incomplete, the router/sidebar are not shown — the wizard takes over the full window as today. Once complete, the shell with sidebar + router renders.

### Notification History — Data & Persistence

**Rust-side changes:**
- Add `notification_history: Vec<FailureNotification>` to the persisted `AppState`
- When a notification is enqueued (`NotificationQueue::enqueue()`), also append it to history
- Add a `seen` field to distinguish pending vs dismissed notifications in history
- When a notification is dismissed, mark it as seen in history
- Cap history at 200 entries, dropping oldest when exceeded
- New Tauri command: `get_notification_history` — returns full history, newest first

**Events:**
- Emit `NOTIFICATION_CHANGED_EVENT` (already exists) when history updates, so the frontend can invalidate the query

**No changes to existing queue mechanics** — the queue continues to drive the floating notification window. History is a parallel append-only log.

### Notifications List — Frontend

**Route component**: `NotificationsPage` at `/`

**Layout:**
- Header with title "Notifications" and optional "Mark all as read" action
- Scrollable list of notification items, newest first
- Each item shows: workflow name, repo, branch, job/step (if present), relative timestamp
- Unseen notifications get a visual indicator (dot or subtle background highlight)
- Clicking an item opens the `details_url` in the browser
- Empty state when no notifications exist

**Data fetching:**
- `useQuery` with `get_notification_history` command
- Invalidated on `NOTIFICATION_CHANGED_EVENT` via existing `useInvalidateOnTauriEvent` hook
- No pagination — full capped history (up to 200) loaded in one call

### Migration & Integration

**Dependencies:**
- Add `@tanstack/react-router` and `@tanstack/router-devtools` (dev only)

**Refactoring:**
- `DesktopWindow` refactored: `DesktopFrame` wrapper and wizard logic remain, settings content moves into a `SettingsPage` route component
- `DesktopFrame` continues providing the titlebar drag region and overall frame — sidebar + router outlet sit inside it
- `NotificationWindow` (floating card) is untouched — renders based on window label, independent of router

**Window config:**
- No changes to `tauri.conf.json` — 680x680 dimensions and behavior unchanged; sidebar is narrow enough to fit

## Components

| Component | Location | Responsibility |
|---|---|---|
| `App.tsx` | Existing, modified | Window-label gate + router setup for main window |
| `AppShell` | New | Sidebar nav + router outlet, rendered post-wizard |
| `NotificationsPage` | New | Notification history list view |
| `SettingsPage` | New (extracted) | Current settings content moved here |
| `DesktopFrame` | Existing, modified | Wraps AppShell instead of settings directly |
| `NotificationWindow` | Existing, unchanged | Floating notification card |

## Data Structures

**`HistoryEntry`** (Rust struct, serialized to frontend):
```
HistoryEntry {
    notification: FailureNotification,  // existing struct unchanged
    seen: bool,                         // false when first enqueued, true after dismissed
    received_at: String,                // RFC3339 timestamp of when it was received
}
```

## Tauri Commands

| Command | Direction | Description |
|---|---|---|
| `get_notification_history` | New | Returns `Vec<HistoryEntry>` newest first |
| `mark_all_notifications_read` | New | Marks all history entries as seen |
| All existing commands | Unchanged | No modifications needed |
