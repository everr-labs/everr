# Web session recordings

In Cloud, when a browser session recording (a Clip) covers a trace or an error, the trace view (`/traces/<trace id>`, between the toolbar and the flamegraph) and the error detail (first, above the stack trace) show a `Session recording` section: a `Play` button, the Clip's length and start time, a trigger badge (`ERROR TRIGGER`, `NETWORK TRIGGER`, `MANUAL TRIGGER`), `TRUNCATED` when the buffer did not reach back to the requested start, gap badges (`1 missing segment`), and a `Clip` picker when several Clips cover the record. The page looks up the covering Clips with the `getCoveringClips` server function; the Clip's events load through `getClipEvents` only when `Play` is pressed, and playback starts 10 s before the trace or the error. The traces and errors lists have a `With session recording` switch in their filter rail (`withRecording=true` in the URL) that keeps exactly the rows whose detail plays a recording. The self-hosted App shows neither the switch nor the section.

## Sub-features

- `replay-filter-traces` on `/traces`, the `With session recording` switch adds `withRecording=true` and lists `GET /verify-api/checkout`; rows without a recording (the seeded `POST /checkout`) leave the list.
- `replay-filter-errors` on `/errors`, the same switch lists `VerifySdkError: checkout exploded` and drops `VerifySeedPaymentError`.
- `replay-invariant` every row of a filtered list opens a detail that shows the `Session recording` section.
- `replay-lazy` opening a detail calls `getCoveringClips` and never `getClipEvents` before `Play`.
- `replay-play` `Play` loads the events once, the player runs, the button turns into `Pause`, and the clock advances.
- `replay-masking` text in the replay iframe is masked (asterisks), and the iframe's `sandbox` is `allow-same-origin` only (no scripts).
- `replay-gaps` the trigger, `TRUNCATED` and gap badges match the stored `recording` span and Segment indexes.
- `replay-no-loop` with the default range (`Last 7 days`), an open detail settles: at most 10 server function calls in 10 s.
- `replay-hidden-self-hosted` the App draws no switch and no section, even with `withRecording=true` in the URL.

## How to get to it (user POV)

- `/traces`, turn on `With session recording` in the filter rail, click `GET /verify-api/checkout`.
- `/errors`, turn on `With session recording`, click `VerifySdkError: checkout exploded`.

## Driving it with verify-web-app

Preconditions:

- A Cloud run (the `web-launch` default), signed in, in a checkout with session replay (`web-sdk-page` prints `recording=on`).
- `web-browser-sdk.md` "Errors, network, recording" ran in this run, and its `sdk-recordings` row shows a clip.
- For the "rows without a recording" checks: `web-explore.md` seeded data in this run (`web-seed`). Without it, report those two checks as skipped.
- For `replay-hidden-self-hosted`: an App session on `$APP_WEB` (`web-installation.md`, or a `--app app` run).

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
    for H in $HREFS; do
      agent-browser open "$WEB$H" && agent-browser wait --timeout 30000 'section[aria-label="Session recording"]' || { echo "MISSING $H" >> "$SHOTS/replay-05-invariant.txt"; MISSING=$((MISSING + 1)); }
    done
  done
  cat "$SHOTS/replay-05-invariant.txt"; test "$MISSING" = 0
  ```

  The `test` exits `0`, and `replay-05-invariant.txt` lists at least one row per list and no `MISSING` line (`replay-invariant`).
- **Lazy lookup.** Open the error from the filtered list without hovering `Play`, then measure a reload:

  ```bash
  agent-browser open "$WEB/errors?withRecording=true" && agent-browser find text "VerifySdkError: checkout exploded" click
  agent-browser wait 'section[aria-label="Session recording"] button[aria-label="Play"]' && agent-browser wait --text "TRIGGER" && ab_save replay-06-error-detail "Error detail: Session recording section with a trigger badge and Play"
  $V web-net replay-lazy 8 --reload
  grep -q getCoveringClips "$SHOTS/../net/replay-lazy.serverfn.txt" && ! grep -q getClipEvents "$SHOTS/../net/replay-lazy.serverfn.txt"
  ```

  Exit `0` (`replay-lazy`).
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
  $V web-ch replay-clips "SELECT toString(SpanAttributes.everr.recording.clip.id) AS clip, toString(SpanAttributes.everr.recording.trigger) AS trigger, toString(SpanAttributes.everr.recording.clip.truncated) AS truncated FROM app.traces WHERE ServiceName = 'verify-sdk-web' AND SpanName = 'recording'"
  $V web-ch replay-segments "SELECT stream_id, arraySort(groupUniqArray(segment_index)) AS indexes FROM app.recordings WHERE ServiceName = 'verify-sdk-web' GROUP BY stream_id"
  agent-browser get text 'section[aria-label="Session recording"]'
  ```

  The section shows `<trigger> TRIGGER` for the Clip's trigger, `TRUNCATED` only when `truncated` is `true`, and `<n> missing segment` only when `indexes` skips `n` numbers (`replay-gaps`).
- **No refetch loop.** With the error detail open on the default range, run `$V web-net replay-no-loop 10`. The `NET` line has `serverfn=` at most `10` (`replay-no-loop`). A count in the hundreds is a refetch loop: a query key changes every render. Report it as a failure with the count.
- **Trace view.** Run:

  ```bash
  agent-browser open "$WEB/traces?withRecording=true" && agent-browser find text "/verify-api/checkout" click && agent-browser wait --fn "location.pathname.startsWith('/traces/')"
  agent-browser wait 'section[aria-label="Session recording"] button[aria-label="Play"]' && agent-browser wait --text "TRIGGER" && ab_save replay-08-trace "Trace view: Session recording section above the flamegraph"
  ```

  Exit `0`; `replay-08-trace.txt` has `GET /verify-api/checkout` and a `TRIGGER` badge.
- **Hidden on self-hosted.** With the App session, run:

  ```bash
  agent-browser open "$APP_WEB/traces?withRecording=true" && agent-browser wait --text "Min ms" && agent-browser wait --fn "!document.body.innerText.includes('With session recording')" && ab_save replay-09-app-traces "App traces: no session recording switch"
  agent-browser open "$APP_WEB/errors?withRecording=true" && agent-browser wait '[aria-label="Last seen"]' && agent-browser wait --fn "!document.body.innerText.includes('With session recording')" && ab_save replay-10-app-errors "App errors: no session recording switch"
  ```

  Every command exits `0`. If the App has traces, open one: it has no `section[aria-label="Session recording"]` (`replay-hidden-self-hosted`).
- **Proof.** `web/replay-*`, `net/replay-lazy.*`, `net/replay-no-loop.*`, `db/replay-clips/`, `db/replay-segments/`, `db/sdk-recordings/`.

## Gotchas

- `agent-browser click` moves the pointer over `Play` first, and hovering `Play` prefetches the events. Measure `replay-lazy` before any click or hover on `Play`.
- A Clip lands about 10 s after the error that triggered it (60 s for a manual Clip). The lookup is cached for the browser session: a detail opened before the Clip landed shows no section until a full reload.
- The lists filter within the selected time range: a trace whose recorded span starts outside the range is not listed, though its detail still plays.
- The `recording` trace is listed under the filter and plays its own Clip; that is expected.
- When the error and the failed request share a Clip, both details show `ERROR TRIGGER`. Assert on `TRIGGER`.
- The badges are uppercase through CSS. `get text` returns them uppercase, the DOM text is lowercase (`error trigger`).
- Never click `Accept all` on the consent banner; run `$V web-onboard` (answers `Deny`) before screenshots.
