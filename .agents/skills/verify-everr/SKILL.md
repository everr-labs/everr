---
name: verify-everr
description: Drive Everr the way a user does, in isolated throwaway instances, and capture proof. Two surfaces, the `everr` CLI with its local stack (embedded collector, chDB, local browser UI) and the hosted web app `packages/app` (docker compose ClickHouse + Postgres, `pnpm dev:web`, browser over CDP). Use when a change touches `packages/cli`, `collector/cmd/everr-local-collector`, `packages/local-app`, `packages/telemetry-explorer` or `packages/app`, or when you must prove `everr local`/`wrap`/`skills`, the local Logs UI, or web sign-up/sign-in, API keys, Explore pages, or the GitHub connect boundary actually work.
user-invocable: true
metadata:
  internal: true
---

# Verify Everr (CLI + local stack, and the web app)

This skill covers two surfaces. Each has its own Launch, Doctor, Drive and Cleanup, and both write evidence under `.verify-everr/artifacts/`. They are independent: run either alone, or both at once.

- **A. CLI + local stack** (`launch`, `doctor`, `cli`, `ui-*`, `browser-env`, `cleanup`).
- **B. Web app `packages/app`** (`web-launch`, `web-doctor`, `web-browser-env`, `web-http`, `web-webhook`, `web-psql`, `web-ch`, `web-cleanup`). Implemented in `scripts/web.ts`.

Surface A: the `everr` CLI, in particular the local telemetry loop (`everr local start` boots a supervisor that serves the local UI and runs the embedded Go collector with in-process chDB; `everr wrap` and any OTLP exporter write into it; `everr local query` and the local UI read from it). Everything here runs offline with no auth.

Surface B: the hosted web app (TanStack Start on Vite, better-auth, Drizzle/Postgres, ClickHouse, Graphile Worker). Local dev needs no real secrets to get past login: email/password sign-up is enabled and does not require email verification, so every run signs up a throwaway user in a fresh database. The `.auth` file AGENTS.md mentions holds credentials for the developer's own long-lived dev database; an isolated run does not use it. What does need real secrets is listed under "Web app boundary" below.

Not covered:

- `everr cloud *`, `everr ci *`, `everr apply`, `everr resources`: need an Everr Cloud session (debug builds talk to `http://localhost:5173`). Not drivable offline.
- Docs site `packages/docs` (`pnpm dev:docs`, port 3000), Storybook.

Everything goes through one helper: `.agents/skills/verify-everr/scripts/verify-everr.ts` (below: `V`), TypeScript that Node >= 23 runs directly (no build step, no npm deps). Run it from anywhere (`$V ...`, or `node $V ...`); it resolves the repo from its own path.

```bash
V=.agents/skills/verify-everr/scripts/verify-everr.ts
```

## Launch

### A. CLI + local stack

1. Toolchain (once per machine). The build needs: Node >= 23 (repo pins `.nvmrc` = 24; Node 20 cannot run the `.ts` build scripts), pnpm 11 via corepack (`packageManager`), stable Rust (CI uses `dtolnay/rust-toolchain@stable`), Go >= the `collector/go.mod` version (1.26), `make`, a C toolchain, `curl`, `tar`. The helper itself runs on that Node and needs `ss` (iproute2) and `curl` (`web-http`); some recipes also use `jq`. The browser is driven with the [`agent-browser`](https://www.npmjs.com/package/agent-browser) CLI (required for every UI step; `doctor` and `web-doctor` check it): `npm install -g agent-browser && agent-browser install` (downloads its Chrome; on a bare Linux host add `--with-deps`). Tested with 0.39.1. Linux only: `launch`, `doctor` and `cleanup` find the PIDs that own the run ports with `ss -ltnp`, which macOS does not have; the skill is untested on macOS.
2. Build (once per source change). This is the repo's own `pnpm dev:cli`: builds `packages/local-app` (Vite), `make -C collector build-local` (Go), downloads the pinned chDB release into `target/chdb/`, gzips both into `target/cli-embedded-assets/`, then `cargo build` of the debug CLI with them embedded.

   ```bash
   $V build      # cold: ~2m40s on 8 cores (vite + go + chDB download + cargo); warm: much faster
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

### B. Web app

Prerequisites: a reachable Docker daemon with the Compose plugin (>= 2.24 for `!override`); the helper uses `docker`, or `sudo -n docker` when the user is not in the `docker` group. Node >= 23 and pnpm 11 as above (`pnpm install` runs if `node_modules` is missing), `agent-browser`.

```bash
$V web-launch            # or: $V web-launch <RUN_ID>
```

What it does, in order:

1. Picks 3 free ports (ClickHouse HTTP, Postgres, web) and compose project `verify-everr-<run id>`.
2. `docker compose -p <project> -f docker-compose.yaml -f scripts/compose.verify.yaml up -d --wait clickhouse postgres`. The override (`!override`) rebinds ports to `127.0.0.1:<run port>` and swaps the `./volumes/*` bind mounts for project-scoped named volumes, so the developer's own stack (project `everr`, ports 5432/8123/8080/4317/4318/1025/8025, `./volumes/`) is never shared or touched. The ClickHouse image is built once as `everr-verify-clickhouse:local` from `clickhouse/` (init scripts in `clickhouse/init/`). The `collector` and `mailpit` services are not started (see boundary).
3. Waits past "healthy" until ClickHouse init finished: `system.row_policies` count equals the number of `CREATE ROW POLICY` lines in `clickhouse/init/*.sql` (18 today).
4. Writes the app env from `packages/app/.env.example`, overriding DB/ClickHouse ports, `BETTER_AUTH_URL=http://localhost:<web port>`, fresh per-run random values for every `*_SECRET` and `CLICKHOUSE_SQL_API_MASTER_KEY`, `INGRESS_COLLECTOR_URL` and the app telemetry endpoints pointed at a dead port (`http://127.0.0.1:9`), or at this checkout's live CLI run's OTLP origin if one is up (so app telemetry never lands in someone else's collector; the app's default is `127.0.0.1:54318`).
5. Starts the repo's own dev command `pnpm dev:web --port <p> --strictPort --host 127.0.0.1` in its own process group (`setsid`).
6. Ready means usable: `/api/health` returns `{"ok":true}`, all `packages/app/drizzle/*.sql` migrations are in `drizzle.__drizzle_migrations` (the server applies them on first load, `src/server.ts`), and both Graphile Worker runners logged `Worker connected and looking for jobs`.

Ready line: `WEB READY run=<id> url=http://localhost:<p> migrations=13/13 (25s)`. Measured: about 11s for the stack and 25s total with the ClickHouse image cached; the first Vite compile of a page adds a few seconds to the first browser step.

Seed data: none ships with the repo. Journeys create what they need (a user via sign-up, which also creates and provisions the user's personal organization).

### Web app boundary (what needs real secrets)

Reached and proven without secrets: sign-up, sign-in/out and route guards, organization creation and ClickHouse provisioning, home onboarding, API keys, Explore and Runs empty states, the GitHub page, webhook signature checks, and signed webhook acceptance using the run's own webhook secret. Blocked, with exactly what is missing:

| Capability | Missing values | Where they go |
| --- | --- | --- |
| Installing/linking the GitHub App (`Install GitHub App` -> `/api/github/install/start` -> GitHub) and therefore any workflow run reaching an org | `GITHUB_APP_INSTALL_URL` (real `https://github.com/apps/<slug>/installations/new`), `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_WEBHOOK_SECRET` equal to the App's webhook secret | `packages/app/.env` (CONTRIBUTING.md "Create a GitHub App") |
| Collector container (CI telemetry, OTLP ingest on 4317/4318/8080, GitHub log fetch) | `collector/config.yml` (copy of `collector/config.example.yml` with `receivers.githubactions.secret`, `gh_api.auth.app_id`) and `collector/dev-everr-app.pem` | repo `collector/`, bind-mounted by `docker-compose.yaml`; not in git |
| Real GitHub deliveries to a local app | `SMEE_CHANNEL` | `packages/app/.env` |
| Google sign-in button | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `packages/app/.env` |
| Billing checkout / Pro plan | `POLAR_ACCESS_TOKEN`, `POLAR_PRO_PRODUCT_ID` (and a matching `POLAR_WEBHOOK_SECRET`) for the Polar sandbox | `packages/app/.env` |
| Seeing transactional email (verification, reset, invites) | nothing secret, but the dev mailer is hardcoded to `localhost:1025` (`src/lib/mailer.server.ts`), which can't be isolated per run | run a mailpit on 1025 only if none is running |

Never invent values for these or fake a session through internal endpoints. Report the row and move on.

## Doctor

Read-only. Run first, and whenever anything looks off:

```bash
$V doctor
```

Surface A. Checks: debug build and git HEAD, warns if `packages/cli/src`, `packages/local-app/src` or `collector/cmd` changed after the binary was built (then rebuild), `everr local status` exits 0, collector `/health` and UI `/health` report the same `instance_id`, each port is still owned by the PIDs recorded at launch, `agent-browser` is on PATH, and SQL answers. Ends with `DOCTOR OK` or `DOCTOR FAILED`. On failure: `$V cleanup`, then `$V launch` again; read `/tmp/verify-everr/<RUN_ID>/logs/local.log` before cleanup if the cause is unclear.

Surface B:

```bash
$V web-doctor
```

Checks: both containers of this run's project report `healthy`, ClickHouse answers as `app_ro`, the row-policy count equals the init scripts', all drizzle migrations applied, the dev server's process group is alive, the web port is still owned by the PIDs recorded at launch, `/api/health` is `{"ok":true}`, `/auth/sign-in` serves HTML, `agent-browser` is on PATH. Lists other containers on the host as `info` (never touched). Ends with `WEB DOCTOR OK` or `WEB DOCTOR FAILED`. On failure read `/tmp/verify-everr/web-<id>/web.log`, then `$V web-cleanup` and relaunch.

## Drive

Pick the feature file from [`features/README.md`](features/README.md) and follow it. CLI primitives (surface A):

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

Web app primitives (surface B):

- Rendered app: drive it with `agent-browser` (see "Browser" below) at `$WEB` from `eval "$($V web-browser-env)"`. Journeys sign up a throwaway user; export these first:

  ```bash
  export VERIFY_NAME="Verify Bot" VERIFY_EMAIL="verify-$(date +%s)@example.com" \
         VERIFY_PASSWORD="verify-password-123" VERIFY_KEY_NAME="verify-key-$(date +%s)"
  ```
- HTTP: `$V web-http <label> <METHOD> <path> [curl args]` records command, status, headers, body.
- GitHub webhooks: `$V web-webhook <label> <event> <payload.json>` signs the body with this run's `GITHUB_APP_WEBHOOK_SECRET` (`x-hub-signature-256`), as GitHub does for a configured App.
- Side effects: `$V web-psql <label> "<SQL>"` (runs inside a read-only transaction in this run's Postgres container) and `$V web-ch <label> "<SQL>"` (ClickHouse default user, JSONEachRow).

### Browser

Every rendered-UI step uses the `agent-browser` CLI directly, in the run's own session:

```bash
eval "$($V browser-env)"       # surface A: AGENT_BROWSER_SESSION=verify-everr-<RUN_ID>, UI, SHOTS=<evidence>/ui, ab_save
eval "$($V web-browser-env)"   # surface B: AGENT_BROWSER_SESSION=verify-everr-web-<id>, WEB, SHOTS=<evidence>/web, ab_save
```

Run the `eval` in the shell you drive from (not inside `eval "$($V env)"`, whose throwaway `HOME` hides agent-browser's installed Chrome). With `AGENT_BROWSER_SESSION` set, every `agent-browser` command targets this run's browser, never another agent's, and cookies persist across commands until cleanup closes the session. The commands the recipes use:

- `agent-browser open <url>`: navigate. Exits 1 with `Navigation failed: net::ERR_...` when the origin is down.
- `agent-browser wait --text "<text>" [--timeout <ms>]` (default 25000; `web-browser-env` raises it to 90000 via `AGENT_BROWSER_DEFAULT_TIMEOUT`, because the dev server compiles each route on its first visit), `wait --fn "location.pathname === '/'"`: exit 1 on timeout. Always wait for the text you expect before capturing; the UI renders query results after load.
- `agent-browser fill "<css>" "<value>"` (replaces the value), `click "<css>"`, `find role <role> click --name "<accessible name>"` (substring match). After opening a menu or dialog, `wait --text` for its item before clicking it: it animates in, and `find` fails with `No element found` if it runs first.
- `agent-browser snapshot -i`: interactive elements with `@eN` refs, to find a handle when a recipe's selector no longer matches.
- `agent-browser press Enter`: submit the focused form. Prefer it to clicking submit: the analytics consent banner can cover the button, and `click` then refuses with `is covered by <p...>`. Do not click `Accept all` or `Deny`.
- Evidence: `ab_save <label>` (defined by the `eval`) saves `$SHOTS/<label>.png` (`agent-browser screenshot`), `.url` (`get url`) and `.txt` (`get text body`). Labels are flat (`sign-up-01-form`): `screenshot` does not create directories. Assert on the `.txt`, not on the screenshot.

Web stable handles (from source): sign-up inputs `#name`, `#email`, `#password`; sign-in `#email`, `#password`; submit `button[type=submit]`; user menu is the sidebar button containing the user's name, with menu item `Log out` (`role=menuitem`); API key dialog `#api-key-name`, switch `Send telemetry` / `Manage as code` (`role=switch`), buttons `New key`, `Create key`, `Done`. Route paths (pathless layouts stripped): `/auth/sign-up`, `/auth/sign-in`, `/organization-setup`, `/`, `/api-keys`, `/github`, `/logs`, `/traces`, `/errors`, `/runs`, `/dashboards`, `/runbooks`, `/alerts`, `/repos`, `/cost-analysis`, `/users-management`, `/billing`, `/account`; API `/api/health`, `/api/github/install/start`, `/webhook/github`.

CLI stable handles: CLI subcommands and flags from `packages/cli/src/cli.rs`; `--format json|ndjson|table` on queries (ndjson is the default off a TTY); `everr wrap` names the service `everr-wrap-<program>` and sets log attributes `everr.wrap.stream` (`stdout`/`stderr`/`exit`), `everr.wrap.command`, `everr.wrap.executable`, `everr.wrap.exit_code`. Attributes are ClickHouse `JSON` columns: read them as `LogAttributes.everr.wrap.stream`, not `LogAttributes['...']` (that errors with `ILLEGAL_TYPE_OF_ARGUMENT`). UI routes: `/logs`, `/traces`, `/traces/<traceId>`, `/errors`, `/settings`, `/developer`; the Logs search box maps to the `q` search param.

## Evidence

Surface A location: `$REPO/.verify-everr/artifacts/<RUN_ID>/` (gitignored, outside the scratch dir, so cleanup never deletes it). Layout:

- `run.txt` (run id, git HEAD/branch, binary version and mtime, launch time), `run.env`, `pids.txt`, `launch.{stdout,stderr,exit}`
- `cli/<label>/{command.txt,stdout,stderr,exit_code,at.txt}` per `$V cli` call
- `cli/<label>/until.txt` for `$V cli-until` calls
- `ui/<label>.{png,txt,url}` saved with `agent-browser` (see Browser)
- `local.log` (supervisor + collector log, copied at cleanup), `cleanup.stop.txt`

Surface B location: `$REPO/.verify-everr/artifacts/web-<RUN_ID>/`:

- `run.txt` (run id, compose project, git HEAD/branch, docker version, launch seconds), `run.env`, `app.env.redacted` (no secrets), `pids.txt`, `compose-build.log`, `compose-up.log`
- `web/<recipe>-<step>.{png,txt,url}` saved with `agent-browser` (see Browser)
- `http/<label>/{command.txt,status,headers,body}` and `delivery.txt` for webhooks
- `db/<label>/{query.sql,stdout,stderr,exit_code}`
- `web.log` (dev server + workers) and `compose.log` (container logs), copied at cleanup; `cleanup.txt`

Note: `web/api-keys-03-issued.*` contains the freshly issued `ek_` key. It is only valid against the run's database, which cleanup destroys.

Proof standards:

- Exercise the real user path: CLI commands, OTLP over HTTP, the UI routes. Do not insert rows with `curl` against the SQL port, and do not call collector internals.
- Capture the action and the resulting state: the command that produced data AND a second, read-only view of it (a `local query` and/or a UI shot), filtered by a unique per-run marker so old rows can't satisfy the check.
- Verify side effects alongside output: rows in chDB, files written (skills install), ports opened/closed, exit codes.
- No mocks: the whole loop is local, so nothing needs mocking.
- Dry-runs: `skills install --dry-run` must leave the target dir unchanged; check with `find`, don't trust the flag name.
- Web: a screenshot alone is not proof. Pair the UI end state with a second view: a reload (new page load), a different route, or a `web-psql` row.
- Web: never seed users or sessions with SQL or internal endpoints. Create them through the UI journey.
- A query exit code alone is not proof: a non-SELECT statement exits 0 with empty stdout and writes nothing (see `features/local-query.md`).

## Cleanup

```bash
$V cleanup        # surface A
$V web-cleanup    # surface B
```

`cleanup` runs `everr local stop` for this run (stops UI + collector via the supervisor), waits for the 3 run ports to close, and if any are still held, kills only the PIDs recorded at launch that still own those ports. Never kill by process name: other agents and the user may run their own `everr-local-collector`. It closes this run's `agent-browser` session (its Chrome), copies `local.log` into the evidence dir, deletes `/tmp/verify-everr/<RUN_ID>/` (data, throwaway HOME, extracted assets) and `.verify-everr/current` if it names this run, then lists the evidence that survived. Run it after every attempt, including failed ones. Also remove any scratch dirs a feature recipe created (they say so).

`web-cleanup` sends SIGTERM (then SIGKILL) to the dev server's recorded process group, waits for the web port to close, closes this run's `agent-browser` session, copies `web.log` and `compose logs`, then runs `docker compose -p <this run's project> ... down -v --remove-orphans`, which removes only this project's containers, network and named volumes, and warns about any container still labeled with the project. It deletes `/tmp/verify-everr/web-<id>/` (env with secrets; refused unless it resolves inside the scratch root) and `.verify-everr/current-web` if it names this run, and lists the surviving evidence. Never `docker compose down` without `-p`, never `docker rm` by name: the developer's stack (project `everr`) may be running on the same host.

## Helpers

- `scripts/verify-everr.ts` (executable TypeScript entry, run by Node). Subcommands: `build`, `launch [RUN_ID]`, `doctor`, `env`, `cli <label> -- ARGS`, `cli-until <label> <text> -- ARGS`, `ui-get <path>`, `ui-cmd <command> [json]`, `browser-env`, `cleanup`, and `web-launch [RUN_ID]`, `web-doctor`, `web-env`, `web-browser-env`, `web-http <label> <METHOD> <path> [curl args]`, `web-webhook <label> <event> <payload>`, `web-psql <label> <SQL>`, `web-ch <label> <SQL>`, `web-cleanup`. Run it with no args for usage. Env knobs: `EVERR_VERIFY_SCRATCH` (scratch root, default `/tmp/verify-everr`), `VERIFY_BUILD_OTLP_ENDPOINT` (where `build` sends its own spans, default the dead port `http://127.0.0.1:9`), `VERIFY_CWD` (cwd for `cli`), `UNTIL_S`, and `RUN_ID` / `WEB_RUN_ID` to target a run other than the current one.
- `scripts/common.ts`: paths, run-id validation, scratch-root containment, ports, process helpers.
- `scripts/web.ts`: the `web-*` subcommands.
- `scripts/package.json`: only `"type": "module"`, so Node loads the `.ts` files as ES modules without a warning.
- `scripts/compose.verify.yaml`: the per-run compose override (ports, volumes, ClickHouse image tag).
- `scripts/workflow-run.webhook.json`: a minimal signed-webhook payload for `web-webhook`.

Maintain the feature map with `/maintain-verification-skill` when commands, routes, or attributes change.
