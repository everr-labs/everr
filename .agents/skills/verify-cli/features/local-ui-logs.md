# Local Logs UI

The local UI served by `everr local start` (page title `Everr Local`) has the web app's frame: a sidebar with an Explore group (Metrics, Logs, Traces, Errors) and Settings (and Developer in dev) at its foot, a header with the page name and, on Explore pages, the time range and refresh controls. Its Logs page is an explorer with service/environment/severity filters, a search box, a time range picker (default `Last 7 days`) and a log-volume chart. It reads the same local store through the UI server's command API.

## Sub-features

- `ui-health` `/health` reports `everr-local-ui` with the instance id.
- `ui-shell` `/` serves the app shell titled `Everr Local`.
- `ui-collector-status` the `get_collector_status` command reports the running collector and its endpoints.
- `ui-sql` the `telemetry_sql_query` command runs parameterized SQL (`{name:Type}` params).
- `ui-logs-search` `/logs?q=<text>` lists only matching rows with the count "Showing all <n> matching events".
- `ui-api-guard` `/api/*` without the `X-Everr-Local: 1` header and matching `Origin` is rejected with 403.

## How to get to it (user POV)

- Open the `ui:` URL printed by `everr local start` (or run `everr local ui`), choose `Logs` in the sidebar, type in `Search`.
- Routes: `/metrics`, `/logs`, `/traces`, `/traces/<traceId>`, `/errors`, `/errors/<fingerprint>`, `/settings`, `/developer`.

## Driving it with verify-cli

Preconditions:

- `$V doctor` ends with `DOCTOR OK`.
- Marker rows exist: run the `wrap.md` "Run wrapped command" step with `M=verify-wrap-$(date +%s)`.
- `eval "$($V browser-env)"` in the driving shell (SKILL.md Browser); `$V doctor` checks `agent-browser` is installed.

- **Health.** Run `$V ui-get /health`. JSON has `"service":"everr-local-ui"` and the same `instance_id` as `curl -s $EVERR_SQL_HTTP_ORIGIN/health` (both checked by doctor).
- **Shell.** Run `$V ui-get / | grep -o '<title>.*</title>'`. Output `<title>Everr Local</title>`.
- **Collector status.** Run `$V ui-cmd get_collector_status`. `"status":"running"`, `otlpEndpoint`/`sqlEndpoint` equal the run's origins.
- **SQL command.** Run `$V ui-cmd telemetry_sql_query "{\"sql\":\"SELECT count() AS c FROM logs WHERE ServiceName = {svc:String} AND position(toString(LogAttributes.everr.wrap.command), {m:String}) > 0\",\"params\":{\"svc\":\"everr-wrap-sh\",\"m\":\"$M\"}}"`. Output `[{"c":3}]`: the wrap run with marker `$M` (stdout, stderr and exit rows; its `everr.wrap.command` contains the marker), whatever else ran in this instance.
- **Logs search.** Run `agent-browser open "$UI/logs?q=$M" && agent-browser wait --text "$M-err" && agent-browser wait --text "matching events" && ab_save ui-logs-search`. Exit `0`; `$SHOTS/ui-logs-search.txt` contains `$M-out`, `$M-err` and `Showing all 2 matching events`; the screenshot shows `Logs` in the header breadcrumb, `Search` box containing the marker, the two rows (stderr row with a red severity bar), and `Showing all 2 matching events`.
- **API guard.** Run `eval "$($V env)"; curl -s -o /dev/null -w '%{http_code}' -X POST -H "Host: ${EVERR_LOCAL_UI_ORIGIN#http://}" -H 'Content-Type: application/json' --data '{}' $EVERR_LOCAL_UI_ORIGIN/api/commands/get_collector_status` in a subshell. Prints `403`.
- **Proof.** `ui/ui-logs-search.{png,txt,url}` plus the command outputs.

## Gotchas

- Always `wait --text` for the rows you expect before `ab_save`; `open` returns at page load, before the logs query does.
- Assert on the `.txt` (`get text body`). In the DOM the search highlight splits a matched marker from the rest of the text, so a `grep` of `agent-browser get html body` can miss a row that is on screen.
- The search only matches log bodies containing the text; the exit record (`wrapped command exited with code 3`) is not in a `q=$M` result. Do not expect 3 rows.
- The default time range is the last 7 days; rows with old timestamps fall outside it. The range and the refresh interval are URL search params (`from`, `to`, `refresh`) that stay when you move between Explore pages, so a recipe that sets one on `/logs` still has it on `/traces`.
- Interactive clicking (filters, time picker) has no recipe yet; drive it with `agent-browser snapshot -i` and `click @eN`, and add the recipe here.
