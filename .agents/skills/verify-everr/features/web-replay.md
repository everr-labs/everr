# Web session replay player

When a browser clip exists for an error or a failed request, the error detail page (`/errors/<fingerprint>`) and the trace detail page (`/traces/<trace id>`) show a Replay section: the clip's duration and start time, trigger markers (`ERROR TRIGGER`, `NETWORK TRIGGER`), `TRUNCATED` when the buffer was cut, gap labels (`1 missing segment`), and a Play button that replays the masked DOM. The player fetches the clip once through the `getTraceReplay` server function for the page's time window.

## Sub-features

- `replay-error-page` the error detail page shows the Replay section with a trigger marker and `Play`.
- `replay-trace-page` the trace detail page of the failed request shows the same Replay section.
- `replay-play` `Play` advances the player's time and turns into `Pause`.
- `replay-gaps` gap and truncation labels match the segments (`TRUNCATED`, `<n> missing segment`).
- `replay-masking` text in the replay iframe is masked (asterisks).
- `replay-default-range` with the default relative range (`Last 7 days`), the player loads and the page stops requesting: at most 10 `_serverFn` GETs in 10s once loaded.
- `replay-absolute-range` with an absolute `from`/`to` in the URL, the player loads and requests settle.

## How to get to it (user POV)

- `/errors`, click the error row (default `Last 7 days`), scroll to Replay.
- `/traces`, click the failed `GET /verify-api/checkout` trace.

## Driving it with verify-everr

Preconditions:

- Only in checkouts with session replay (`packages/otel-web/src/recording.ts` exists; `web-sdk-page` prints `recording=on`).
- `web-browser-sdk.md` "Errors, network, recording" ran in this run, and its `sdk-recordings` row shows a clip.

- **Error page, default range.** Run:

  ```bash
  agent-browser open "$WEB/errors?service=%5B%22verify-sdk-web%22%5D" && agent-browser wait --text "VerifySdkError" && ab_save replay-01-errors
  agent-browser find text "VerifySdkError: checkout exploded" click && agent-browser wait --text "Stacktrace"
  agent-browser network requests --clear; sleep 10
  agent-browser network requests --filter _serverFn > "$SHOTS/replay-02-default-range-requests.txt"
  N=$(grep -c GET "$SHOTS/replay-02-default-range-requests.txt"); echo "default range _serverFn GETs in 10s: $N"; test "$N" -le 10
  agent-browser wait --timeout 30000 'section[aria-label=Replay] button[aria-label=Play]' && agent-browser wait --text "TRIGGER" && ab_save replay-03-error-default-range
  ```

  The `test` and both waits exit `0` (`replay-default-range`, `replay-error-page`). A count in the hundreds with no `Play` is a refetch loop: the query key changes every render. Report it as a failure with the count; do not fall through to the absolute-range step as a substitute.
- **Error page, absolute range.** Run:

  ```bash
  ERR=$(agent-browser get url); ABS="${ERR%%\?*}?from=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%S.000Z)&to=$(date -u -d '+10 min' +%Y-%m-%dT%H:%M:%S.000Z)"
  agent-browser open "$ABS" && agent-browser wait --text "Stacktrace" && agent-browser wait --timeout 30000 --text "TRIGGER" && ab_save replay-04-error-absolute-range
  agent-browser network requests --clear; sleep 10
  agent-browser network requests --filter _serverFn > "$SHOTS/replay-05-absolute-range-requests.txt"; test "$(grep -c GET "$SHOTS/replay-05-absolute-range-requests.txt")" -le 10
  agent-browser get text 'section[aria-label=Replay]'
  ```

  Exit `0`; the Replay text has `<d>s`, `from <time>`, a `TRIGGER` marker and, after an idle tail, `1 missing segment` (`replay-absolute-range`, `replay-gaps`).
- **Play.** Run `agent-browser click 'section[aria-label=Replay] button[aria-label=Play]' && sleep 2 && agent-browser get text 'section[aria-label=Replay]' && agent-browser wait 'section[aria-label=Replay] button[aria-label=Pause]' && ab_save replay-06-playing`. The first number (`<t>s`) is about 2s larger than before Play, and `Pause` exists (`replay-play`). `replay-06-playing.png` shows the page in the iframe with asterisks for text (`replay-masking`).
- **Trace page.** Run:

  ```bash
  agent-browser open "$WEB/traces?service=%5B%22verify-sdk-web%22%5D" && agent-browser wait --text "/verify-api/checkout" && ab_save replay-07-traces
  agent-browser find text "/verify-api/checkout" click && agent-browser wait --fn "location.pathname.startsWith('/traces/')"
  agent-browser wait 'section[aria-label=Replay] button[aria-label=Play]' && agent-browser wait --text "TRIGGER" && ab_save replay-08-trace
  ```

  Exit `0`; `replay-08-trace.txt` has `GET /verify-api/checkout`, `1 spans`, and a `TRIGGER` marker (`replay-trace-page`).
- **Proof.** `web/replay-*` including the two request-count files, `db/sdk-recordings/`.

## Gotchas

- Observed at PR #527 head `574e395d6` (2026-10-20): the default-range step FAILS, 331 `getTraceReplay` GETs in 10s and no player, while the absolute-range step passes with 1 request. Cause: the error view resolves the relative range against `new Date()` on every render and the resolved times are in the query key. The recipe is meant to catch exactly this.
- `_serverFn` URLs carry the function as base64url JSON (`.../_serverFn/eyJmaWxl...`); decode one with `echo <id> | base64 -d` (pad with `=`) to confirm it is `getTraceReplay`.
- The trace list hides recording root spans by design; reach the player through the failed request's trace, not a recording span.
- When the error and the failed request share a clip, the trace page shows `ERROR TRIGGER`; assert on `TRIGGER`.
- Do not click `Accept all` on the consent banner; the Play button is above it.
