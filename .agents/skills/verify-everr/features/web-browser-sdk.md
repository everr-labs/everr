# Web browser SDK (`@everr/otel-web`) against public ingest

An integrator adds `@everr/otel-web` to their page with a public `ek_` key that only works from the origins they allowed. The SDK exports uncaught errors as exception logs and failed `fetch` calls as Client spans over OTLP/HTTP to the public collector, which answers the browser's CORS preflight, checks the key and its origin with the app, and stamps the key's organization. In checkouts with session replay, `recording()` buffers the DOM and uploads a clip when an error or failed request triggers it. Without a key, the same SDK can send to the local `everr` collector.

## Sub-features

- `sdk-cors` the collector answers the SDK's preflight (`OPTIONS /v1/logs`, `/v1/traces`) with `204` from the allowed origin, including the example's `allowed_headers` (`Content-Encoding` once the SDK gzips).
- `sdk-errors` an uncaught error on the page arrives as an exception log and groups on `/errors` (`VerifySdkError: checkout exploded`, service `verify-sdk-web`).
- `sdk-network` a failed `fetch` arrives as a `GET /verify-api/checkout` span with status `Error`.
- `sdk-recording` with `recording()` on, the trigger uploads segments that land in `app.recordings` (not `app.logs`), one clip id.
- `sdk-local` with `web-sdk-page --local`, the page exports to the CLI run's local collector without a key.

## How to get to it (user POV)

- `/api-keys`, `Public keys`, `New public key` with the site's origin, then the key in the SDK's `ingestKey` (the docs' browser quick start).
- The page under test is the skill's SDK page (`web-sdk-page`), a minimal integrator page built from this checkout's `packages/otel-web/src`.

## Driving it with verify-everr

Preconditions:

- `WEB DOCTOR OK` including the `CORS preflight` line `ok` (if it says the example sets no CORS, browser ingest is not expected to work: report that).
- `eval "$($V web-browser-env)"`, this run's browser signed in (`web-auth.md` Sign up), and `web-api-keys.md` "Public key" ran (saved as `public`, origin `$SDK_PAGE_ORIGIN`).

- **Build and serve the page.** Run `$V web-sdk-page`, then `eval "$($V web-browser-env)"` again. Exit `0`; `SDK PAGE READY ... key=public recording=on|absent`; `$SDK_URL` is set.
- **Errors, network, recording.** Run:

  ```bash
  agent-browser network requests --clear
  agent-browser open "$SDK_URL" && agent-browser wait --text "sdk ready" && ab_save sdk-01-page
  for i in 1 2 3; do agent-browser click "#add"; sleep 0.5; done
  agent-browser click "#boom"; for i in 1 2 3 4 5 6; do agent-browser click "#add"; sleep 0.5; done
  agent-browser click "#fail-fetch" && agent-browser wait --text "request failed"; for i in 1 2 3 4 5 6; do agent-browser click "#add"; sleep 0.5; done
  sleep 8; agent-browser network requests | grep "/v1/" > "$SHOTS/sdk-02-otlp-requests.txt"; cat "$SHOTS/sdk-02-otlp-requests.txt"
  ```

  Every command exits `0`; `sdk-02-otlp-requests.txt` has `OPTIONS .../v1/logs ... 204`, `OPTIONS .../v1/traces ... 204`, and `POST` lines for both with `200` (`sdk-cors`). A `401` or a missing `POST` after a `204` means the key or its origin was refused; a preflight that is not `204` means CORS.
- **Rows.** Run `$V web-ch sdk-rows "SELECT 'log' AS k, EventName AS e, count() AS c FROM app.logs WHERE ServiceName = 'verify-sdk-web' GROUP BY e UNION ALL SELECT 'span', SpanName, count() FROM app.traces WHERE ServiceName = 'verify-sdk-web' GROUP BY SpanName"`. One `exception` log and one `GET /verify-api/checkout` span (`sdk-errors`, `sdk-network`). Recording on: `$V web-ch sdk-recordings "SELECT uniq(LogAttributes.everr.recording.clip.id) AS clips, count() AS segments FROM app.recordings WHERE ServiceName = 'verify-sdk-web'"` has `clips` 1 and `segments` >= 1, and `SELECT count() FROM app.logs WHERE EventName = 'everr.browser.recording.segment'` is `0` (`sdk-recording`).
- **In the app.** Run `agent-browser open "$WEB/errors?service=%5B%22verify-sdk-web%22%5D" && agent-browser wait --text "VerifySdkError: checkout exploded" && ab_save sdk-03-errors`. `sdk-03-errors.txt` has `1 occurrence` and `Showing all 1 matching errors`. The replay of that clip is `web-replay.md`.
- **Local endpoint, no key.** With a live CLI run (`$V launch`, `DOCTOR OK`): `$V web-sdk-page --local`, `eval "$($V web-browser-env)"`, open `$SDK_URL`, click `#boom` and `#fail-fetch`, then `$V cli-until sdk-local-rows VerifySdkError -- local query "SELECT ServiceName, Body FROM logs WHERE ServiceName = 'verify-sdk-web' LIMIT 5" --format ndjson`. Found; the network log shows `OPTIONS ... 204` and `POST ... 200` against the CLI run's OTLP port (`sdk-local`).
- **Proof.** `sdk-page/` (entry, build log, `page.txt`), `web/sdk-*`, `db/sdk-rows/`, `db/sdk-recordings/`, `cli/sdk-local-rows/`.

## Gotchas

- The public key's allowed origin must be exactly `$SDK_PAGE_ORIGIN` (`http://127.0.0.1:<port>`); the page is never served on `localhost`.
- The collector's CORS library only accepts `Access-Control-Request-Headers` in the order browsers send them (lowercase, sorted). `web-doctor` sends them that way; a hand-written `curl` preflight with another order gets `204` without `Access-Control-Allow-Origin`.
- A recording is only uploaded after a trigger (error or failed request). Keep interacting for a few seconds after the trigger: an idle tail produces no further segment and the player labels the gap (`1 missing segment`).
- Several triggers close together share one clip; the trace page then shows the clip with the first trigger's label (`ERROR TRIGGER`), not `NETWORK TRIGGER`.
- `agent-browser errors` lists page errors including the intentional `VerifySdkError`; it accumulates across the session, so it is not an assertion.
- `web-sdk-page --local` still needs a web run (it serves the page on that run's `SDK_PAGE_ORIGIN`); only the export target changes.
- The page imports the SDK from source; a change to `packages/otel-web/src` needs `$V web-sdk-page` again (it rebuilds and restarts the server).
