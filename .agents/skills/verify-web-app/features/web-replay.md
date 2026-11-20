# Web session recordings

When a browser session recording (a Clip) covers a trace or an error, the trace view (`/traces/<trace id>`, a resizable panel between the toolbar and the flamegraph) and the error detail (below the stack trace) show a `Session recording` section: a header with the Clip's length and start time, a trigger badge (`ERROR TRIGGER`, `NETWORK TRIGGER`, `MANUAL TRIGGER`), gap badges (`1 missing segment`), and a `Clip` picker when several Clips cover the record, then the picture and a control bar with `Play`/`Pause`, the playback clock and the seek track. The page looks up the covering Clips with the `getCoveringClips` server function and loads a Clip's events through `getClipEvents`. Playback starts 10 s before the trace or the error and runs to the Clip's end. A click on the picture plays or pauses. In the trace view the closed player is one row that opens and closes like the `Flamegraph` row: the whole row is a toggle button (`aria-expanded`, a chevron). Opening it loads the events and opens it, paused, to 40% of the space below the toolbar; the `Resize session recording and trace` handle sets its height, and the row or a drag past its minimum closes it back to the row. The error detail opens with the player open and paused at its start, so its events load with the page; `Hide` and `Show` close and reopen it. Opening and closing ease the player, and the `Flamegraph` row eases the same way. While the player moves, the picture keeps its size and the panel edge uncovers or covers it. With reduced motion the size changes at once and the picture fades. The traces and errors lists have a `With session recording` switch in their filter rail (`withRecording=true` in the URL) that keeps the rows a Clip covers within the search window (see Gotchas).

## Sub-features

- `replay-filter-traces` on `/traces`, the `With session recording` switch adds `withRecording=true` and lists `GET /verify-api/checkout`; rows without a recording (the seeded `POST /checkout`) leave the list.
- `replay-filter-errors` on `/errors`, the same switch lists `VerifySdkError: checkout exploded` and drops `VerifySeedPaymentError`.
- `replay-invariant` every row of a filtered list opens a detail that shows the `Session recording` section.
- `replay-lazy` opening a trace view calls `getCoveringClips` and never `getClipEvents` before the recording row is opened or hovered.
- `replay-error-detail` the error detail draws the section below the stack trace, open and paused, and loads the Clip's events with the page.
- `replay-play` `Play` in the control bar runs the player, the button turns into `Pause`, and the clock advances.
- `replay-split` in the trace view the closed player is 32px tall with `aria-expanded=false`, the row opens it with an animation that keeps the picture at its open size, the handle resizes it, and the row returns it to 32px; opening it again restores the height it had.
- `replay-masking` text in the replay iframe is masked (asterisks), and the iframe's `sandbox` is `allow-same-origin` only (no scripts).
- `replay-gaps` the trigger and gap badges match the stored `recording` span and Segment indexes.
- `replay-no-loop` with the default range (`Last 7 days`), an open detail settles: at most 10 server function calls in 10 s.

## How to get to it (user POV)

- `/traces`, turn on `With session recording` in the filter rail, click `GET /verify-api/checkout`.
- `/errors`, turn on `With session recording`, click `VerifySdkError: checkout exploded`.

## Driving it with verify-web-app

Preconditions:

- A signed-in run of either product, Cloud (the `web-launch` default) or the self-hosted App (`web-launch --app app`, after `web-installation.md`), in a checkout with session replay (`web-sdk-page` prints `recording=on`). The recipes below are the same on both.
- `web-browser-sdk.md` "Errors, network, recording" ran in this run, and its `sdk-recordings` row shows a clip.
- For the "rows without a recording" checks: `web-explore.md` seeded data in this run (`web-seed`). Without it, report those two checks as skipped.

- **Traces filter.** Run:

  ```bash
  agent-browser open "$WEB/traces" && agent-browser wait --text "/verify-api/checkout" && ab_save replay-01-traces "Traces list before the filter"
  agent-browser find role switch click --name "With session recording" && agent-browser wait --fn "location.search.includes('withRecording=true')"
  agent-browser wait --text "/verify-api/checkout" && agent-browser wait --fn "!document.body.innerText.includes('POST /checkout')" && ab_save replay-02-traces-filtered "With session recording on: the checkout trace stays, the seeded trace leaves"
  ```

  Every command exits `0`. `replay-02-traces-filtered.txt` lists `GET /verify-api/checkout` and the `recording` trace (a Clip covers its own span) (`replay-filter-traces`).
- **Errors filter.** Run:

  ```bash
  agent-browser open "$WEB/errors" && agent-browser wait --text "VerifySdkError" && ab_save replay-03-errors "Errors list before the filter"
  agent-browser find role switch click --name "With session recording" && agent-browser wait --fn "location.search.includes('withRecording=true')"
  agent-browser wait --text "VerifySdkError: checkout exploded" && agent-browser wait --fn "!document.body.innerText.includes('VerifySeedPaymentError')" && ab_save replay-04-errors-filtered "With session recording on: the SDK error stays, the seeded error leaves"
  ```

  Every command exits `0` (`replay-filter-errors`).
- **Every filtered row plays.** Run:

  ```bash
  ROWS='[...new Set([...document.querySelectorAll("a[href^=\"/PREFIX/\"]")].map((a) => a.getAttribute("href")))].join(" ")'
  MISSING=0
  for P in traces errors; do
    agent-browser open "$WEB/$P?withRecording=true" && agent-browser wait --text "matching"
    HREFS=$(agent-browser eval "${ROWS/PREFIX/$P}" | tr -d '"'); echo "$P: $HREFS" >> "$SHOTS/replay-05-invariant.txt"
    [ -n "$HREFS" ] || { echo "EMPTY $P" >> "$SHOTS/replay-05-invariant.txt"; MISSING=$((MISSING + 1)); }
    for H in $HREFS; do
      agent-browser open "$WEB$H" && agent-browser wait --timeout 30000 'section[aria-label="Session recording"]' || { echo "MISSING $H" >> "$SHOTS/replay-05-invariant.txt"; MISSING=$((MISSING + 1)); }
    done
  done
  cat "$SHOTS/replay-05-invariant.txt"; test "$MISSING" = 0
  ```

  The `test` exits `0`, and `replay-05-invariant.txt` lists at least one row per list and no `EMPTY` or `MISSING` line (`replay-invariant`).
- **Lazy lookup.** Open the checkout trace from the filtered list without hovering the recording row, then measure a reload:

  ```bash
  agent-browser open "$WEB/traces?withRecording=true" && agent-browser wait --text "/verify-api/checkout"
  agent-browser find text "/verify-api/checkout" click && agent-browser wait --fn "location.pathname.startsWith('/traces/')"
  agent-browser wait 'section[aria-label="Session recording"] button[aria-expanded="false"]' && agent-browser wait --text "TRIGGER"
  $V web-net replay-lazy 8 --reload
  grep -q getCoveringClips "$SHOTS/../net/replay-lazy.serverfn.txt" && ! grep -q getClipEvents "$SHOTS/../net/replay-lazy.serverfn.txt"
  ```

  Exit `0` (`replay-lazy`).
- **Error detail.** Run:

  ```bash
  S='section[aria-label="Session recording"]'
  agent-browser open "$WEB/errors?withRecording=true" && agent-browser wait --text "VerifySdkError: checkout exploded" && agent-browser find text "VerifySdkError: checkout exploded" click
  agent-browser wait "$S iframe" && agent-browser wait "$S button[aria-label=\"Play\"]" && ab_save replay-06-error-detail "Error detail: Session recording below the stack trace, open and paused"
  agent-browser eval "[...document.querySelectorAll('h2')].find((h) => h.textContent === 'Stack trace').compareDocumentPosition(document.querySelector('$S')) === Node.DOCUMENT_POSITION_FOLLOWING"
  $V web-net replay-error-open 8 --reload
  grep -q getClipEvents "$SHOTS/../net/replay-error-open.serverfn.txt"
  ```

  Every command exits `0`; the `eval` prints `true`, and the section shows `Play`, not `Pause` (`replay-error-detail`).
- **Play.** Run:

  ```bash
  S='section[aria-label="Session recording"]'
  agent-browser network requests --clear
  agent-browser click "$S button[aria-label=\"Play\"]" && agent-browser wait --timeout 30000 "$S button[aria-label=\"Pause\"]" && agent-browser wait "$S iframe"
  A=$(agent-browser get text "$S"); sleep 3; B=$(agent-browser get text "$S"); echo "$A | $B"; test "$A" != "$B"
  ab_save replay-07-playing "Playing: Pause shown, the masked page in the player"
  agent-browser eval "document.querySelector('$S iframe').getAttribute('sandbox')"
  agent-browser eval "document.querySelector('$S iframe').contentDocument.body.innerText"
  ```

  Every command exits `0`; the clock (`m:ss / m:ss`) moved between the two reads (`replay-play`). The `sandbox` is `"allow-same-origin"`, and the iframe text is asterisks with none of the page's words; `replay-07-playing.png` shows the page (`replay-masking`).
- **Badges against the data.** Run:

  ```bash
  $V web-ch replay-clips "SELECT toString(SpanAttributes.everr.recording.clip.id) AS clip, toString(SpanAttributes.everr.recording.trigger) AS trigger FROM app.traces WHERE ServiceName = 'verify-sdk-web' AND SpanName = 'recording'"
  $V web-ch replay-segments "SELECT stream_id, arraySort(groupUniqArray(segment_index)) AS indexes FROM app.recordings WHERE ServiceName = 'verify-sdk-web' GROUP BY stream_id"
  agent-browser get text 'section[aria-label="Session recording"]'
  ```

  The section shows `<trigger> TRIGGER` for the Clip's trigger and `<n> missing segment` only when `indexes` skips `n` numbers (`replay-gaps`).
- **No refetch loop.** With the error detail open on the default range, run `$V web-net replay-no-loop 10`. The `NET` line has `serverfn=` at most `10` (`replay-no-loop`). A count in the hundreds is a refetch loop: a query key changes every render. Report it as a failure with the count.
- **Trace view.** Run:

  ```bash
  agent-browser open "$WEB/traces?withRecording=true" && agent-browser find text "/verify-api/checkout" click && agent-browser wait --fn "location.pathname.startsWith('/traces/')"
  agent-browser wait 'section[aria-label="Session recording"] button[aria-expanded="false"]' && agent-browser wait --text "TRIGGER" && ab_save replay-08-trace "Trace view: the closed Session recording row above the flamegraph"
  ```

  Exit `0`; `replay-08-trace.txt` has `GET /verify-api/checkout` and a `TRIGGER` badge.
- **Split.** On that trace view, run:

  ```bash
  S='section[aria-label="Session recording"]'
  H="Math.round(document.querySelector('$S').closest('[data-panel]').getBoundingClientRect().height)"
  agent-browser eval "$H"
  agent-browser eval "new Promise((done) => { const s = document.querySelector('$S'); const p = s.closest('[data-panel]'); s.querySelector('button[aria-expanded]').click(); requestAnimationFrame(() => done([p.getAnimations().length, Math.round(p.getBoundingClientRect().height), Math.round(p.firstElementChild.getBoundingClientRect().height)].join(' '))); })"
  agent-browser wait "$S iframe" && agent-browser eval "$H"
  agent-browser wait "$S button[aria-label=\"Play\"]" && agent-browser click "$S button[aria-expanded=\"true\"]" && sleep 0.5 && agent-browser eval "$H"
  ```

  The heights are `32`, then about 40% of the space below the toolbar, then `32` again (`replay-split`). The line after the click reads `<animations> <panel> <content>`: at least `1` animation, and a content height above the panel height, because the player is laid out at its open height while the panel grows around it.
- **Proof.** `web/replay-*`, `net/replay-lazy.*`, `net/replay-error-open.*`, `net/replay-no-loop.*`, `db/replay-clips/`, `db/replay-segments/`, `db/sdk-recordings/`.

## Gotchas

- `agent-browser click` moves the pointer over its target first, and hovering the trace view's recording row prefetches the events. Measure `replay-lazy` before any click or hover on that row.
- A Clip lands about 10 s after the error that triggered it (60 s for a manual Clip). An empty lookup goes stale after 30 seconds, so a detail opened before the Clip landed shows the section after the next remount, window focus or auto refresh tick, without a full reload.
- The lists filter within the selected time range: a trace whose recorded span starts outside the range is not listed, though its detail still plays.
- The `recording` trace is listed under the filter and plays its own Clip; that is expected.
- When the error and the failed request share a Clip, both details show `ERROR TRIGGER`. Assert on `TRIGGER`.
- The badges are uppercase through CSS. `get text` returns them uppercase, the DOM text is lowercase (`error trigger`).
- Never click `Accept all` on the consent banner; run `$V web-onboard` (answers `Deny`) before screenshots.
