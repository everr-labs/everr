# Everr local verification map

This directory is the maintained source for verifying the user-facing behavior of the Everr CLI and its local stack. Read the index before driving, then use the matching feature file as the recipe. `V` below is `.agents/skills/verify-everr/scripts/verify-everr`.

## Baseline preconditions

- The debug CLI is built from this checkout with `$V build` (`pnpm dev:cli`), and `$V doctor` shows no "sources newer than binary" warning.
- One isolated instance per run, started with `$V launch`: random ports, `EVERR_TELEMETRY_DIR` and `EVERR_LOCAL_LOG_DIR` under `/tmp/verify-everr/<RUN_ID>/`, throwaway `HOME`/`XDG_*`.
- `$V doctor` ends with `DOCTOR OK` before any recipe.
- The telemetry store starts empty. Recipes create their own data with a unique marker (for example `M=verify-$(date +%s)`).
- Never drive an instance this run did not start, including the user's own on ports 54318/54320/54321 (debug) or 54418/54420/54421 (release).

## Driving conventions

- Run CLI actions through `$V cli <label> -- <args>`. Labels name the evidence folder, so keep them unique within a run.
- Run local UI API calls through `$V ui-get` / `$V ui-cmd`, and rendered UI through `$V ui-shot`.
- Use `--format ndjson` (or `json`) for assertions. `table` is for humans.
- Filter every read by the run's marker and a recent time window (`Timestamp > now() - INTERVAL 10 MINUTE`).
- Treat commands as literal. Keep quoting, especially SQL inside double quotes with string literals in single quotes.
- Remove any scratch project dirs a recipe creates. Never remove `.verify-everr/artifacts/`.

## Proof and skip reporting

- CLI proof: `cli/<label>/` with command, stdout, stderr, exit code.
- Ingestion proof: the producing command plus a read-only `local query` that returns the marker rows.
- UI proof: `ui/<label>/screenshot.png` plus `dom.html` containing the marker.
- Record the feature ID (sub-feature IDs below) with each artifact label.
- Report an unreachable path with the attempted command and the unmet precondition. Do not report a skipped entry point as verified through a different path.
- Cloud-backed commands (`cloud`, `ci`, `apply`, `resources`) are out of scope for this map; report them as skipped with "needs Everr Cloud session".

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior, then exactly four H2 sections in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-everr` (starts with `Preconditions:`, then labeled bullets pairing each action with an exact command and observable result), `Gotchas`.

## Features

- [Local stack lifecycle](./local-lifecycle.md): `everr local start`, `status`, `stop`, idempotent restart, stopped exit code.
- [Wrap a command](./wrap.md): `everr wrap` mirrors output and exit code and ingests stdout/stderr/exit as logs.
- [Query local telemetry](./local-query.md): `everr local query` over chDB in json/ndjson/table, errors, read-only behavior.
- [Local Logs UI](./local-ui-logs.md): the browser Logs explorer and its command API show ingested logs and search.
- [Bundled skills](./skills.md): `everr skills list/install/uninstall` for a project, including dry-run.
