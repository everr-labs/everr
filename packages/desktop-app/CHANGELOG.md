# @everr/desktop-app

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
