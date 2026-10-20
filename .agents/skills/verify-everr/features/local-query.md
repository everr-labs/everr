# Query local telemetry

`everr local query "<SQL>"` runs SQL against the local chDB store behind the collector and prints rows as a table on a TTY, or `json`/`ndjson` on request. Tables are `logs`, `traces`, and the `metrics_*` family. Bad SQL fails with the ClickHouse error and exit 1.

## Sub-features

- `query-ndjson` one JSON object per row (default when stdout is not a TTY).
- `query-json` a pretty JSON array.
- `query-table` header plus rows.
- `query-schema` `SHOW TABLES` and `DESCRIBE TABLE logs` expose the schema.
- `query-error` invalid SQL exits 1 with `Error: query failed` and the `DB::Exception`.
- `query-readonly` non-SELECT statements do not change data.

## How to get to it (user POV)

- `everr local query "<SQL>" [--format json|ndjson|table]` in a terminal.
- The same SQL path backs the local UI (`telemetry_sql_query` command, see `local-ui-logs.md`).

## Driving it with verify-everr

Preconditions:

- `$V doctor` ends with `DOCTOR OK`.
- For non-empty results, run the `wrap.md` "Run wrapped command" step first with marker `$M`.

- **Schema.** Run `$V cli query-tables -- local query "SHOW TABLES" --format ndjson`. Exit `0`; rows include `logs`, `traces`, `metrics_gauge`, `metrics_sum`, `metrics_histogram`, `metrics_exponential_histogram`, `metrics_summary`. Run `$V cli query-describe -- local query "DESCRIBE TABLE logs" --format ndjson`; `LogAttributes` has type `JSON(max_dynamic_paths=256)`.
- **ndjson.** Run `$V cli-until query-ndjson "$M" -- local query "SELECT Body FROM logs WHERE Body LIKE '$M%' ORDER BY Timestamp LIMIT 10" --format ndjson`. One `{"Body":...}` line per marker row.
- **json.** Run `$V cli query-json -- local query "SELECT 1 AS one" --format json`. Stdout is `[\n  {\n    "one": 1\n  }\n]`.
- **table.** Run `$V cli query-table -- local query "SELECT 1 AS one" --format table`. Stdout is `one` then `1`.
- **Error.** Run `$V cli query-error -- local query "SELECT nope FROM logs" --format ndjson`. Exit `1`, stderr starts `Error: query failed` and contains `UNKNOWN_IDENTIFIER` (`Unknown expression identifier \`nope\``).
- **Read-only.** Run `$V cli query-insert -- local query "INSERT INTO logs (Body) VALUES ('$M-insert')"`, then `$V cli query-insert-check -- local query "SELECT count() AS c FROM logs WHERE Body = '$M-insert'" --format ndjson`. The check prints `{"c":0}`.
- **Proof.** The `cli/query-*` folders.

## Gotchas

- Observed on 2026-10-20 (HEAD a07183355): the INSERT exits `0` with empty stdout and stderr even though nothing is written. Prove read-only behavior with the second SELECT, never with the exit code. If a change makes it exit non-zero, update this step.
- Without `--format`, output depends on whether stdout is a TTY; the helper captures to files, so the default there is ndjson.
- Include `LIMIT` yourself; the CLI does not add one.
- JSON attribute columns use dot paths (`LogAttributes.everr.wrap.stream`), not map subscripts.
