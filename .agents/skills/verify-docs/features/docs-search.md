# Docs search

A visitor searches the documentation from a dialog: a `Search` button in the header, or the keyboard shortcut. Typing shows matching pages and headings, and choosing a result opens that page. The dialog is backed by `GET /api/search?query=<text>`.

## Sub-features

- `search-open` opens the dialog from the header button and from the keyboard.
- `search-results` lists matching pages and passages for a query.
- `search-open-result` opens a result and closes the dialog.
- `search-empty` shows no results for a query that matches nothing.
- `search-close` closes the dialog with `Escape`.
- `search-api` answers the JSON endpoint the dialog uses.

## How to get to it (user POV)

- Choose the `Search` button (accessible name `Search the docs`) in the header, on any page.
- Press `Cmd+K` on macOS or `Ctrl+K` elsewhere.
- Request `/api/search?query=<text>`.

## Driving it with verify-docs

Preconditions:

- `$V doctor` ends with `DOCS DOCTOR OK`; `eval "$($V browser-env)"` and `agent-browser set viewport 1280 800` ran in this shell.
- Define the open-state reader once in the shell: `OPEN='document.querySelector("[role=dialog][data-state=open]") !== null'`.

- **Open from the button.** Run `agent-browser open $DOCS/docs`, `agent-browser wait --fn "$HYDRATED"`, then `agent-browser wait --text "What Everr is"`, then `agent-browser click "button[aria-label='Search the docs']"`. `agent-browser eval "$OPEN"` prints `true` and the dialog has a textbox named `Search` (`agent-browser snapshot -i` lists `textbox "Search"`).
- **Query.** Run `agent-browser fill "[role=dialog] input" "alert"` then `agent-browser wait --text "AlertRule Spec"`. The first result reads `Docs Reference AlertRule Spec` and others are passages from the same page. `ab_save search-01-results "Search for alert lists the AlertRule Spec page"`.
- **Open a result.** Run `agent-browser find role button click --name "Docs Reference AlertRule Spec"` then `agent-browser wait --fn "location.pathname === '/docs/reference/alert-spec'"`. `agent-browser eval "$OPEN"` prints `false` and the `h1` is `AlertRule Spec`.
- **Open from the keyboard.** Run `agent-browser press Meta+k` (use `Control+k` when `agent-browser eval navigator.platform` does not start with `Mac`). `agent-browser eval "$OPEN"` prints `true`.
- **Close.** Run `agent-browser press Escape`, then `agent-browser wait --fn "document.querySelector('[role=dialog][data-state=open]') === null"` , then `agent-browser screenshot "$SHOTS/_frame.png"`, `sleep 1` and a second screenshot so the dialog finishes its exit animation and unmounts (`agent-browser eval 'document.querySelectorAll("[role=dialog]").length'` prints `0`).
- **Empty.** Open the dialog again (`agent-browser click "button[aria-label='Search the docs']"`), then `agent-browser fill "[role=dialog] input" "zzzqqxx"`. No result buttons appear: `agent-browser wait --fn "document.querySelectorAll('[role=dialog] button').length <= 1"`, and `agent-browser eval 'document.querySelector("[role=dialog]").innerText'` ends with `No results found`. `ab_save search-02-empty "Search for zzzqqxx shows no results"`.
- **API.** Run `$V http search-api "/api/search?query=alert" --status 200 --contains "\"url\":\"/docs/reference/alert-spec\""`; the body is a JSON array of page and passage entries, with the matched text wrapped in `<mark>` (so `AlertRule Spec` appears as `<mark>Alert</mark>Rule Spec`). Run `$V http search-api-empty "/api/search?query=zzzqqxx" --status 200`; the body is `[]`.
- **No analytics leave.** After the browser steps, wait 10s and run `$V net search-network`: `unexpected=0`.

## Gotchas

- After closing, the `[role=dialog]` element stays in the DOM with `data-state="closed"` until its exit animation finishes, and headless Chrome finishes it only when a frame is produced (a screenshot). Measured: still mounted 7 s after `Escape`, gone after two screenshots a second apart. While it lingers the rest of the page is hidden from the accessibility tree, so `find role ... --name` fails for anything outside the dialog. Assert on `[data-state=open]`, never on the element's presence, and click by CSS selector or take a screenshot first.
- The `ESC` button inside the dialog is a button named `ESC`.
- The shortcut is `mod+k`: `Meta+k` in a macOS browser, `Control+k` on Linux. In headless Chrome on macOS the user agent is a Mac one, so `Control+k` did nothing there.
- Results are ranked by Orama over page titles, headings and passages; assert that the expected page is among the results, not that it is first or that the count is fixed.
- Search indexes `content/docs` only. Devlog posts and site pages are not in it.
- An empty `query=` answers `[]`, not an error.
