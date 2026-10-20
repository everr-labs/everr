# Wrap a command

`everr wrap <command...>` runs a command, mirrors its stdout and stderr unchanged, exits with the command's own exit code, and ships every output line plus a final exit record as OTLP logs into the running local collector, where `everr local query` and the Logs UI can read them.

## Sub-features

- `wrap-mirror` stdout and stderr pass through to the terminal unchanged.
- `wrap-exit` the wrapper exits with the wrapped command's exit code.
- `wrap-ingest` each line becomes a log row: service `everr-wrap-<program>`, `INFO` for stdout, `ERROR` for stderr.
- `wrap-exit-record` a final row `wrapped command exited with code <n>` with `everr.wrap.stream = exit` and `everr.wrap.exit_code`.
- `wrap-no-collector` with no collector running, wrap refuses to run the command and exits 2.

## How to get to it (user POV)

- `everr wrap <command> [args...]` in a terminal, typically around a dev server or test run (`everr wrap pnpm test`).

## Driving it with verify-everr

Preconditions:

- `$V doctor` ends with `DOCTOR OK`.
- A unique marker: `M=verify-wrap-$(date +%s)`.

- **Run wrapped command.** Run `$V cli wrap-run -- wrap sh -c "echo $M-out; echo $M-err >&2; exit 3"`. Stdout is `$M-out`, stderr is `$M-err`, exit code is `3` (`wrap-mirror`, `wrap-exit`).
- **Read the ingested rows.** Run `$V cli-until wrap-query '"stream":"exit"' -- local query "SELECT ServiceName, SeverityText, Body, LogAttributes.everr.wrap.stream AS stream, LogAttributes.everr.wrap.exit_code AS exit_code FROM logs WHERE ServiceName = 'everr-wrap-sh' AND Timestamp > now() - INTERVAL 10 MINUTE ORDER BY Timestamp LIMIT 20" --format ndjson`. Exit `0`, three rows in order: `{"Body":"$M-out","SeverityText":"INFO","stream":"stdout"}`, `{"Body":"$M-err","SeverityText":"ERROR","stream":"stderr"}`, `{"Body":"wrapped command exited with code 3","SeverityText":"ERROR","stream":"exit","exit_code":"3"}` (`wrap-ingest`, `wrap-exit-record`).
- **See it in the UI.** Run `$V ui-shot wrap-ui "/logs?q=$M" "$M-err"`. Exit `0`; `ui/wrap-ui/text.txt` contains `$M-err`, `$M-out` and `Showing all 2 matching events` (the exit record does not contain the marker); the screenshot shows both rows, the stderr one with a red severity bar.
- **No collector.** Do this last, since it stops the instance. Run `$V cli life-stop -- local stop`, then `$V cli wrap-down -- wrap echo should-not-run`. Exit `2`, stderr contains `telemetry collector isn't running`, and stdout does not contain `should-not-run` (`wrap-no-collector`). Then `$V cleanup`.
- **Proof.** `cli/wrap-run`, `cli/wrap-query`, `ui/wrap-ui`.

## Gotchas

- Service name is derived from the program, not the full command: `sh -c ...` is `everr-wrap-sh`, `pnpm test` is `everr-wrap-pnpm`. Always also filter by marker.
- Log attributes are JSON columns. `LogAttributes['everr.wrap.stream']` fails with `ILLEGAL_TYPE_OF_ARGUMENT`; use `LogAttributes.everr.wrap.stream`.
- Ingestion is asynchronous. In the 2026-10-20 proof run, a `local query` issued immediately after `wrap` returned exited 0 with no rows; the rows appeared 1 to 2 seconds later (`cli-until` found them on try 5, 2s). Always read with `cli-until`, never a single `cli` call or a fixed sleep.
- Lines longer than 16 KiB are truncated in the stored body.
