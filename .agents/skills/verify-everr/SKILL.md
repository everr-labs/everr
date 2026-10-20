---
name: verify-everr
description: Drive the Everr CLI and its local stack (embedded collector, chDB, local browser UI) the way a user does, in an isolated throwaway instance, and capture proof. Use when a change touches `packages/cli`, `collector/cmd/everr-local-collector`, `packages/local-app` or `packages/telemetry-explorer`, or when you must prove `everr local start/status/stop/query`, `everr wrap`, `everr skills`, or the local Logs UI actually works.
user-invocable: true
metadata:
  internal: true
---

# Verify Everr (CLI + local stack)

Primary surface: the `everr` CLI, in particular the local telemetry loop (`everr local start` boots a supervisor that serves the local UI and runs the embedded Go collector with in-process chDB; `everr wrap` and any OTLP exporter write into it; `everr local query` and the local UI read from it). Everything here runs offline with no auth.

Other surfaces, not covered by this skill yet:

- Hosted web app `packages/app` (`pnpm dev:web`, port 5173): needs Postgres + ClickHouse from `docker compose up -d`, a GitHub App, and the `.auth` credentials from the main worktree. If `.auth` is missing, skip it (AGENTS.md).
- `everr cloud *`, `everr ci *`, `everr apply`, `everr resources`: need an Everr Cloud session (debug builds talk to `http://localhost:5173`). Not drivable offline.
- Docs site `packages/docs` (`pnpm dev:docs`, port 3000), Storybook.

Everything goes through one helper: `.agents/skills/verify-everr/scripts/verify-everr` (below: `V`). Run it from anywhere; it resolves the repo from its own path.

```bash
V=.agents/skills/verify-everr/scripts/verify-everr
```

## Launch

1. Toolchain (once per machine). The build needs: Node >= 23 (repo pins `.nvmrc` = 24; Node 20 cannot run the `.ts` build scripts), pnpm 11 via corepack (`packageManager`), stable Rust (CI uses `dtolnay/rust-toolchain@stable`), Go >= the `collector/go.mod` version (1.26), `make`, a C toolchain, `curl`, `tar`. Runtime helpers need `python3`, `ss` (iproute2), `jq`, `curl`, and Chrome/Chromium for UI shots.
2. Build (once per source change). This is the repo's own `pnpm dev:cli`: builds `packages/local-app` (Vite), `make -C collector build-local` (Go), downloads the pinned chDB release into `target/chdb/`, gzips both into `target/cli-embedded-assets/`, then `cargo build` of the debug CLI with them embedded.

   ```bash
   $V build      # cold: ~2m40s on 8 cores (vite + go + chDB download + cargo); warm: much faster
   ```

   The line `Build telemetry export to http://127.0.0.1:54318/v1/traces failed` is harmless: the build tries to report itself to a default dev collector.
3. Start an isolated instance:

   ```bash
   $V launch            # or: $V launch <RUN_ID>
   ```

   It picks 3 free ports, writes `/tmp/verify-everr/<RUN_ID>/env` (ports via `EVERR_SQL_HTTP_ORIGIN`, `EVERR_OTLP_HTTP_ORIGIN`, `EVERR_LOCAL_UI_ORIGIN`; data via `EVERR_TELEMETRY_DIR`, `EVERR_LOCAL_LOG_DIR`; and a throwaway `HOME`/`XDG_*` so no real session, skills, or data dir is touched), runs `everr local start --detach --no-open`, then waits until `SELECT count() FROM logs` answers. Ready line:

   ```
   READY run=<RUN_ID> ui=http://127.0.0.1:<p> sql=http://127.0.0.1:<p> otlp=http://127.0.0.1:<p>
   ```

   From an empty data dir, launch takes ~7s (asset extraction + chDB schema init). The port overrides only exist in debug builds, which is why the helper drives the debug binary and never the installed release `everr`.

Isolation: any number of checkouts/runs can coexist because ports and dirs are per run. The helper still refuses a second `launch` in the same checkout while a run is live (`.verify-everr/current`). Never point the helper at the user's own instance (default ports 54318/54320/54321 for debug, 54418/54420/54421 for release); if those are listening, they are not yours.

Teardown is `$V cleanup` (see Cleanup).

## Doctor

Read-only. Run first, and whenever anything looks off:

```bash
$V doctor
```

Checks: debug build and git HEAD, warns if `packages/cli/src`, `packages/local-app/src` or `collector/cmd` changed after the binary was built (then rebuild), `everr local status` exits 0, collector `/health` and UI `/health` report the same `instance_id`, each port is still owned by the PIDs recorded at launch, and SQL answers. Ends with `DOCTOR OK` or `DOCTOR FAILED`. On failure: `$V cleanup`, then `$V launch` again; read `/tmp/verify-everr/<RUN_ID>/logs/local.log` before cleanup if the cause is unclear.

## Drive

Pick the feature file from [`features/README.md`](features/README.md) and follow it. The drive primitives:

- CLI, with evidence recorded automatically:

  ```bash
  $V cli <label> -- <everr args...>
  # e.g. $V cli wrap-run -- wrap sh -c 'echo hello; exit 3'
  #      $V cli q -- local query "SELECT count() AS c FROM logs" --format ndjson
  ```

  Runs the debug CLI with the run's env, in `$VERIFY_CWD` (default: repo root). Prints the command, stdout, stderr and exit code, and returns the CLI's exit code.
- Read until data lands (ingestion is asynchronous: a query issued right after `everr wrap` returns can come back empty):

  ```bash
  $V cli-until <label> '<expected stdout text>' -- local query "<SQL>" --format ndjson
  ```

  Retries every 0.5s for up to `UNTIL_S` (default 15) seconds; records the last attempt plus `until.txt` (tries, elapsed). Exit 1 if never found: that is a failed proof, not a reason to loosen the query.
- Local UI HTTP, as the browser does it (the UI rejects a wrong `Host`, and `/api/*` needs `Origin` = UI origin plus `X-Everr-Local: 1`):

  ```bash
  $V ui-get /health
  $V ui-cmd get_collector_status
  $V ui-cmd telemetry_sql_query '{"sql":"SELECT count() AS c FROM logs WHERE ServiceName = {svc:String}","params":{"svc":"everr-wrap-sh"}}'
  ```
- Local UI rendered in headless Chrome over CDP (`scripts/ui-shot.mjs`, Node >= 22, no npm deps). Waits until the given text is in `document.body.innerText` (max `UI_WAIT_MS`, default 20000), then saves the screenshot, DOM and innerText:

  ```bash
  $V ui-shot <label> '/logs?q=<text>' '<text that must be visible>'
  ```

  Exit 1 if the text never appears (artifacts are still written so you can see what rendered instead). Assert on `text.txt`, not `dom.html`: search highlighting splits matched text across `<mark>`-style spans.
- Raw env for anything else (OTLP exporters, curl): `eval "$($V env)"` in a subshell, then point the exporter at `$EVERR_OTLP_HTTP_ORIGIN` (OTLP/HTTP, e.g. `/v1/logs`).

Stable handles: CLI subcommands and flags from `packages/cli/src/cli.rs`; `--format json|ndjson|table` on queries (ndjson is the default off a TTY); `everr wrap` names the service `everr-wrap-<program>` and sets log attributes `everr.wrap.stream` (`stdout`/`stderr`/`exit`), `everr.wrap.command`, `everr.wrap.executable`, `everr.wrap.exit_code`. Attributes are ClickHouse `JSON` columns: read them as `LogAttributes.everr.wrap.stream`, not `LogAttributes['...']` (that errors with `ILLEGAL_TYPE_OF_ARGUMENT`). UI routes: `/logs`, `/traces`, `/traces/<traceId>`, `/errors`, `/settings`, `/developer`; the Logs search box maps to the `q` search param.

## Evidence

Location: `$REPO/.verify-everr/artifacts/<RUN_ID>/` (gitignored, outside the scratch dir, so cleanup never deletes it). Layout:

- `run.txt` (run id, git HEAD/branch, binary version and mtime, launch time), `run.env`, `pids.txt`, `launch.{stdout,stderr,exit}`
- `cli/<label>/{command.txt,stdout,stderr,exit_code,at.txt}` per `$V cli` call
- `cli/<label>/until.txt` for `$V cli-until` calls
- `ui/<label>/{url.txt,screenshot.png,dom.html,text.txt,result.json}` per `$V ui-shot` call
- `local.log` (supervisor + collector log, copied at cleanup), `cleanup.stop.txt`

Proof standards:

- Exercise the real user path: CLI commands, OTLP over HTTP, the UI routes. Do not insert rows with `curl` against the SQL port, and do not call collector internals.
- Capture the action and the resulting state: the command that produced data AND a second, read-only view of it (a `local query` and/or a UI shot), filtered by a unique per-run marker so old rows can't satisfy the check.
- Verify side effects alongside output: rows in chDB, files written (skills install), ports opened/closed, exit codes.
- No mocks: the whole loop is local, so nothing needs mocking.
- Dry-runs: `skills install --dry-run` must leave the target dir unchanged; check with `find`, don't trust the flag name.
- A query exit code alone is not proof: a non-SELECT statement exits 0 with empty stdout and writes nothing (see `features/local-query.md`).

## Cleanup

```bash
$V cleanup
```

Runs `everr local stop` for this run (stops UI + collector via the supervisor), waits for the 3 run ports to close, and if any are still held, kills only the PIDs recorded at launch that still own those ports. Never kill by process name: other agents and the user may run their own `everr-local-collector`. It copies `local.log` into the evidence dir, deletes `/tmp/verify-everr/<RUN_ID>/` (data, throwaway HOME, extracted assets) and `.verify-everr/current`, then lists the evidence that survived. Run it after every attempt, including failed ones. Also remove any scratch dirs a feature recipe created (they say so).

## Helpers

- `scripts/verify-everr` (executable bash). Subcommands: `build`, `launch [RUN_ID]`, `doctor`, `env`, `cli <label> -- ARGS`, `cli-until <label> <text> -- ARGS`, `ui-get <path>`, `ui-cmd <command> [json]`, `ui-shot <label> <path> [text]`, `cleanup`. Run it with no args for usage. Env knobs: `EVERR_VERIFY_SCRATCH` (scratch root, default `/tmp/verify-everr`), `VERIFY_CWD` (cwd for `cli`), `UNTIL_S`, `CHROME` (browser binary), `UI_WAIT_MS`. Needs `node` (>= 22) on PATH for `ui-shot`.
- `scripts/ui-shot.mjs <url> <outDir> [waitForText] [timeoutMs]` (executable Node, used by `ui-shot`; callable directly for any URL).

Maintain the feature map with `/maintain-verification-skill` when commands, routes, or attributes change.
