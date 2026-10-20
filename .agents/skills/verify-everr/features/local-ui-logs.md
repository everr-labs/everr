# Local Logs UI

The local UI served by `everr local start` (page title `Everr Local`) has a sidebar with Logs, Traces, Errors, Settings (and Developer in dev), and a Logs explorer with service/environment/severity filters, a search box, a time range picker (default `Last 7 days`) and a log-volume chart. It reads the same local store through the UI server's command API.

## Sub-features

- `ui-health` `/health` reports `everr-local-ui` with the instance id.
- `ui-shell` `/` serves the app shell titled `Everr Local`.
- `ui-collector-status` the `get_collector_status` command reports the running collector and its endpoints.
- `ui-sql` the `telemetry_sql_query` command runs parameterized SQL (`{name:Type}` params).
- `ui-logs-search` `/logs?q=<text>` lists only matching rows with the count "Showing all <n> matching events".
- `ui-api-guard` `/api/*` without the `X-Everr-Local: 1` header and matching `Origin` is rejected with 403.

## How to get to it (user POV)

- Open the `ui:` URL printed by `everr local start` (or run `everr local ui`), choose `Logs` in the sidebar, type in `Search`.
- Routes: `/logs`, `/traces`, `/traces/<traceId>`, `/errors`, `/errors/<fingerprint>`, `/settings`, `/developer`.

## Driving it with verify-everr

Preconditions:

- `$V doctor` ends with `DOCTOR OK`.
- Marker rows exist: run the `wrap.md` "Run wrapped command" step with `M=verify-wrap-$(date +%s)`.
- Chrome or Chromium on PATH (or `CHROME=...`).

- **Health.** Run `$V ui-get /health`. JSON has `"service":"everr-local-ui"` and the same `instance_id` as `curl -s $EVERR_SQL_HTTP_ORIGIN/health` (both checked by doctor).
- **Shell.** Run `$V ui-get / | grep -o '<title>.*</title>'`. Output `<title>Everr Local</title>`.
- **Collector status.** Run `$V ui-cmd get_collector_status`. `"status":"running"`, `otlpEndpoint`/`sqlEndpoint` equal the run's origins.
- **SQL command.** Run `$V ui-cmd telemetry_sql_query "{\"sql\":\"SELECT count() AS c FROM logs WHERE ServiceName = {svc:String} AND position(toString(LogAttributes.everr.wrap.command), {m:String}) > 0\",\"params\":{\"svc\":\"everr-wrap-sh\",\"m\":\"$M\"}}"`. Output `[{"c":3}]`: the wrap run with marker `$M` (stdout, stderr and exit rows; its `everr.wrap.command` contains the marker), whatever else ran in this instance.
- **Logs search.** Run `$V ui-shot ui-logs-search "/logs?q=$M" "$M-err"`. Exit `0`; `.verify-everr/artifacts/$RUN_ID/ui/ui-logs-search/text.txt` contains `$M-out`, `$M-err` and `Showing all 2 matching events`; the screenshot shows the `Logs` header, `Search` box containing the marker, the two rows (stderr row with a red severity bar), and `Showing all 2 matching events`.
- **API guard.** Run `eval "$($V env)"; curl -s -o /dev/null -w '%{http_code}' -X POST -H "Host: ${EVERR_LOCAL_UI_ORIGIN#http://}" -H 'Content-Type: application/json' --data '{}' $EVERR_LOCAL_UI_ORIGIN/api/commands/get_collector_status` in a subshell. Prints `403`.
- **Proof.** `ui/ui-logs-search/{screenshot.png,dom.html}` plus the command outputs.

## Gotchas

- `ui-shot` waits for the given text (default up to 20s, `UI_WAIT_MS`). Always pass the text you expect; without it the shot is taken at `readyState=complete`, before the logs query returns.
- Assert on `text.txt`. In `dom.html` the search highlight splits a matched marker from the rest of the body text, so `grep "$M-out" dom.html` can miss a row that is on screen.
- The search only matches log bodies containing the text; the exit record (`wrapped command exited with code 3`) is not in a `q=$M` result. Do not expect 3 rows.
- The default time range is the last 7 days; rows with old timestamps fall outside it.
- The UI's sign-in (`get_auth_status`, `start_sign_in`) talks to Everr Cloud; the logged-out state is expected here and is not a failure.
- Interactive clicking (filters, time picker) is not scripted yet; add a CDP/Playwright recipe here when a change needs it.
