---
name: verify-cli
description: Drive the `everr` CLI and its local stack (embedded collector, chDB, local browser UI) the way a user does, in an isolated throwaway instance, and capture proof. Use when a change touches `packages/cli`, the collector packages it builds in (`collector/localcollector`, `collector/internal/localgateway`, `collector/exporter/chdbexporter`), `packages/local-app`, `packages/app-shell` or `packages/telemetry-explorer`, or when you must prove `everr local start/status/stop/query`, `everr wrap`, `everr skills`, or the local Logs UI actually work.
user-invocable: true
metadata:
  internal: true
---

# Verify the Everr CLI and its local stack

The `everr` CLI, in particular the local telemetry loop: `everr local start` boots a supervisor that serves the local UI and runs the collector in-process with chDB; `everr wrap` and any OTLP exporter write into it; `everr local query` and the local UI read from it. Everything here runs offline with no auth.

Other surfaces have their own skills: App and Cloud in [verify-web-app](../verify-web-app/SKILL.md), the collector distributions on their own in [verify-collector](../verify-collector/SKILL.md), the docs and landing site in [verify-docs](../verify-docs/SKILL.md). Runs of different skills can coexist.

Not covered: Cloud-backed CLI commands (`cloud`, `apply`, `resources`) need an authenticated session. To test them, launch a [verify-web-app](../verify-web-app/SKILL.md) run, isolate `EVERR_CONFIG_DIR` and point login at the selected app; use its backing loopback HTTP port if the CLI cannot trust the local Portless CA.

Everything goes through one helper: `.agents/skills/verify-cli/scripts/verify-cli.ts` (below: `V`), TypeScript that Node >= 24 runs directly (no build step or separate dependency install). Run it from anywhere (`$V ...`, or `node $V ...`); it resolves the repo from its own path.

```bash
V="$(git rev-parse --show-toplevel)/.agents/skills/verify-cli/scripts/verify-cli.ts"
```

## Launch

There is no long-lived server to share: build the debug CLI once, then start one isolated local instance per run.

1. Toolchain (once per machine). The build needs: Node >= 24 (repo pins `.node-version` = 24; Node 20 cannot run the `.ts` build scripts), pnpm via corepack (version pinned in `packageManager`), Go >= the `packages/cli/go.mod` version (1.26), `curl`, `tar`. The helper itself runs on that Node and needs `ss` (Linux) or `lsof` (macOS); some recipes also use `jq`. The browser is driven with the [`agent-browser`](https://www.npmjs.com/package/agent-browser) CLI (required for every UI step; `doctor` checks it): `npm install -g agent-browser && agent-browser install` (downloads its Chrome; on a bare Linux host add `--with-deps`). Tested with 0.39.1.
2. Build (once per source change). This is the repo's own `pnpm dev:cli`: builds `packages/local-app` (Vite), downloads the pinned chDB release into `target/chdb/`, stages the UI, the skills, and the zstd-compressed chDB library into `packages/cli/internal/assets/`, then `go build`s the debug CLI, which runs the collector in-process.

   ```bash
   $V build      # cold: dominated by the chDB download and compression; warm: much faster
   ```

   The build reports its own spans over OTLP (`packages/cli/scripts/build-telemetry.ts`), by default to `127.0.0.1:54318`, which may be your own collector. `$V build` sets `OTEL_EXPORTER_OTLP_ENDPOINT` to the dead port `http://127.0.0.1:9` (or `VERIFY_BUILD_OTLP_ENDPOINT` if set), so the line `Build telemetry export to http://127.0.0.1:9/v1/traces failed` is expected and harmless.
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

Checks: debug build and git HEAD, warns if a source the binary embeds changed after it was built (`packages/cli/cmd`, `packages/cli/internal`, `packages/cli/go.mod`, `packages/local-app/src`, `packages/app-shell/src`, `packages/telemetry-explorer/src`, `packages/ui/src`, `collector/localcollector`, `collector/internal/localgateway`, `collector/exporter/chdbexporter`, `skills`) (then rebuild), `everr local status` exits 0, collector `/health` and UI `/health` report the same `instance_id`, each port is still owned by the PIDs recorded at launch, `agent-browser` is on PATH, and SQL answers. Ends with `DOCTOR OK` or `DOCTOR FAILED`. On failure: `$V cleanup`, then `$V launch` again; read `/tmp/verify-everr/<RUN_ID>/logs/local.log` before cleanup if the cause is unclear.

## Drive

Pick the feature file from [`features/README.md`](features/README.md) and follow it. Primitives:

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
- Rendered UI: drive it with `agent-browser` (see "Browser" below) at `$UI` from `eval "$($V browser-env)"`.
- Raw env for anything else (OTLP exporters, curl): `eval "$($V env)"` in a subshell, then point the exporter at `$EVERR_OTLP_HTTP_ORIGIN` (OTLP/HTTP, e.g. `/v1/logs`).

### Browser

Every rendered-UI step uses the `agent-browser` CLI directly, in the run's own session:

```bash
eval "$($V browser-env)"       # AGENT_BROWSER_SESSION=verify-everr-<RUN_ID>, UI, SHOTS=<evidence>/ui, ab_save
```

Run the `eval` in the shell you drive from (not inside `eval "$($V env)"`, whose throwaway `HOME` hides agent-browser's installed Chrome). With `AGENT_BROWSER_SESSION` set, every `agent-browser` command targets this run's browser, never another agent's, until cleanup closes the session. The commands the recipes use:

- `agent-browser open <url>`: navigate. Exits 1 with `Navigation failed: net::ERR_...` when the origin is down.
- `agent-browser wait --text "<text>" [--timeout <ms>]` (default 25000), `wait --fn "location.pathname === '/logs'"`: exit 1 on timeout. Always wait for the text you expect before capturing; the UI renders query results after load.
- `agent-browser fill "<css>" "<value>"` (replaces the value), `click "<css>"`, `find role <role> click --name "<accessible name>"` (substring match), `press Enter`.
- `agent-browser snapshot -i`: interactive elements with `@eN` refs, to find a handle when a recipe's selector no longer matches.
- `agent-browser eval '<js>'`: evaluate in the page and print the result.
- `agent-browser --json errors`: page errors with their text. The plain form prints bare `✗` lines in 0.39.1, and errors accumulate across navigations, so compare counts before and after an action instead of asserting emptiness.
- Evidence: `ab_save <label> ["<caption>"]` (defined by the `eval`) saves `$SHOTS/<label>.png` (`agent-browser screenshot`), `.url` (`get url`), `.txt` (`get text body`) and, with a second argument, `.caption`. Labels are flat (`logs-01-marker`): `screenshot` does not create directories. Assert on the `.txt`, not on the screenshot.

Stable handles: CLI subcommands and flags from `everr --help` (defined under `packages/cli/internal/`); `--format json|ndjson|table` on queries (ndjson is the default off a TTY); `everr wrap` names the service `everr-wrap-<program>` and sets log attributes `everr.wrap.stream` (`stdout`/`stderr`/`exit`), `everr.wrap.command`, `everr.wrap.executable`, `everr.wrap.exit_code`. Attributes are ClickHouse `JSON` columns: read them as `LogAttributes.everr.wrap.stream`, not `LogAttributes['...']` (that errors with `ILLEGAL_TYPE_OF_ARGUMENT`). UI routes: `/metrics`, `/logs`, `/traces`, `/traces/<traceId>`, `/errors`, `/errors/<fingerprint>`, `/settings`, `/developer`; the Logs search box maps to the `q` search param.

## Evidence

Location: `$REPO/.verify-everr/artifacts/<RUN_ID>/` (gitignored, outside the scratch dir, so cleanup never deletes it). Layout:

- `run.txt` (run id, git HEAD/branch, binary version and mtime, launch time), `run.env`, `pids.txt`, `launch.{stdout,stderr,exit}`
- `cli/<label>/{command.txt,stdout,stderr,exit_code,at.txt}` per `$V cli` call
- `cli/<label>/until.txt` for `$V cli-until` calls
- `ui/<label>.{png,txt,url}` saved with `agent-browser` (see Browser)
- `local.log` (supervisor + collector log, copied at cleanup), `cleanup.stop.txt`

Proof standards:

- Exercise the real user path: CLI commands, OTLP over HTTP, the UI routes. Do not insert rows with `curl` against the SQL port, and do not call collector internals.
- Capture the action and the resulting state: the command that produced data AND a second, read-only view of it (a `local query` and/or a UI shot), filtered by a unique per-run marker so old rows can't satisfy the check.
- Verify side effects alongside output: rows in chDB, files written (skills install), ports opened/closed, exit codes.
- No mocks: the whole loop is local, so nothing needs mocking.
- Dry-runs: `skills install --dry-run` must leave the target dir unchanged; check with `find`, don't trust the flag name.
- A query exit code alone is not proof: a non-SELECT statement exits 0 with empty stdout and writes nothing (see `features/local-query.md`).
- A UI claim needs a screenshot taken after the asserted text rendered (`wait --text`, then `ab_save <label> "<claim>"`). Open each image (Read the PNG) and confirm it shows what its caption claims before reporting.

## Cleanup

```bash
$V cleanup
```

`cleanup` runs `everr local stop` for this run (stops UI + collector via the supervisor), waits for the 3 run ports to close, and if any are still held, kills only the PIDs recorded at launch that still own those ports. Never kill by process name: other agents and the user may run their own `everr local`. It closes this run's `agent-browser` session (its Chrome), copies `local.log` into the evidence dir, deletes `/tmp/verify-everr/<RUN_ID>/` (data, throwaway HOME, extracted assets) and `.verify-everr/current` if it names this run, then lists the evidence that survived. Run it after every attempt, including failed ones. Also remove any scratch dirs a feature recipe created (they say so).

## Helpers

- `scripts/verify-cli.ts` (executable TypeScript entry, run by Node). Subcommands: `build`, `launch [RUN_ID]`, `doctor`, `env`, `cli <label> -- ARGS`, `cli-until <label> <text> -- ARGS`, `ui-get <path>`, `ui-cmd <command> [json]`, `browser-env`, `cleanup`. Run it with no args for usage. Env knobs: `EVERR_VERIFY_SCRATCH` (scratch root, default `/tmp/verify-everr`), `VERIFY_BUILD_OTLP_ENDPOINT` (where `build` sends its own spans, default the dead port `http://127.0.0.1:9`), `VERIFY_CWD` (cwd for `cli`), `UNTIL_S`, and `RUN_ID` to target a run other than the current one.
- `../verify-shared/common.ts`: paths, run-id validation, scratch-root containment, ports, process helpers. Shared with the other `verify-*` skills, so a change there needs a run of each.
- `scripts/package.json`: only `"type": "module"`, so Node loads the `.ts` files as ES modules without a warning.

Maintain the feature map with `/maintain-verification-skill` when commands, routes, or attributes change.
