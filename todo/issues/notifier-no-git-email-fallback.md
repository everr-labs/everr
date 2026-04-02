---
What: Notifier bails when git email is missing — should fall back to Everr account email
Where: packages/desktop-app/src-tauri/src/notifications.rs — `run_sse_notifier`, the no-git-email early-exit guard
Steps to reproduce: Run the desktop app in a directory with no git config email set
Expected: Notifier subscribes to the event stream filtered by the user's Everr account email (fetched live from the API, no local storage)
Actual: Notifier clears the tray and waits indefinitely for a session change
Priority: low
Notes: When git email is available, filter by both git email and Everr account email. When it's missing, filter by Everr account email only. Requires a new API endpoint (e.g. GET /me) that returns the authenticated user's email.
