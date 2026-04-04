# Notification Emails Configuration

**Date:** 2026-04-04
**Appetite:** Small

## Problem

The desktop app notifier currently subscribes to the SSE stream filtered by a single git author email. Users who commit with multiple emails, or whose git email differs from their Everr account email, miss notifications. There is also no way to configure or inspect which email is being used.

## Design

### Data Model

Add `notification_emails: Vec<String>` to `AppSettings` in the `everr-core` crate, persisted in `~/.config/everr/app.json`. No server-side storage. Emails are used locally only and never sent to Everr servers.

### API: `GET /me`

New server endpoint returning the authenticated user's profile from WorkOS. Auth via existing access token middleware.

**Response:**
```json
{
  "email": "user@example.com",
  "name": "User Name",
  "profileUrl": "https://..."
}
```

New `ApiClient` method in the CLI crate. Also covers the `show-logged-in-user-info-desktop` idea.

### CLI Setup Step

New `step_configure_notification_emails()` inserted after `step_authenticate()` in `everr setup`:

1. Fetch `GET /me` → Everr account email
2. Read git config email via existing `resolve_git_context`
3. Deduplicate, pre-populate the list
4. Show an editable multi-value prompt with the note: *"These emails are used locally to filter notifications — they're never sent to our servers."*
5. Save to `AppSettings`

If either source fails, fall back gracefully to whatever is available.

### Desktop Wizard

No new wizard step. After `AuthWizardStep` completes, silently:

1. Fetch `GET /me` → Everr email
2. Read git config email
3. Deduplicate and save to `AppSettings`

Fire-and-forget — no blocking or error shown on failure.

### Desktop Settings

New "Notifications" section in the desktop app settings UI:

- Logged-in user's name and profile picture (from `GET /me`, cached in `AppSettings`)
- Configurable email list (add/remove)
- Privacy note: *"These emails are used locally to filter notifications — they're never sent to our servers."*

### Notifier

Switch SSE subscription from `scope=author&key={git_email}` to `scope=tenant`. Filter events client-side by checking `event.author_email` against `AppSettings.notification_emails`.

**Backfill on empty list:** If `notification_emails` is empty at notifier startup (existing install predating this feature), backfill by calling `GET /me` + git config email, save to `AppSettings`, then proceed. Ensures no degraded experience for existing users.

**Failure resolution fix:** Success events for any configured email alias now correctly clear the corresponding tray failure — previously this only worked for the single subscribed email.

## Out of Scope

- Server-side storage or cross-device sync of email preferences
- `everr config emails` subcommand (desktop settings covers this)
- Web onboarding changes
