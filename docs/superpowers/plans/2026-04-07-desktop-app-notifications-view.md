# Desktop App: Multi-View Shell with Notifications List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the desktop app from a settings-only window into a multi-view app with sidebar navigation, where a persistent notification history list is the default home view.

**Architecture:** TanStack Router provides code-based routing between two views (notifications list at `/`, settings at `/settings`). A sidebar with icon nav sits inside the existing `DesktopFrame`. Notification history is stored in a separate JSON file on disk (not in `AppState`, which uses `deny_unknown_fields`) and managed via new Rust types and Tauri commands. The floating notification window remains untouched.

**Tech Stack:** React 19, TanStack Router, TanStack React Query, Tauri 2 (Rust), Tailwind CSS, Vitest

---

## File Structure

### New Files
- `packages/desktop-app/src/router.ts` — Route definitions, router instance, type registration
- `packages/desktop-app/src/features/desktop-shell/app-shell.tsx` — Sidebar nav + `<Outlet />` layout
- `packages/desktop-app/src/features/notifications/notifications-page.tsx` — Notification history list view
- `packages/desktop-app/src/features/desktop-shell/settings-page.tsx` — Extracted settings content
- `packages/desktop-app/src-tauri/src/history.rs` — `NotificationHistory` struct, persistence, Tauri commands

### Modified Files
- `packages/desktop-app/package.json` — Add `@tanstack/react-router` dependency
- `packages/desktop-app/src/main.tsx` — Wrap app with `RouterProvider`
- `packages/desktop-app/src/App.tsx` — Route notification window vs router-based main window
- `packages/desktop-app/src/features/desktop-shell/desktop-window.tsx` — Remove `SettingsScreen`, use `AppShell` post-wizard
- `packages/desktop-app/src/features/desktop-shell/ui.tsx` — Adapt `DesktopFrame` for shell layout
- `packages/desktop-app/src-tauri/src/lib.rs` — Add `history` module, `NotificationHistoryState`, register new commands
- `packages/desktop-app/src-tauri/src/notifications.rs` — Append to history on enqueue/dismiss
- `packages/desktop-app/src/lib/tauri.ts` — Add `NOTIFICATION_HISTORY_CHANGED_EVENT` constant
- `packages/desktop-app/src/App.test.tsx` — Update tests for new routing structure

---

## Task 1: Add TanStack Router dependency

**Files:**
- Modify: `packages/desktop-app/package.json`

- [ ] **Step 1: Install @tanstack/react-router**

```bash
cd /Users/elfo404/projects/everr-labs/everr && pnpm add @tanstack/react-router --filter @everr/desktop-app
```

- [ ] **Step 2: Install @tanstack/react-router-devtools as dev dependency**

```bash
cd /Users/elfo404/projects/everr-labs/everr && pnpm add -D @tanstack/react-router-devtools --filter @everr/desktop-app
```

- [ ] **Step 3: Verify it resolves**

```bash
cd /Users/elfo404/projects/everr-labs/everr/packages/desktop-app && node -e "require.resolve('@tanstack/react-router')"
```

Expected: Path printed, no error.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/package.json pnpm-lock.yaml
git commit -m "chore(desktop-app): add @tanstack/react-router dependency"
```

---

## Task 2: Create the router and route definitions

**Files:**
- Create: `packages/desktop-app/src/router.ts`
- Create: `packages/desktop-app/src/features/desktop-shell/settings-page.tsx`
- Create: `packages/desktop-app/src/features/notifications/notifications-page.tsx`

- [ ] **Step 1: Create a placeholder NotificationsPage**

Create `packages/desktop-app/src/features/notifications/notifications-page.tsx`:

```tsx
export function NotificationsPage() {
  return (
    <div className="px-6 py-5">
      <h2 className="m-0 text-[1rem] font-semibold">Notifications</h2>
      <p className="m-0 mt-1.5 text-[0.92rem] text-[var(--settings-text-muted)]">
        No notifications yet.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Extract SettingsPage from desktop-window.tsx**

Create `packages/desktop-app/src/features/desktop-shell/settings-page.tsx`:

```tsx
import { Separator } from "@everr/ui/components/separator";
import { AssistantsSection } from "../assistants/assistants";
import { AuthSettingsSection } from "../auth/auth";
import { DeveloperNotificationSection } from "../notifications/notification-window";

export function SettingsPage() {
  return (
    <div className="grid divide-y divide-white/[0.06]">
      <div className="pt-0">
        <AuthSettingsSection />
      </div>
      <AssistantsSection />
      {import.meta.env.DEV && (
        <>
          <Separator className="bg-[var(--settings-border-soft)]" />
          <DeveloperNotificationSection />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the router with code-based routes**

Create `packages/desktop-app/src/router.ts`:

```ts
import {
  createRouter,
  createRoute,
  createRootRoute,
} from "@tanstack/react-router";
import { NotificationsPage } from "./features/notifications/notifications-page";
import { SettingsPage } from "./features/desktop-shell/settings-page";

const rootRoute = createRootRoute();

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: NotificationsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([notificationsRoute, settingsRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/src/router.ts packages/desktop-app/src/features/notifications/notifications-page.tsx packages/desktop-app/src/features/desktop-shell/settings-page.tsx
git commit -m "feat(desktop-app): create router, settings page, and notifications page placeholder"
```

---

## Task 3: Create the AppShell with sidebar navigation

**Files:**
- Create: `packages/desktop-app/src/features/desktop-shell/app-shell.tsx`

- [ ] **Step 1: Create the AppShell component**

Create `packages/desktop-app/src/features/desktop-shell/app-shell.tsx`:

```tsx
import { Link, Outlet } from "@tanstack/react-router";
import { Bell, Settings } from "lucide-react";

export function AppShell() {
  return (
    <div className="flex h-full">
      <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] pt-3">
        <SidebarLink to="/" label="Notifications">
          <Bell className="size-[18px]" />
        </SidebarLink>
        <SidebarLink to="/settings" label="Settings">
          <Settings className="size-[18px]" />
        </SidebarLink>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

function SidebarLink({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-md text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--settings-text)] [&.active]:bg-white/[0.08] [&.active]:text-[var(--settings-text)]"
    >
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop-app/src/features/desktop-shell/app-shell.tsx
git commit -m "feat(desktop-app): add AppShell with sidebar navigation"
```

---

## Task 4: Wire up the router into the app

**Files:**
- Modify: `packages/desktop-app/src/main.tsx`
- Modify: `packages/desktop-app/src/App.tsx`
- Modify: `packages/desktop-app/src/features/desktop-shell/desktop-window.tsx`
- Modify: `packages/desktop-app/src/router.ts`

- [ ] **Step 1: Update the root route to use AppShell as its component**

In `packages/desktop-app/src/router.ts`, update the root route to use the `AppShell`:

```ts
import {
  createRouter,
  createRoute,
  createRootRoute,
} from "@tanstack/react-router";
import { AppShell } from "./features/desktop-shell/app-shell";
import { NotificationsPage } from "./features/notifications/notifications-page";
import { SettingsPage } from "./features/desktop-shell/settings-page";

const rootRoute = createRootRoute({
  component: AppShell,
});

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: NotificationsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([notificationsRoute, settingsRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

- [ ] **Step 2: Update main.tsx to provide the router**

Replace the contents of `packages/desktop-app/src/main.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { APP_DISPLAY_NAME } from "./lib/app-name";
import { createQueryClient } from "./lib/query-client";
import { router } from "./router";
import { NOTIFICATION_WINDOW_LABEL, resolveWindowLabel } from "./lib/tauri";
import "@/styles/desktop-app.css";

const queryClient = createQueryClient();
document.title = APP_DISPLAY_NAME;

const isNotification = resolveWindowLabel() === NOTIFICATION_WINDOW_LABEL;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {isNotification ? <App /> : <RouterProvider router={router} />}
    </QueryClientProvider>
  </React.StrictMode>,
);
```

Wait — the notification window still needs its own render path, but the main window needs the router. However, the wizard gate needs to happen before the router renders. The cleanest approach: keep the wizard gate in the root route component.

Let me revise. The `AppShell` should include the wizard gate logic, or we put it in the root route's component. Let's put the wizard/frame logic in the root route component directly.

- [ ] **Step 2 (revised): Update router.ts — root route component handles wizard gate**

Replace `packages/desktop-app/src/router.ts`:

```ts
import {
  createRouter,
  createRoute,
  createRootRoute,
} from "@tanstack/react-router";
import { NotificationsPage } from "./features/notifications/notifications-page";
import { SettingsPage } from "./features/desktop-shell/settings-page";
import { DesktopWindow } from "./features/desktop-shell/desktop-window";

const rootRoute = createRootRoute({
  component: DesktopWindow,
});

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: NotificationsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([notificationsRoute, settingsRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

- [ ] **Step 3: Refactor DesktopWindow to render AppShell with Outlet when wizard is complete**

Replace `packages/desktop-app/src/features/desktop-shell/desktop-window.tsx`:

```tsx
import { Toaster } from "@everr/ui/components/sonner";
import { APP_DISPLAY_NAME } from "@/lib/app-name";
import { toErrorMessageText } from "@/lib/tauri";
import {
  SetupWizard,
  useWizardStatusQuery,
} from "../setup-wizard/setup-wizard";
import { DesktopFrame, DesktopLoadingState } from "./ui";
import { AppShell } from "./app-shell";

export function DesktopWindow() {
  const wizardStatusQuery = useWizardStatusQuery();

  if (wizardStatusQuery.isPending) {
    return <DesktopLoadingState text={`Loading ${APP_DISPLAY_NAME}...`} />;
  }

  if (wizardStatusQuery.isError) {
    return (
      <DesktopLoadingState text={toErrorMessageText(wizardStatusQuery.error)} />
    );
  }

  const wizardStatus = wizardStatusQuery.data;
  if (!wizardStatus) {
    return <DesktopLoadingState text={`Loading ${APP_DISPLAY_NAME}...`} />;
  }

  const showingWizard = !wizardStatus.wizard_completed;

  if (showingWizard) {
    return (
      <>
        <Toaster closeButton position="top-right" richColors visibleToasts={1} />
        <DesktopFrame
          title="Installation wizard"
          description="Authenticate and choose assistant integrations."
        >
          <SetupWizard />
        </DesktopFrame>
      </>
    );
  }

  return (
    <>
      <Toaster closeButton position="top-right" richColors visibleToasts={1} />
      <AppShell />
    </>
  );
}
```

- [ ] **Step 4: Update main.tsx**

Replace `packages/desktop-app/src/main.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { NotificationWindow } from "./features/notifications/notification-window";
import { APP_DISPLAY_NAME } from "./lib/app-name";
import { createQueryClient } from "./lib/query-client";
import { NOTIFICATION_WINDOW_LABEL, resolveWindowLabel } from "./lib/tauri";
import { router } from "./router";
import "@/styles/desktop-app.css";

const queryClient = createQueryClient();
document.title = APP_DISPLAY_NAME;

const isNotification = resolveWindowLabel() === NOTIFICATION_WINDOW_LABEL;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {isNotification ? <NotificationWindow /> : <RouterProvider router={router} />}
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 5: Simplify App.tsx (or remove it)**

The window-label routing now lives in `main.tsx`. `App.tsx` is no longer needed as the entry component. However, since tests import `App`, keep it as a thin re-export for now. Replace `packages/desktop-app/src/App.tsx`:

```tsx
import { DesktopWindow } from "./features/desktop-shell/desktop-window";

// The main entry point (main.tsx) now handles the notification window vs router split.
// App is kept for backward compatibility with existing test imports.
function App() {
  return <DesktopWindow />;
}

export default App;
```

- [ ] **Step 6: Verify the frontend compiles**

```bash
cd /Users/elfo404/projects/everr-labs/everr/packages/desktop-app && pnpm exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop-app/src/main.tsx packages/desktop-app/src/App.tsx packages/desktop-app/src/router.ts packages/desktop-app/src/features/desktop-shell/desktop-window.tsx
git commit -m "feat(desktop-app): wire up TanStack Router with wizard gate and sidebar shell"
```

---

## Task 5: Adapt DesktopFrame for the new shell layout

**Files:**
- Modify: `packages/desktop-app/src/features/desktop-shell/ui.tsx`
- Modify: `packages/desktop-app/src/features/desktop-shell/app-shell.tsx`

The current `DesktopFrame` renders a centered card with a header. For the post-wizard app shell, we need the frame's background and drag region, but the content area should be the sidebar + route outlet taking the full card space — no card header.

- [ ] **Step 1: Update AppShell to include the frame background and drag region directly**

The `AppShell` is rendered inside the root route (inside `DesktopWindow`) when the wizard is complete. It needs the background gradient and drag region from `DesktopFrame`, but not the card header structure. Update `packages/desktop-app/src/features/desktop-shell/app-shell.tsx`:

```tsx
import { Link, Outlet } from "@tanstack/react-router";
import { Bell, Settings } from "lucide-react";
import { Card, CardContent } from "@everr/ui/components/card";

export function AppShell() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,var(--settings-shell)_0%,var(--settings-shell-bottom)_100%)] text-[var(--settings-text)]">
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 h-9" />
      <Card className="flex h-screen w-full overflow-hidden border-[color:var(--settings-border)] bg-[var(--settings-panel)] text-[var(--settings-text)] shadow-[var(--settings-panel-shadow)]">
        <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] pt-12">
          <SidebarLink to="/" label="Notifications">
            <Bell className="size-[18px]" />
          </SidebarLink>
          <SidebarLink to="/settings" label="Settings">
            <Settings className="size-[18px]" />
          </SidebarLink>
        </nav>
        <CardContent className="min-w-0 flex-1 overflow-y-auto p-0">
          <Outlet />
        </CardContent>
      </Card>
    </main>
  );
}

function SidebarLink({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-md text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--settings-text)] [&.active]:bg-white/[0.08] [&.active]:text-[var(--settings-text)]"
    >
      {children}
    </Link>
  );
}
```

Note: `pt-12` on the nav accounts for the 36px drag region at the top.

- [ ] **Step 2: Update SettingsPage to include its own header**

The settings page previously got its header from `DesktopFrame`. Now it needs its own. Update `packages/desktop-app/src/features/desktop-shell/settings-page.tsx`:

```tsx
import { Separator } from "@everr/ui/components/separator";
import { AssistantsSection } from "../assistants/assistants";
import { AccountHeaderAction, AuthSettingsSection } from "../auth/auth";
import { DeveloperNotificationSection } from "../notifications/notification-window";

export function SettingsPage() {
  return (
    <div className="pt-8">
      <div className="px-6 pb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1.5">
            <h1 className="m-0 text-[clamp(1.4rem,3vw,1.8rem)] font-medium leading-none tracking-[-0.04em]">
              Settings
            </h1>
            <p className="m-0 max-w-[52ch] text-[0.92rem] leading-6 text-[var(--settings-text-muted)]">
              Manage your desktop connection and assistant integrations.
            </p>
          </div>
          <div className="shrink-0">
            <AccountHeaderAction />
          </div>
        </div>
      </div>
      <div className="grid divide-y divide-white/[0.06]">
        <div className="pt-0">
          <AuthSettingsSection />
        </div>
        <AssistantsSection />
        {import.meta.env.DEV && (
          <>
            <Separator className="bg-[var(--settings-border-soft)]" />
            <DeveloperNotificationSection />
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/elfo404/projects/everr-labs/everr/packages/desktop-app && pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/src/features/desktop-shell/app-shell.tsx packages/desktop-app/src/features/desktop-shell/settings-page.tsx
git commit -m "feat(desktop-app): integrate AppShell with frame layout and settings page header"
```

---

## Task 6: Notification history — Rust persistence

**Files:**
- Create: `packages/desktop-app/src-tauri/src/history.rs`
- Modify: `packages/desktop-app/src-tauri/src/lib.rs`

- [ ] **Step 1: Create the history module**

Create `packages/desktop-app/src-tauri/src/history.rs`:

```rust
use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use everr_core::api::FailureNotification;
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

const MAX_HISTORY_ENTRIES: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryEntry {
    pub notification: FailureNotification,
    pub seen: bool,
    pub received_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryFile {
    entries: Vec<HistoryEntry>,
}

#[derive(Debug, Clone)]
pub(crate) struct NotificationHistoryStore {
    path: PathBuf,
    state: Arc<Mutex<VecDeque<HistoryEntry>>>,
}

impl NotificationHistoryStore {
    pub fn load(path: PathBuf) -> Result<Self> {
        let entries = if path.exists() {
            let raw = fs::read_to_string(&path)
                .with_context(|| format!("failed to read {}", path.display()))?;
            match serde_json::from_str::<HistoryFile>(&raw) {
                Ok(file) => VecDeque::from(file.entries),
                Err(_) => VecDeque::new(),
            }
        } else {
            VecDeque::new()
        };

        Ok(Self {
            path,
            state: Arc::new(Mutex::new(entries)),
        })
    }

    pub fn append(&self, notification: FailureNotification) -> Result<()> {
        let now = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_default();
        let entry = HistoryEntry {
            notification,
            seen: false,
            received_at: now,
        };

        let mut entries = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("failed to lock history state"))?;
        entries.push_back(entry);
        while entries.len() > MAX_HISTORY_ENTRIES {
            entries.pop_front();
        }
        self.save_locked(&entries)
    }

    pub fn mark_seen(&self, dedupe_key: &str) -> Result<()> {
        let mut entries = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("failed to lock history state"))?;
        let mut changed = false;
        for entry in entries.iter_mut() {
            if entry.notification.dedupe_key == dedupe_key && !entry.seen {
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
        let mut entries = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("failed to lock history state"))?;
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
        let entries = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("failed to lock history state"))?;
        // Return newest first
        Ok(entries.iter().rev().cloned().collect())
    }

    fn save_locked(&self, entries: &VecDeque<HistoryEntry>) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        let file = HistoryFile {
            entries: entries.iter().cloned().collect(),
        };
        let serialized =
            serde_json::to_string_pretty(&file).context("failed to serialize history")?;
        fs::write(&self.path, serialized)
            .with_context(|| format!("failed to write {}", self.path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn test_failure(key: &str) -> FailureNotification {
        FailureNotification {
            dedupe_key: key.to_string(),
            trace_id: format!("trace-{key}"),
            repo: "test/repo".to_string(),
            branch: "main".to_string(),
            workflow_name: "CI".to_string(),
            failed_at: "2026-03-07T10:00:00Z".to_string(),
            details_url: format!("https://example.com/{key}"),
            job_name: None,
            step_number: None,
            step_name: None,
        }
    }

    #[test]
    fn append_and_retrieve_entries() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("history.json");
        let store = NotificationHistoryStore::load(path).unwrap();

        store.append(test_failure("one")).unwrap();
        store.append(test_failure("two")).unwrap();

        let entries = store.get_all().unwrap();
        assert_eq!(entries.len(), 2);
        // Newest first
        assert_eq!(entries[0].notification.dedupe_key, "two");
        assert_eq!(entries[1].notification.dedupe_key, "one");
        assert!(!entries[0].seen);
    }

    #[test]
    fn mark_seen_updates_entry() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("history.json");
        let store = NotificationHistoryStore::load(path).unwrap();

        store.append(test_failure("one")).unwrap();
        store.mark_seen("one").unwrap();

        let entries = store.get_all().unwrap();
        assert!(entries[0].seen);
    }

    #[test]
    fn mark_all_seen_updates_all_entries() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("history.json");
        let store = NotificationHistoryStore::load(path).unwrap();

        store.append(test_failure("one")).unwrap();
        store.append(test_failure("two")).unwrap();
        store.mark_all_seen().unwrap();

        let entries = store.get_all().unwrap();
        assert!(entries.iter().all(|e| e.seen));
    }

    #[test]
    fn cap_at_max_entries() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("history.json");
        let store = NotificationHistoryStore::load(path).unwrap();

        for i in 0..210 {
            store.append(test_failure(&format!("n{i}"))).unwrap();
        }

        let entries = store.get_all().unwrap();
        assert_eq!(entries.len(), 200);
        // Oldest entries should be dropped
        assert_eq!(entries.last().unwrap().notification.dedupe_key, "n10");
    }

    #[test]
    fn persists_across_loads() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("history.json");

        {
            let store = NotificationHistoryStore::load(path.clone()).unwrap();
            store.append(test_failure("one")).unwrap();
        }

        let store = NotificationHistoryStore::load(path).unwrap();
        let entries = store.get_all().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].notification.dedupe_key, "one");
    }
}
```

- [ ] **Step 2: Run the Rust tests**

```bash
cd /Users/elfo404/projects/everr-labs/everr/packages/desktop-app/src-tauri && cargo test history
```

Expected: All 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop-app/src-tauri/src/history.rs
git commit -m "feat(desktop-app): add NotificationHistoryStore with disk persistence"
```

---

## Task 7: Integrate history store into RuntimeState and commands

**Files:**
- Modify: `packages/desktop-app/src-tauri/src/lib.rs`
- Modify: `packages/desktop-app/src-tauri/src/notifications.rs`

- [ ] **Step 1: Add the history module and state to lib.rs**

In `packages/desktop-app/src-tauri/src/lib.rs`, add the module declaration after line 27 (after `mod crash_log;`):

```rust
mod history;
```

Add import at the top of the `use` section (after the other crate-internal uses):

```rust
use history::NotificationHistoryStore;
```

Add a `history` field to `RuntimeState` struct (after `session_changed`):

```rust
#[derive(Clone)]
struct RuntimeState {
    store: AppStateStore,
    persisted: Arc<Mutex<AppState>>,
    notifier: Arc<Mutex<NotifierState>>,
    tray: Arc<Mutex<TrayState>>,
    pending_auth: Arc<Mutex<Option<PendingAuthState>>>,
    session_changed: Arc<Notify>,
    history: NotificationHistoryStore,
}
```

Add a new event constant:

```rust
const NOTIFICATION_HISTORY_CHANGED_EVENT: &str = "everr://notification-history-changed";
```

In the `setup` closure, initialize the history store. The history file sits next to the session file. Add this before the `RuntimeState` construction:

```rust
let history_path = {
    let session_path = store.session_file_path()?;
    session_path
        .parent()
        .expect("session file has parent")
        .join("notification-history.json")
};
let history = NotificationHistoryStore::load(history_path)?;
```

Then add `history` to the `RuntimeState` constructor:

```rust
let runtime = RuntimeState {
    store,
    persisted: Arc::new(Mutex::new(persisted)),
    notifier: Arc::new(Mutex::new(NotifierState::default())),
    tray: Arc::new(Mutex::new(TrayState::default())),
    pending_auth: Arc::new(Mutex::new(None)),
    session_changed: Arc::new(Notify::new()),
    history,
};
```

Add new command imports and register them in the invoke handler. Add to the `use commands::` block:

```rust
use commands::{
    // ... existing imports ...
    get_notification_history, mark_all_notifications_read,
};
```

Add to the `invoke_handler` list:

```rust
get_notification_history,
mark_all_notifications_read,
```

- [ ] **Step 2: Add history commands to commands.rs**

Add these imports at the top of `packages/desktop-app/src-tauri/src/commands.rs`:

```rust
use crate::history::HistoryEntry;
use crate::NOTIFICATION_HISTORY_CHANGED_EVENT;
```

Add the two new command functions at the bottom of the file (before `run_blocking_command`):

```rust
#[tauri::command]
pub(crate) fn get_notification_history(
    state: State<'_, RuntimeState>,
) -> CommandResult<Vec<HistoryEntry>> {
    state
        .history
        .get_all()
        .into_command_result()
}

#[tauri::command]
pub(crate) fn mark_all_notifications_read(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<()> {
    state
        .history
        .mark_all_seen()
        .into_command_result()?;
    let _ = app.emit(NOTIFICATION_HISTORY_CHANGED_EVENT, ());
    Ok(())
}
```

- [ ] **Step 3: Append to history when a notification is enqueued**

In `packages/desktop-app/src-tauri/src/notifications.rs`, update the `enqueue_notification` function to also append to history. Add `NOTIFICATION_HISTORY_CHANGED_EVENT` to the imports from `crate::`:

```rust
use crate::{
    current_base_url, NotificationQueue, RuntimeState, NOTIFICATION_CHANGED_EVENT,
    NOTIFICATION_HISTORY_CHANGED_EVENT,
    NOTIFICATION_HOVER_EVENT, NOTIFICATION_WINDOW_HEIGHT, NOTIFICATION_WINDOW_INSET,
    NOTIFICATION_WINDOW_LABEL, NOTIFICATION_WINDOW_MARGIN, NOTIFICATION_WINDOW_WIDTH,
    TRAY_FAILURES_WINDOW_MINUTES,
};
```

Update `enqueue_notification` to append to history:

```rust
fn enqueue_notification(
    app: &AppHandle,
    state: &RuntimeState,
    notification: FailureNotification,
) -> Result<()> {
    state.history.append(notification.clone())?;
    let _ = app.emit(NOTIFICATION_HISTORY_CHANGED_EVENT, ());

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

- [ ] **Step 4: Mark as seen when a notification is dismissed**

Update `dismiss_active_notification_inner` in `notifications.rs` to mark the dismissed notification as seen:

```rust
pub(crate) fn dismiss_active_notification_inner(
    app: &AppHandle,
    state: &RuntimeState,
) -> Result<()> {
    let dismissed_key = {
        let notifier = state
            .notifier
            .lock()
            .map_err(|_| anyhow!("failed to lock notifier state"))?;
        notifier.queue.active().map(|n| n.dedupe_key.clone())
    };

    if let Some(key) = &dismissed_key {
        let _ = state.history.mark_seen(key);
        let _ = app.emit(NOTIFICATION_HISTORY_CHANGED_EVENT, ());
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

- [ ] **Step 5: Also append test notifications to history**

In `commands.rs`, update `trigger_test_notification` to append to history:

```rust
#[tauri::command]
pub(crate) fn trigger_test_notification(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<TestNotificationResponse> {
    let notification = build_test_notification().into_command_result()?;

    state
        .history
        .append(notification.clone())
        .into_command_result()?;
    let _ = app.emit(NOTIFICATION_HISTORY_CHANGED_EVENT, ());

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

- [ ] **Step 6: Verify Rust compiles and tests pass**

```bash
cd /Users/elfo404/projects/everr-labs/everr/packages/desktop-app/src-tauri && cargo test
```

Expected: All tests pass (including existing ones + the new history tests).

- [ ] **Step 7: Commit**

```bash
git add packages/desktop-app/src-tauri/src/lib.rs packages/desktop-app/src-tauri/src/commands.rs packages/desktop-app/src-tauri/src/notifications.rs packages/desktop-app/src-tauri/src/history.rs
git commit -m "feat(desktop-app): integrate notification history into runtime state and commands"
```

---

## Task 8: Build the NotificationsPage frontend

**Files:**
- Modify: `packages/desktop-app/src/features/notifications/notifications-page.tsx`
- Modify: `packages/desktop-app/src/lib/tauri.ts`

- [ ] **Step 1: Add the history event constant and command types to tauri.ts**

In `packages/desktop-app/src/lib/tauri.ts`, add the new event constant after the existing ones:

```ts
export const NOTIFICATION_HISTORY_CHANGED_EVENT = "everr://notification-history-changed";
```

- [ ] **Step 2: Build the full NotificationsPage**

Replace `packages/desktop-app/src/features/notifications/notifications-page.tsx`:

```tsx
import { Button } from "@everr/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  invokeCommand,
  NOTIFICATION_HISTORY_CHANGED_EVENT,
} from "@/lib/tauri";
import { useInvalidateOnTauriEvent } from "@/lib/tauri-events";
import {
  formatNotificationRelativeTime,
} from "../../notification-time";
import type { FailureNotification } from "./notification-window";

type HistoryEntry = {
  notification: FailureNotification;
  seen: boolean;
  receivedAt: string;
};

const notificationHistoryQueryKey = [
  "desktop-app",
  "notification-history",
] as const;

function getNotificationHistory() {
  return invokeCommand<HistoryEntry[]>("get_notification_history");
}

function markAllNotificationsRead() {
  return invokeCommand<void>("mark_all_notifications_read");
}

export function NotificationsPage() {
  useInvalidateOnTauriEvent(NOTIFICATION_HISTORY_CHANGED_EVENT, (queryClient) => {
    void queryClient.invalidateQueries({
      queryKey: notificationHistoryQueryKey,
    });
  });

  const historyQuery = useQuery({
    queryKey: notificationHistoryQueryKey,
    queryFn: getNotificationHistory,
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
  });

  const entries = historyQuery.data ?? [];
  const hasUnread = entries.some((e) => !e.seen);

  return (
    <div className="pt-8">
      <div className="flex items-start justify-between gap-4 px-6 pb-4">
        <div className="grid gap-1.5">
          <h1 className="m-0 text-[clamp(1.4rem,3vw,1.8rem)] font-medium leading-none tracking-[-0.04em]">
            Notifications
          </h1>
          <p className="m-0 max-w-[52ch] text-[0.92rem] leading-6 text-[var(--settings-text-muted)]">
            Recent CI pipeline failures.
          </p>
        </div>
        {hasUnread && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={markAllReadMutation.isPending}
            onClick={() => void markAllReadMutation.mutateAsync()}
          >
            Mark all as read
          </Button>
        )}
      </div>

      {historyQuery.isPending ? (
        <div className="px-6 py-4">
          <p className="m-0 text-sm text-[var(--settings-text-muted)]">
            Loading notifications...
          </p>
        </div>
      ) : entries.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="m-0 text-sm text-[var(--settings-text-muted)]">
            No notifications yet. Failed CI runs will appear here.
          </p>
        </div>
      ) : (
        <ul className="m-0 list-none p-0">
          {entries.map((entry) => (
            <NotificationHistoryItem
              key={entry.notification.dedupeKey + entry.receivedAt}
              entry={entry}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationHistoryItem({ entry }: { entry: HistoryEntry }) {
  const { notification, seen } = entry;
  const relativeTime = formatNotificationRelativeTime(notification.failedAt);
  const failureScope = formatFailureScope(notification);

  function handleClick() {
    window.open(notification.detailsUrl, "_blank");
  }

  return (
    <li>
      <button
        type="button"
        className="flex w-full cursor-pointer items-start gap-3 border-b border-white/[0.04] px-6 py-3 text-left transition-colors hover:bg-white/[0.03]"
        onClick={handleClick}
      >
        {!seen && (
          <span className="mt-1.5 block size-2 shrink-0 rounded-full bg-primary" />
        )}
        <div className={`min-w-0 flex-1 grid gap-0.5 ${seen ? "pl-5" : ""}`}>
          <p className="m-0 text-[0.85rem] font-semibold leading-tight text-[var(--settings-text)]">
            {notification.workflowName}
          </p>
          <p className="m-0 flex min-w-0 items-center gap-1 text-[0.78rem] leading-tight text-[var(--settings-text-muted)]">
            <span className="truncate">{notification.repo}</span>
            <span className="text-white/20">·</span>
            <span>{notification.branch}</span>
          </p>
          {failureScope && (
            <p className="m-0 text-[0.75rem] leading-tight text-[var(--settings-text-muted)]">
              {failureScope}
            </p>
          )}
        </div>
        <span className="shrink-0 pt-0.5 text-[0.72rem] text-[var(--settings-text-muted)]">
          {relativeTime}
        </span>
      </button>
    </li>
  );
}

function formatFailureScope(notification: FailureNotification): string | null {
  if (notification.jobName && notification.stepNumber && notification.stepName) {
    return `${notification.jobName} · Step ${notification.stepNumber}: ${notification.stepName}`;
  }
  if (notification.jobName && notification.stepName) {
    return `${notification.jobName} · ${notification.stepName}`;
  }
  if (notification.jobName && notification.stepNumber) {
    return `${notification.jobName} · Step ${notification.stepNumber}`;
  }
  if (notification.jobName) {
    return `Job: ${notification.jobName}`;
  }
  return null;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/elfo404/projects/everr-labs/everr/packages/desktop-app && pnpm exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/src/features/notifications/notifications-page.tsx packages/desktop-app/src/lib/tauri.ts
git commit -m "feat(desktop-app): build notifications page with history list"
```

---

## Task 9: Update existing tests

**Files:**
- Modify: `packages/desktop-app/src/App.test.tsx`

The existing tests use `mockWindows("main")` and render `<App />`. Since `App` now renders `DesktopWindow` (which uses `useWizardStatusQuery` etc.), the main window tests should still work. However, the test for "renders the settings view" will need updating since the default route is now notifications, not settings.

- [ ] **Step 1: Update the desktop window tests**

The key changes:
1. The main window tests that render `<App />` should still work since `App` renders `DesktopWindow`, which shows the wizard or `AppShell`.
2. When wizard is complete, the default route is `/` (notifications), not settings. Tests that expect to see "Settings" heading on load will need to navigate to `/settings` or we need to verify they see the notifications page instead.
3. Tests using `RouterProvider` need a router context. Since `App` is used without the router (it renders `DesktopWindow` directly), tests rendering `<App />` won't have the router. We need to either wrap with router or adjust.

The simplest approach: Update the `renderMainApp` function to render with `RouterProvider` when wizard is completed, and render `<App />` when testing the wizard flow.

Update the relevant test sections in `packages/desktop-app/src/App.test.tsx`:

Add the router import at the top:

```tsx
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
```

Update `renderMainApp` to use the router for non-wizard scenarios:

In the function, after `renderWithProviders(<App />);`, change to conditionally use the router:

```tsx
if (options.wizardCompleted === false) {
  renderWithProviders(<App />);
} else {
  renderWithProviders(<RouterProvider router={router} />);
}
```

Add `get_notification_history` to the IPC mock switch:

```tsx
case "get_notification_history":
  return [];
case "mark_all_notifications_read":
  return null;
```

Update the first test — "renders the settings view for completed users" — to verify the notifications page is the default:

```tsx
it("renders the notifications view as the default for completed users", async () => {
  renderMainApp();

  expect(
    await screen.findByRole("heading", { name: "Notifications" }),
  ).toBeInTheDocument();
});
```

For tests that need the settings page, add navigation. For example, the "loads settings sections independently" test should navigate to settings first.

- [ ] **Step 2: Run all tests**

```bash
cd /Users/elfo404/projects/everr-labs/everr/packages/desktop-app && pnpm test
```

Expected: All tests pass.

- [ ] **Step 3: Fix any test failures iteratively**

Adjust test expectations as needed based on the new default route being notifications instead of settings. The wizard-related tests should remain unchanged since they render the wizard path which doesn't use the router.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/src/App.test.tsx
git commit -m "test(desktop-app): update tests for router-based navigation"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run full Rust test suite**

```bash
cd /Users/elfo404/projects/everr-labs/everr/packages/desktop-app/src-tauri && cargo test
```

Expected: All tests pass.

- [ ] **Step 2: Run full frontend test suite**

```bash
cd /Users/elfo404/projects/everr-labs/everr/packages/desktop-app && pnpm test
```

Expected: All tests pass.

- [ ] **Step 3: TypeScript compilation check**

```bash
cd /Users/elfo404/projects/everr-labs/everr/packages/desktop-app && pnpm exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Verify the frontend builds for production**

```bash
cd /Users/elfo404/projects/everr-labs/everr/packages/desktop-app && pnpm exec vite build
```

Expected: Build succeeds.
