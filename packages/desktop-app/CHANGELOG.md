# @everr/desktop-app

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
