# Notification Emails Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure a list of notification emails collected during `everr setup` and the desktop wizard, used client-side to filter which CI notifications are shown.

**Architecture:** Add `notification_emails` and `user_profile` to `AppSettings` (local, never sent to server). A new `GET /api/cli/me` endpoint returns the WorkOS user's profile. The CLI setup adds a prompt step; the desktop wizard backfills silently. The notifier switches from author-scoped SSE to tenant-scoped SSE and filters events client-side. Desktop settings expose add/remove UI.

**Tech Stack:** Rust (`everr-core`, Tauri), TypeScript/React (TanStack Router, React Query), WorkOS Node SDK, `cliclack` for CLI prompts.

---

## File Map

| File | Change |
|------|--------|
| `crates/everr-core/src/state.rs` | Add `UserProfile`, `notification_emails`, `user_profile` to `AppSettings` |
| `crates/everr-core/src/api.rs` | Add `MeResponse` struct + `get_me()` method |
| `packages/app/src/routes/api/cli/me.ts` | **New** — GET /me route |
| `packages/app/src/routes/api/cli/me.test.ts` | **New** — route tests |
| `packages/desktop-app/src-cli/src/setup.rs` | Add `step_configure_notification_emails()` |
| `packages/desktop-app/src-tauri/src/notifications.rs` | Tenant-scope SSE, client-side filter, backfill |
| `packages/desktop-app/src-tauri/src/commands.rs` | Add `get_notification_emails`, `set_notification_emails`, `get_user_profile`; update `complete_setup_wizard` |
| `packages/desktop-app/src-tauri/src/lib.rs` | Register new commands in `invoke_handler` |
| `packages/desktop-app/src/features/notifications/notification-emails-section.tsx` | **New** — settings UI |
| `packages/desktop-app/src/features/desktop-shell/desktop-window.tsx` | Add `NotificationEmailsSection` to `SettingsScreen` |

---

## Task 1: Add `UserProfile` and new fields to `AppSettings`

**Files:**
- Modify: `crates/everr-core/src/state.rs`

- [ ] **Step 1: Add `UserProfile` struct and new fields to `AppSettings`**

In `crates/everr-core/src/state.rs`, add `UserProfile` before `AppSettings` and add two new fields:

```rust
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct UserProfile {
    pub email: String,
    pub name: String,
    pub profile_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AppSettings {
    pub completed_base_url: Option<String>,
    #[serde(flatten)]
    pub wizard_state: WizardState,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notification_emails: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_profile: Option<UserProfile>,
}
```

`skip_serializing_if` keeps the JSON clean when at default values — existing tests that assert exact JSON output won't break.

- [ ] **Step 2: Update `app_state_round_trips` test to include the new fields**

Find the test `app_state_round_trips` and update the `AppSettings` construction to include the new fields:

```rust
settings: AppSettings {
    completed_base_url: Some("https://app.everr.dev".to_string()),
    wizard_state: WizardState {
        wizard_completed: true,
    },
    notification_emails: vec!["user@example.com".to_string()],
    user_profile: Some(UserProfile {
        email: "user@example.com".to_string(),
        name: "Test User".to_string(),
        profile_url: None,
    }),
},
```

- [ ] **Step 3: Add backward-compatibility test**

Add this test to the `tests` module in `state.rs`:

```rust
#[test]
fn settings_without_notification_emails_loads_with_empty_defaults() {
    with_temp_config_home(|store| {
        let path = store.session_file_path().expect("state path");
        let parent = path.parent().expect("state parent");
        std::fs::create_dir_all(parent).expect("create state dir");
        std::fs::write(
            &path,
            serde_json::to_string_pretty(&serde_json::json!({
                "session": null,
                "settings": {
                    "completed_base_url": "https://app.everr.dev",
                    "wizard_completed": true
                }
            }))
            .expect("serialize"),
        )
        .expect("write");

        let state = store.load_state().expect("load state");
        assert!(state.settings.notification_emails.is_empty());
        assert!(state.settings.user_profile.is_none());
        assert!(state.settings.wizard_state.wizard_completed);
    });
}
```

- [ ] **Step 4: Run tests to verify**

```bash
cargo test --manifest-path crates/everr-core/Cargo.toml
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/everr-core/src/state.rs
git commit -m "feat: add notification_emails and user_profile to AppSettings"
```

---

## Task 2: Add `MeResponse` and `get_me()` to `ApiClient`

**Files:**
- Modify: `crates/everr-core/src/api.rs`

- [ ] **Step 1: Find where response structs are defined in `api.rs`**

Read `crates/everr-core/src/api.rs`. Locate where structs like `WatchResponse` and `WatchRun` are defined (around line 183). Add `MeResponse` nearby:

```rust
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeResponse {
    pub email: String,
    pub name: String,
    pub profile_url: Option<String>,
}
```

- [ ] **Step 2: Add `get_me()` to the `ApiClient` impl block**

In the `impl ApiClient` block, alongside methods like `get_status`, add:

```rust
pub async fn get_me(&self) -> Result<MeResponse> {
    self.get("/me", &[]).await
}
```

- [ ] **Step 3: Build to verify it compiles**

```bash
cargo build --manifest-path crates/everr-core/Cargo.toml
```

Expected: compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add crates/everr-core/src/api.rs
git commit -m "feat: add MeResponse and get_me() to ApiClient"
```

---

## Task 3: Add `GET /api/cli/me` server route

**Files:**
- Create: `packages/app/src/routes/api/cli/me.ts`
- Create: `packages/app/src/routes/api/cli/me.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/routes/api/cli/me.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/accessTokenAuthMiddleware", () => ({
  accessTokenAuthMiddleware: { options: {} },
}));

vi.mock("@/lib/workos", () => ({
  workOS: {
    userManagement: {
      getUser: vi.fn(),
    },
  },
}));

import { workOS } from "@/lib/workos";
import { Route } from "./me";

const mockedGetUser = vi.mocked(workOS.userManagement.getUser);

type GetHandler = (args: {
  request: Request;
  context: { session: { userId: string; tenantId: number } };
}) => Promise<Response>;

function getHandler(): GetHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { GET?: GetHandler } };
  };
  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) throw new Error("Missing GET handler for /api/cli/me.");
  return handler;
}

const context = { session: { userId: "user_abc", tenantId: 1 } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/cli/me", () => {
  it("returns user profile from WorkOS", async () => {
    mockedGetUser.mockResolvedValue({
      id: "user_abc",
      email: "guido@example.com",
      firstName: "Guido",
      lastName: "D'Orsi",
      profilePictureUrl: "https://example.com/avatar.png",
    } as never);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/me"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      email: "guido@example.com",
      name: "Guido D'Orsi",
      profileUrl: "https://example.com/avatar.png",
    });
    expect(mockedGetUser).toHaveBeenCalledWith("user_abc");
  });

  it("returns name from firstName only when lastName is absent", async () => {
    mockedGetUser.mockResolvedValue({
      id: "user_abc",
      email: "guido@example.com",
      firstName: "Guido",
      lastName: null,
      profilePictureUrl: null,
    } as never);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/me"),
      context,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Guido");
    expect(body.profileUrl).toBeNull();
  });

  it("falls back to email as name when firstName is absent", async () => {
    mockedGetUser.mockResolvedValue({
      id: "user_abc",
      email: "guido@example.com",
      firstName: null,
      lastName: null,
      profilePictureUrl: null,
    } as never);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/me"),
      context,
    });

    const body = await response.json();
    expect(body.name).toBe("guido@example.com");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/app && npx vitest run src/routes/api/cli/me.test.ts
```

Expected: FAIL with "Cannot find module './me'".

- [ ] **Step 3: Create the route**

Create `packages/app/src/routes/api/cli/me.ts`:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { workOS } from "@/lib/workos";

export const Route = createFileRoute("/api/cli/me")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      GET: async ({ context }) => {
        const user = await workOS.userManagement.getUser(context.session.userId);

        const nameParts = [user.firstName, user.lastName].filter(Boolean);
        const name = nameParts.length > 0 ? nameParts.join(" ") : user.email;

        return Response.json({
          email: user.email,
          name,
          profileUrl: user.profilePictureUrl ?? null,
        });
      },
    },
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/app && npx vitest run src/routes/api/cli/me.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes/api/cli/me.ts packages/app/src/routes/api/cli/me.test.ts
git commit -m "feat: add GET /api/cli/me endpoint"
```

---

## Task 4: Add `step_configure_notification_emails` to CLI setup

**Files:**
- Modify: `packages/desktop-app/src-cli/src/setup.rs`

- [ ] **Step 1: Add the new step function**

In `packages/desktop-app/src-cli/src/setup.rs`, add these imports at the top alongside the existing ones:

```rust
use everr_core::{api::ApiClient, git::resolve_git_context};
```

Then add the function before or after `step_configure_assistants`:

```rust
const ADD_EMAIL_SENTINEL: &str = "__add_email__";

async fn step_configure_notification_emails() -> Result<()> {
    let store = auth::state_store();
    let mut detected: Vec<String> = Vec::new();

    // Fetch Everr account email from /me
    if let Ok(session) = store.load_session() {
        if let Ok(client) = ApiClient::from_session(&session) {
            if let Ok(me) = client.get_me().await {
                detected.push(me.email.clone());
                // Cache user profile while we have it
                store.update_state(|state| {
                    state.settings.user_profile = Some(everr_core::state::UserProfile {
                        email: me.email,
                        name: me.name,
                        profile_url: me.profile_url,
                    });
                })?;
            }
        }
    }

    // Add git config email if different
    if let Ok(cwd) = std::env::current_dir() {
        let git = resolve_git_context(&cwd);
        if let Some(git_email) = git.email {
            if !detected.contains(&git_email) {
                detected.push(git_email);
            }
        }
    }

    cliclack::note(
        "Notification emails",
        "These emails are used locally to filter notifications — they're never sent to our servers.",
    )?;

    // Build multiselect: one item per detected email (all pre-selected) + "Add email…" sentinel
    let mut prompt = cliclack::multiselect("Select notification emails");
    for email in &detected {
        prompt = prompt.item(email.clone(), email.clone(), "");
    }
    prompt = prompt.item(ADD_EMAIL_SENTINEL.to_string(), "Add email…", "");

    // Pre-select all detected emails (not the sentinel)
    let mut selected: Vec<String> = prompt.initial_values(&detected).interact()?;

    // If the sentinel was selected, prompt for a custom email
    let add_requested = selected.contains(&ADD_EMAIL_SENTINEL.to_string());
    selected.retain(|e| e != ADD_EMAIL_SENTINEL);

    if add_requested {
        let custom: String = cliclack::input("Email address").interact()?;
        let custom = custom.trim().to_string();
        if !custom.is_empty() && !selected.contains(&custom) {
            selected.push(custom);
        }
    }

    // Fall back to detected list if user deselected everything
    let notification_emails = if selected.is_empty() { detected } else { selected };

    store.update_state(|state| {
        state.settings.notification_emails = notification_emails;
    })?;

    cliclack::log::success("Notification emails configured")?;
    Ok(())
}
```

- [ ] **Step 2: Call the new step from `run()`**

Update the `run()` function to insert the new step after `step_authenticate()`:

```rust
pub async fn run() -> Result<()> {
    println!();
    print_banner();
    cliclack::intro("Setup")?;

    step_authenticate().await?;
    step_configure_notification_emails().await?;
    step_configure_assistants()?;
    step_install_desktop_app().await?;

    cliclack::outro("Everr is ready.")?;
    Ok(())
}
```

- [ ] **Step 3: Build to verify it compiles**

```bash
cargo build --manifest-path packages/desktop-app/src-cli/Cargo.toml
```

Expected: compiles without errors. Fix any import issues (check that `everr_core::state::UserProfile` is pub and that `resolve_git_context` is accessible — check `everr_core/src/git.rs` for the exact module path).

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/src-cli/src/setup.rs
git commit -m "feat: add notification email configuration step to everr setup"
```

---

## Task 5: Refactor notifier to tenant-scope SSE with client-side filtering

**Files:**
- Modify: `packages/desktop-app/src-tauri/src/notifications.rs`

- [ ] **Step 1: Rewrite `run_sse_notifier` to use tenant scope**

Replace the `run_sse_notifier` function. Key changes: remove git_email dependency for subscription, build email set from `notification_emails` with `user_profile.email` as fallback, subscribe to `"tenant"` scope, filter client-side:

```rust
async fn run_sse_notifier(app: &AppHandle, state: &RuntimeState) -> Result<()> {
    let Some(session) = current_app_state(state)?.session else {
        clear_tray_snapshot(app, state)?;
        state.session_changed.notified().await;
        return Ok(());
    };
    if session.api_base_url.trim_end_matches('/') != current_base_url().trim_end_matches('/') {
        clear_tray_snapshot(app, state)?;
        state.session_changed.notified().await;
        return Ok(());
    }

    // Build email filter set: configured list, falling back to cached profile email
    let email_set: std::collections::HashSet<String> = {
        let settings = current_app_state(state)?.settings;
        if !settings.notification_emails.is_empty() {
            settings.notification_emails.into_iter().collect()
        } else if let Some(profile) = settings.user_profile {
            std::iter::once(profile.email).collect()
        } else {
            // No emails configured and no profile cached — wait for session change
            clear_tray_snapshot(app, state)?;
            state.session_changed.notified().await;
            return Ok(());
        }
    };

    // Resolve git context for repo/branch scoping (still used by handle_notify_event)
    let current_dir = std::env::current_dir().context("failed to resolve cwd")?;
    let git = resolve_git_context(&current_dir);

    let client = ApiClient::from_session(&session)?;
    let stream = client.events_stream("tenant", None).await?;

    let mut known_failures: std::collections::HashMap<String, FailureNotification> =
        std::collections::HashMap::new();

    tokio::pin!(stream);
    loop {
        tokio::select! {
            event = stream.next() => {
                match event {
                    Some(Ok(payload)) => {
                        // Filter client-side by configured emails
                        if let Some(ref author_email) = payload.author_email {
                            if !email_set.contains(author_email) {
                                continue;
                            }
                        }
                        handle_notify_event(
                            app,
                            state,
                            &client,
                            &mut known_failures,
                            payload,
                            git.repo.as_deref(),
                            git.branch.as_deref(),
                        ).await?;
                    }
                    Some(Err(e)) => return Err(e),
                    None => break,
                }
            }
            _ = state.session_changed.notified() => {
                dbg_notifier!("session changed — restarting SSE loop");
                break;
            }
        }
    }

    Ok(())
}
```

- [ ] **Step 2: Build to verify it compiles**

```bash
cargo build --manifest-path packages/desktop-app/src-tauri/Cargo.toml
```

Expected: compiles. If `current_app_state` is not in scope, check its import path in `notifications.rs`.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop-app/src-tauri/src/notifications.rs
git commit -m "feat: switch notifier to tenant-scope SSE with client-side email filtering"
```

---

## Task 6: Add Tauri commands for email management + wizard backfill

**Files:**
- Modify: `packages/desktop-app/src-tauri/src/commands.rs`
- Modify: `packages/desktop-app/src-tauri/src/lib.rs`

- [ ] **Step 1: Add `get_notification_emails` command**

In `commands.rs`, add:

```rust
#[tauri::command]
pub(crate) async fn get_notification_emails(
    state: State<'_, RuntimeState>,
) -> CommandResult<Vec<String>> {
    let state = state.inner().clone();
    run_blocking_command(move || {
        Ok(current_app_state(&state)?.settings.notification_emails)
    })
    .await
}
```

- [ ] **Step 2: Add `set_notification_emails` command**

```rust
#[tauri::command]
pub(crate) async fn set_notification_emails(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    emails: Vec<String>,
) -> CommandResult<()> {
    let runtime = state.inner().clone();
    run_blocking_command(move || {
        update_settings(&runtime, |settings| {
            settings.notification_emails = emails;
        })
    })
    .await?;
    emit_settings_changed(&app);
    Ok(())
}
```

- [ ] **Step 3: Add `get_user_profile` command**

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct UserProfileResponse {
    pub email: String,
    pub name: String,
    pub profile_url: Option<String>,
}

#[tauri::command]
pub(crate) async fn get_user_profile(
    state: State<'_, RuntimeState>,
) -> CommandResult<Option<UserProfileResponse>> {
    let state = state.inner().clone();
    run_blocking_command(move || {
        let profile = current_app_state(&state)?.settings.user_profile;
        Ok(profile.map(|p| UserProfileResponse {
            email: p.email,
            name: p.name,
            profile_url: p.profile_url,
        }))
    })
    .await
}
```

- [ ] **Step 4: Update `complete_setup_wizard` to cache user profile**

Replace the existing `complete_setup_wizard` function. It now silently fetches and caches the user profile (so the settings UI can show name/avatar), but does **not** touch `notification_emails`:

```rust
#[tauri::command]
pub(crate) async fn complete_setup_wizard(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> CommandResult<WizardStatusResponse> {
    let runtime = state.inner().clone();

    // Silently cache user profile for the desktop app settings UI
    if let Ok(current) = current_app_state(&runtime) {
        if current.settings.user_profile.is_none() {
            if let Some(session) = current.session {
                if let Ok(client) = ApiClient::from_session(&session) {
                    if let Ok(me) = client.get_me().await {
                        let _ = run_blocking_command({
                            let runtime = runtime.clone();
                            move || {
                                update_settings(&runtime, |settings| {
                                    settings.user_profile =
                                        Some(everr_core::state::UserProfile {
                                            email: me.email,
                                            name: me.name,
                                            profile_url: me.profile_url,
                                        });
                                })
                            }
                        })
                        .await;
                    }
                }
            }
        }
    }

    let response = run_blocking_command(move || {
        if !has_active_session_for_current_base_url(&runtime)? {
            return Err(anyhow!("Sign in before finishing setup."));
        }
        update_settings(&runtime, |settings| {
            settings.mark_setup_complete(build::default_api_base_url());
        })?;
        wizard_status_response(&runtime)
    })
    .await?;

    emit_settings_changed(&app);
    Ok(response)
}
```

Note: `ApiClient` must be imported in `commands.rs`. Check the existing imports — if it's not there, add `use everr_core::api::ApiClient;`.

- [ ] **Step 5: Register new commands in `lib.rs`**

In `packages/desktop-app/src-tauri/src/lib.rs`, add to the `generate_handler!` list:

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
])
```

- [ ] **Step 6: Build to verify it compiles**

```bash
cargo build --manifest-path packages/desktop-app/src-tauri/Cargo.toml
```

Expected: compiles without errors.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop-app/src-tauri/src/commands.rs packages/desktop-app/src-tauri/src/notifications.rs packages/desktop-app/src-tauri/src/lib.rs
git commit -m "feat: add Tauri commands for notification email management and profile caching"
```

---

## Task 7: Desktop settings UI — NotificationEmailsSection

**Files:**
- Create: `packages/desktop-app/src/features/notifications/notification-emails-section.tsx`
- Modify: `packages/desktop-app/src/features/desktop-shell/desktop-window.tsx`

- [ ] **Step 1: Create `NotificationEmailsSection` component**

Create `packages/desktop-app/src/features/notifications/notification-emails-section.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { invokeCommand } from "../../lib/tauri";
import { FeatureErrorText, FeatureLoadingText, SettingsSection } from "../desktop-shell/ui";

type UserProfile = {
  email: string;
  name: string;
  profile_url: string | null;
};

function getNotificationEmails() {
  return invokeCommand<string[]>("get_notification_emails");
}

function setNotificationEmails(emails: string[]) {
  return invokeCommand<void>("set_notification_emails", { emails });
}

function getUserProfile() {
  return invokeCommand<UserProfile | null>("get_user_profile");
}

const notificationEmailsQueryKey = ["desktop-app", "notification-emails"] as const;
const userProfileQueryKey = ["desktop-app", "user-profile"] as const;

export function NotificationEmailsSection() {
  const queryClient = useQueryClient();
  const [newEmail, setNewEmail] = useState("");

  const emailsQuery = useQuery({
    queryKey: notificationEmailsQueryKey,
    queryFn: getNotificationEmails,
  });

  const profileQuery = useQuery({
    queryKey: userProfileQueryKey,
    queryFn: getUserProfile,
  });

  const mutation = useMutation({
    mutationFn: setNotificationEmails,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationEmailsQueryKey });
    },
  });

  if (emailsQuery.isLoading) return <FeatureLoadingText />;
  if (emailsQuery.isError) return <FeatureErrorText />;

  const emails = emailsQuery.data ?? [];
  const profile = profileQuery.data;

  function addEmail() {
    const trimmed = newEmail.trim();
    if (!trimmed || emails.includes(trimmed)) return;
    mutation.mutate([...emails, trimmed]);
    setNewEmail("");
  }

  function removeEmail(email: string) {
    mutation.mutate(emails.filter((e) => e !== email));
  }

  return (
    <SettingsSection
      title="Notifications"
      description="These emails are used locally to filter notifications — they're never sent to our servers."
    >
      {profile && (
        <div className="flex items-center gap-2 mb-3">
          {profile.profile_url && (
            <img
              src={profile.profile_url}
              alt={profile.name}
              className="w-6 h-6 rounded-full"
            />
          )}
          <span className="text-sm text-[var(--settings-text)]">{profile.name}</span>
        </div>
      )}

      <div className="flex flex-col gap-1 mb-3">
        {emails.map((email) => (
          <div key={email} className="flex items-center justify-between text-sm">
            <span className="text-[var(--settings-text)]">{email}</span>
            <button
              onClick={() => removeEmail(email)}
              className="text-[var(--settings-text-muted)] hover:text-[var(--settings-text)] text-xs"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addEmail()}
          placeholder="Add email"
          className="flex-1 text-sm bg-transparent border border-[var(--settings-border-soft)] rounded px-2 py-1 text-[var(--settings-text)]"
        />
        <button
          onClick={addEmail}
          disabled={!newEmail.trim()}
          className="text-sm px-3 py-1 rounded border border-[var(--settings-border-soft)] text-[var(--settings-text)] disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </SettingsSection>
  );
}
```

- [ ] **Step 2: Add `NotificationEmailsSection` to `SettingsScreen`**

In `packages/desktop-app/src/features/desktop-shell/desktop-window.tsx`, import and add the new section:

```tsx
import { NotificationEmailsSection } from "../notifications/notification-emails-section";
```

In the `SettingsScreen` function, add it after `AssistantsSection`:

```tsx
function SettingsScreen() {
  return (
    <div className="grid divide-y divide-white/[0.06]">
      <div className="pt-0">
        <AuthSettingsSection />
      </div>
      <AssistantsSection />
      <NotificationEmailsSection />
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

- [ ] **Step 3: Build the frontend to verify it compiles**

```bash
cd packages/desktop-app && pnpm frontend:build
```

Expected: builds without TypeScript errors. If CSS variables like `--settings-text-muted` don't exist, check `desktop-window.tsx` or global styles and use whichever variable is used for muted text in the existing components.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop-app/src/features/notifications/notification-emails-section.tsx packages/desktop-app/src/features/desktop-shell/desktop-window.tsx
git commit -m "feat: add notification emails section to desktop settings"
```

---

## Task 8: Final build and push

- [ ] **Step 1: Run the full CLI test suite**

```bash
cargo test --manifest-path packages/desktop-app/src-cli/Cargo.toml
```

Expected: all tests pass.

- [ ] **Step 2: Run the app server tests**

```bash
cd packages/app && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Build the full desktop app**

```bash
cd packages/desktop-app && npm run build:desktop
```

Expected: app builds and signs successfully.

- [ ] **Step 4: Push and open PR**

```bash
git push
```
