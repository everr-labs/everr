# @everr/desktop-app

## 0.4.6

### Patch Changes

- f066c2a: Fix `everr local start` on Linux by embedding the collector and chDB assets in the published Linux CLI release (the build now fails if the assets are missing). Also make the install script configure your shell PATH automatically instead of only printing a hint.

## 0.4.5

### Patch Changes

- 7220fea: Add project-scoped alert definitions and notebook runbook links in alert views and Slack/Telegram notifications.
- 851624e: Update bundled alert skills, docs, and example Everr definitions for runbook-linked alerts and the `everr/` apply tree.
- 72d7209: Separate the capabilities of `ek_` API keys into two scopes: `ingest` (send
  OpenTelemetry data) and `apply` (run `everr apply` against dashboards,
  notebooks, and alerts). The collector's verify endpoint and the apply
  endpoint each check the matching scope; a key minted for one capability
  is now refused when used for the other.

  - New keys are minted with both scopes checked by default, but the
    **New API key** dialog now exposes a Capabilities section so you can
    mint a key with just one scope (for example, an `ingest`-only key for a
    public collector, or an `apply`-only deploy key for CI).
  - Keys minted before this change keep working — a key with no scope map
    is treated as fully scoped.
  - The Ingest Keys page is now called **API keys** (the old `/ingest-keys`
    URL redirects), and its table gains a per-row Capabilities column so you
    can see what each key is authorized for.
  - The CLI now reads `EVERR_API_KEY` for the apply command (preferred).
    `EVERR_API_TOKEN` is still accepted as a deprecated alias so existing
    CI setups keep working.

- e1fe7cc: Preserve collector failure reason (exit status, spawn error) in telemetry as `everr.collector.failure_reason` attribute instead of discarding it.
- e5b4c53: Suppress expected production telemetry noise from auth/control-flow paths, SQL API query errors, stale GitHub installations, and desktop notifier reconnects.

## 0.4.4

### Patch Changes

- 5a228b6: Fix a crash when opening the Errors page in the desktop app with no Service filter selected (the shared Service/Environment filters read an undefined value).

## 0.4.3

### Patch Changes

- 28e8199: Retry release with NPM_TOKEN authentication.
- Updated dependencies [28e8199]
  - @everr/auto-otel-errors@0.2.3

## 0.4.2

### Patch Changes

- 6b94d92: Retry release with NPM_TOKEN authentication.
- Updated dependencies [6b94d92]
  - @everr/auto-otel-errors@0.2.2

## 0.4.1

### Patch Changes

- 34d39ac: Fix npm package publishing to use trusted publishing.
- Updated dependencies [34d39ac]
  - @everr/auto-otel-errors@0.2.1

## 0.4.0

### Minor Changes

- 8bd4e84: Add a shared Explore topbar to the desktop app: Service and Environment filters move out of each page's sidebar into a toolbar above Logs, Errors, and Traces, and persist as you navigate between the three pages.

### Patch Changes

- Updated dependencies [34e86aa]
  - @everr/auto-otel-errors@0.2.0

## 0.3.2

### Patch Changes

- 84b0397: Temporarily disable everr-action release pipeline (bundled CLI binary exceeds GitHub 100 MB file limit)

## 0.3.1

### Patch Changes

- 47014e1: Publish bundled CLI assets to the action repository during desktop releases and let the action install the matching bundled CLI for supported runners.
- 12d63c0: Keep trace and error lists mounted while opening detail dialogs so closing a detail preserves the list state, and reserve the macOS titlebar space in windowed dialogs.

## 0.1.31

### Patch Changes

- 7eb2635: Refresh stale query data when the window regains focus and cap cached
  results at 30s instead of holding them forever. Previously the desktop
  app kept the first response in memory indefinitely and never refetched
  when reopened, so runs and notification settings could appear out of
  date until the app was restarted.
