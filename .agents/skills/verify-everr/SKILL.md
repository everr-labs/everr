---
name: verify-everr
description: Drive Everr the way a user does, in isolated throwaway instances, and capture proof. Two surfaces, the `everr` CLI with its local stack (embedded collector, chDB, local browser UI) and the hosted web app `packages/app` (docker compose ClickHouse + Postgres + an OTLP-only collector, `pnpm dev:web`, the browser driven with the `agent-browser` CLI). Use when a change touches `packages/cli`, `collector/cmd/everr-local-collector`, `packages/local-app`, `packages/telemetry-explorer` or `packages/app`, or when you must prove `everr local`/`wrap`/`skills`, the local Logs UI, or web sign-up/sign-in, API keys, Explore pages with seeded logs/traces/errors, dashboards and runbooks applied as code, the browser SDK `@everr/otel-web` against public ingest, session replay, or the GitHub connect boundary actually work.
user-invocable: true
metadata:
  internal: true
---

# Verify Everr (CLI + local stack, and the web app)

This skill covers two surfaces. Each has its own Launch, Doctor, Drive and Cleanup, and both write evidence under `.verify-everr/artifacts/`. They are independent: run either alone, or both at once.

- **A. CLI + local stack** (`launch`, `doctor`, `cli`, `ui-*`, `browser-env`, `cleanup`).
- **B. Web app `packages/app`** (`web-launch`, `web-doctor`, `web-browser-env`, `web-http`, `web-webhook`, `web-psql`, `web-ch`, `web-key-save`, `web-key`, `web-onboard`, `web-seed`, `web-apply`, `web-net`, `web-collector-restart`, `web-sdk-page`, `web-record`, `web-report`, `web-images`, `web-cleanup`). Implemented in `scripts/web.ts`.

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

Memory: a web run needs about 3.5 GiB (measured: ~2.5 GiB right after launch, ClickHouse ~0.3-0.9 and the dev server ~1.2-2.3, growing as routes compile). Hosts without swap OOM-kill instead of slowing down (the reference box has 15 GiB and no swap, and other agents' stacks share it). `web-launch` prints `memory: <available> ...` and refuses with `MEMORY: this run will not fit` when available memory is below that; `--ignore-memory` overrides. Run one web stack at a time per agent, and clean up before launching another.

Prerequisites: a reachable Docker daemon with the Compose plugin (>= 2.24 for `!override`); the helper uses `docker`, or `sudo -n docker` when the user is not in the `docker` group. Node >= 23 and pnpm 11 as above (`pnpm install` runs if `node_modules` is missing), `agent-browser`.

```bash
$V web-launch            # or: $V web-launch <RUN_ID>
```

What it does, in order:

1. Picks 6 free ports (ClickHouse HTTP, Postgres, web, collector OTLP/HTTP and OTLP/gRPC, the SDK test page) and compose project `verify-everr-<run id>`.
2. `docker compose -p <project> -f docker-compose.yaml -f scripts/compose.verify.yaml up -d --wait clickhouse postgres` (the collector starts later, step 3). The override (`!override`) rebinds ports to `127.0.0.1:<run port>` and swaps the `./volumes/*` bind mounts for project-scoped named volumes, so the developer's own stack (project `everr`, ports 5432/8123/8080/4317/4318/1025/8025, `./volumes/`) is never shared or touched. Images are tagged per source tree, so checkouts never race on one tag: `everr-verify-clickhouse:<tag>` from `clickhouse/` and `everr-verify-collector:<tag>` from `collector/`, where `<tag>` is the git tree hash of that directory at HEAD, or `dirty-<hash of the diff and untracked files>` when the working copy has changes there. An existing clean tag is reused without `compose build`; a dirty tree always rebuilds (cached layers make that cheap unless Go sources changed). Tags are in `run.txt` (`images:`). `mailpit` is not started (see boundary).
   The collector config is generated at launch from this checkout's own `collector/config.example.yml` (`scripts/collector-config.ts`), so a PR that changes the example (CORS headers, new pipelines, routing connectors, exporters) is verified with its own config. Generation deletes the `githubactions` receiver and every pipeline that reads it (so no `collector/config.yml` or `.pem` is needed), checks every connector is still used on both sides, rewrites receiver endpoints to the run's loopback OTLP ports, `clickhouse:8123` exporter endpoints to the run's ClickHouse port, and the `everr_apikey` extension to this run's app and secret, then refuses to write a config that still mentions `clickhouse:8123`, `0.0.0.0:` or `host.docker.internal`. Everything else (CORS, processors, connectors, file_storage queues, exporters) is the example's. The result is `/tmp/verify-everr/web-<id>/collector-config.yaml` (mounted read-only) with a copy in the evidence dir; launch prints the kept pipelines and CORS headers. After editing the example mid-run, `$V web-collector-restart` regenerates and recreates only the collector (about 2s). It keeps the real public ingest path: OTLP receivers authenticated by the `everr_apikey` extension (which checks each Bearer key against the app's `/api/internal/verify-key` with the run's `INGEST_VERIFY_SHARED_SECRET`), the processors that strip client-sent `everr.tenant.id` and stamp the key's organization, and the ClickHouse exporter into the `otel.*` landing tables, whose materialized views write `app.logs`/`app.traces`. It uses host networking (Linux) and listens only on the run's loopback OTLP ports.
3. Waits past "healthy" until ClickHouse init finished: `system.row_policies` count equals the number of `CREATE ROW POLICY` lines in `clickhouse/init/*.sql` (18 on main). Only then starts the collector (`up -d --no-deps collector`) and waits until its OTLP/HTTP receiver answers `401` to a request without a key. The order matters: the ClickHouse exporter detects the table schema once at startup, and against a half-initialized ClickHouse that fails (`schema detection failed ... connection reset`), after which the collector writes logs without the attribute-key columns and `/errors` shows `No exception logs found`. `docker-compose.yaml`'s `depends_on: service_healthy` is not enough (healthy comes before the init scripts finish).
4. Writes the app env from `packages/app/.env.example`, overriding DB/ClickHouse ports, `BETTER_AUTH_URL=http://localhost:<web port>`, fresh per-run random values for every `*_SECRET` and `CLICKHOUSE_SQL_API_MASTER_KEY` (the collector gets the same `INGEST_VERIFY_SHARED_SECRET` through `compose.env`), `INGRESS_COLLECTOR_URL` and the app telemetry endpoints pointed at a dead port (`http://127.0.0.1:9`), or at this checkout's live CLI run's OTLP origin if one is up (so app telemetry never lands in someone else's collector; the app's default is `127.0.0.1:54318`).
5. Starts the repo's own dev command `pnpm dev:web --port <p> --strictPort --host 127.0.0.1` in its own process group (`setsid`).
6. Ready means usable: `/api/health` returns `{"ok":true}`, all `packages/app/drizzle/*.sql` migrations are in `drizzle.__drizzle_migrations` (the server applies them on first load, `src/server.ts`), and both Graphile Worker runners logged `Worker connected and looking for jobs`.

Ready line: `WEB READY run=<id> url=http://localhost:<p> migrations=13/13 (26s)`. Measured: about 12s for the stack and 26s total with both images cached for this tree. When a tree hash has no image yet (a new checkout, or any change under `collector/` or `clickhouse/`), launch rebuilds and takes about 150s, up to about 300s on a busy host with a cold Go build (measured 298s on 2026-10-20). Give the launch command a timeout of at least 10 minutes. The first Vite compile of a page adds a few seconds to the first browser step.

Seed data: none ships with the repo. Recipes create what they need: a user via sign-up (which also creates and provisions the user's personal organization), an `ek_` key via the API keys page (kept in the scratch dir with `web-key-save`), and telemetry via `$V web-seed`, which sends fixed logs, spans and an exception over OTLP with that key (`features/web-explore.md`).

### Web app boundary (what needs real secrets)

Reached and proven without secrets: sign-up, sign-in/out and route guards, organization creation and ClickHouse provisioning, home onboarding, API keys (secret and public), public OTLP ingest with a run key, the browser SDK from an allowed origin (CORS), session replay, Explore logs/traces/errors with seeded data, Explore and Runs empty states, the GitHub page, webhook signature checks, and signed webhook acceptance using the run's own webhook secret. Blocked, with exactly what is missing:

| Capability | Missing values | Where they go |
| --- | --- | --- |
| Installing/linking the GitHub App (`Install GitHub App` -> `/api/github/install/start` -> GitHub) and therefore any workflow run reaching an org | `GITHUB_APP_INSTALL_URL` (real `https://github.com/apps/<slug>/installations/new`), `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_WEBHOOK_SECRET` equal to the App's webhook secret | `packages/app/.env` (CONTRIBUTING.md "Create a GitHub App") |
| The collector's GitHub Actions receiver (CI traces and job logs from webhooks; run detail pages under `/runs`). Public OTLP ingest does not need it and runs in every web run | `collector/config.yml` (copy of `collector/config.example.yml` with `receivers.githubactions.secret`, `gh_api.auth.app_id`) and `collector/dev-everr-app.pem` | repo `collector/`, bind-mounted by `docker-compose.yaml`; not in git |
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

Checks: the `clickhouse` and `postgres` containers of this run's project report `healthy`, its `collector` container is `running` and its OTLP/HTTP port answers `401` without a key, the run's collector config equals what `collector/config.example.yml` generates now (lists the pipeline count and exporters; on a mismatch run `$V web-collector-restart`), a browser CORS preflight (`OPTIONS /v1/logs` with an allowed origin and the example's `allowed_headers`) returns `204` with `Access-Control-Allow-Origin` (reported as `info` when the example sets no CORS), the collector log has no `schema detection failed` lines (the ClickHouse exporter's own message, which carries the cause such as `connection reset`) (the startup race above; fix with `$V web-collector-restart`), ClickHouse answers as `app_ro`, host memory available and this run's own use (containers plus dev server; `WARN` below 1 GiB available, not a failure), the init row-policy count equals the init scripts' (per-organization `sql_api_org_*` policies created at sign-up are not counted), all drizzle migrations applied, the dev server's process group is alive, the web port is still owned by the PIDs recorded at launch, `/api/health` is `{"ok":true}`, `/auth/sign-in` serves HTML, `agent-browser` is on PATH. Lists other containers on the host as `info` (never touched). Ends with `WEB DOCTOR OK` or `WEB DOCTOR FAILED`. On failure read `/tmp/verify-everr/web-<id>/web.log`, then `$V web-cleanup` and relaunch.

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
- Onboarding: `$V web-onboard` (after sign-up) sets the browser to 1280x800, answers the consent banner with `Deny` so it never covers screenshots or buttons, and clicks through the four Home onboarding steps (focus + Enter), saving `web/onboard-*` and checking `organization.metadata.onboardingCompleted`. Prints `ONBOARDED ...`; idempotent. Recipes that need Home's dashboard view, or clean screenshots, run it right after sign-up.
- Keys: `agent-browser get text body | $V web-key-save <name>` (while the `Copy your key now` dialog is open) stores the `ek_` key in `/tmp/verify-everr/web-<id>/keys/<name>` (mode 600, deleted by cleanup). Recipes use the names `secret` and `public`. `$V web-key <name>` prints a saved key. Never scrape a key from the `/api-keys` list: it shows only `ek_` plus three characters (6 characters in all), and only the full-key pattern `\bek_[A-Za-z0-9_-]{20,}` (what both helpers use) is a usable key.
- As code: `$V web-apply <body.json> [--key-name N] [--dry-run]` POSTs an `everr apply` body (`{"repoid", "state": {"dashboards", "runbooks", "alerts"}}`) to `/api/apply` with a saved key that has `Manage as code` (default name `secret`). Records `http/apply-<body>/{request.json,command.txt (key redacted),status,body}` and prints created/updated/deleted per kind; exit 1 unless `200`. Example body: `scripts/apply-examples/dashboard-runbook.json` (see `features/web-dashboards.md`).
- Network: `$V web-net <label> <seconds> [--reload]` clears this browser's network log, optionally reloads the current page, waits, and writes `net/<label>.requests.txt` plus `net/<label>.serverfn.txt`: total requests, `/_serverFn/` calls decoded to function names with counts (`GET getTraceReplay` ...), and new page errors split into the known hydration mismatch and others. Use it for refetch loops and "what does this page load" questions.
- Telemetry: `$V web-seed [--key-name NAME | --key-file FILE]` posts fixed OTLP/JSON logs (3, one an exception) and one 3-span error trace to this run's collector with the saved key (default name `secret`), checks that an invalid key gets `401`, waits until the rows are in `app.logs`/`app.traces`, and checks their `tenant_id` is the key's organization (`apikey.reference_id`), not the `everr.tenant.id` the payload claims. Ends with `SEEDED run=<id> service=verify-seed-api logs=3 errors=1 spans=3 traces=1 trace=<id> tenant=<org>`. Once per run (counts in recipes assume it). Markers are constants (`SEED` in `scripts/web.ts`).
- Browser SDK: `$V web-sdk-page [--local]` bundles this checkout's `packages/otel-web/src` (esbuild from the repo's own `node_modules`) into a small integrator page (buttons `#add`, `#boom`, `#fail-fetch`, `#emit`; `#status` reads `sdk ready (recording on|off)`), serves it at `SDK_PAGE_ORIGIN`, and writes `SDK_URL` (page plus `otlp` and `key` query params) for `web-browser-env`. Default: this run's collector with the saved `public` key. `--local`: the live CLI run's local collector (`$V launch`), no key. Recording is on when the checkout has `src/recording.ts`. The server is stopped by `web-cleanup`. See `features/web-browser-sdk.md`.
- Side effects: `$V web-psql <label> "<SQL>"` (runs inside a read-only transaction in this run's Postgres container) and `$V web-ch <label> "<SQL>"` (ClickHouse default user, JSONEachRow).

### Browser

Every rendered-UI step uses the `agent-browser` CLI directly, in the run's own session:

```bash
eval "$($V browser-env)"       # surface A: AGENT_BROWSER_SESSION=verify-everr-<RUN_ID>, UI, SHOTS=<evidence>/ui, ab_save
eval "$($V web-browser-env)"   # surface B: AGENT_BROWSER_SESSION=verify-everr-web-<id>, WEB, SHOTS=<evidence>/web, SDK_PAGE_ORIGIN, SDK_URL, ab_save
```

Run the `eval` in the shell you drive from (not inside `eval "$($V env)"`, whose throwaway `HOME` hides agent-browser's installed Chrome). With `AGENT_BROWSER_SESSION` set, every `agent-browser` command targets this run's browser, never another agent's, and cookies persist across commands until cleanup closes the session. The commands the recipes use:

- `agent-browser open <url>`: navigate. Exits 1 with `Navigation failed: net::ERR_...` when the origin is down.
- `agent-browser wait --text "<text>" [--timeout <ms>]` (default 25000; `web-browser-env` raises it to 90000 via `AGENT_BROWSER_DEFAULT_TIMEOUT`, because the dev server compiles each route on its first visit), `wait --fn "location.pathname === '/'"`: exit 1 on timeout. Always wait for the text you expect before capturing; the UI renders query results after load.
- `agent-browser fill "<css>" "<value>"` (replaces the value), `click "<css>"`, `find role <role> click --name "<accessible name>"` (substring match). After opening a menu or dialog, `wait --text` for its item before clicking it: it animates in, and `find` fails with `No element found` if it runs first.
- `agent-browser snapshot -i`: interactive elements with `@eN` refs, to find a handle when a recipe's selector no longer matches.
- `agent-browser press Enter`: submit the focused form. Prefer it to clicking submit: the analytics consent banner can cover the button, and `click` then refuses with `is covered by <p...>`. The banner is answered once per session with `Deny` by `web-onboard` (never `Accept all`, which turns on analytics storage); before that, use Enter or focus + Enter.
- `agent-browser focus @eN` then `press Enter`, or `eval '<js>.focus()'` then `press Enter`: activate a button the consent banner covers (`New public key`). `find` has no `focus` action.
- `agent-browser network requests [--filter <substring>] [--clear]`: requests since the last `--clear`, one per line (`[id] METHOD url (Type) status`). Use it to count requests (a refetch loop) or to see OTLP exports and their CORS preflights from the SDK page. Clear right before the window you measure.
- `agent-browser errors` and `agent-browser console`: page errors and console output. They accumulate across navigations in the session, so do not assert emptiness; use them to explain a failure.
- `agent-browser eval '<js>'`: evaluate in the page and print the result (button `disabled` state, a player's `currentTime`).
- Lazy grids: dashboard grids mount panels only when they scroll into view, and the page itself does not scroll; the pane's inner scroll area (`main [data-slot=scroll-area-viewport]`) does. Before counting panels or links, scroll that element to the bottom in steps (the `SCROLL` snippet in `features/web-dashboards.md`); `agent-browser scroll down` scrolls the window and does nothing here.
- `agent-browser errors`: in 0.39.1 the plain form prints bare `✗` lines and `errors --clear` does not clear, so never assert "no errors" with it. Use `agent-browser --json errors` (has the text) and compare counts before and after an action, or `$V web-net`. Every page of the app logs one React `Hydration failed because the server rendered HTML didn't match the client` error on load (site-wide at e138f4d, present on `/logs` too): report it as a known pre-existing error, not a PR bug, unless the PR's page logs a different one or more of them.
- A first visit that compiles a large route (`/runs`) can outlast `agent-browser open`'s own fixed navigation timeout before any `wait --timeout` starts. Navigate without waiting for load, then wait: `agent-browser eval "location.assign('$WEB/runs')" && agent-browser wait --timeout 180000 --text "..."`.
- Evidence: `ab_save <label> ["<caption>"]` (defined by the `eval`) saves `$SHOTS/<label>.png` (`agent-browser screenshot`), `.url` (`get url`), `.txt` (`get text body`) and, with a second argument, `.caption` (the claim the screenshot backs, used by `web-report`). Labels are flat (`sign-up-01-form`): `screenshot` does not create directories. Assert on the `.txt`, not on the screenshot.

Web stable handles (from source): sign-up inputs `#name`, `#email`, `#password`; sign-in `#email`, `#password`; submit `button[type=submit]`; user menu is the sidebar button containing the user's name, with menu item `Log out` (`role=menuitem`); API key dialog `#api-key-name`, switch `Send telemetry` / `Manage as code` (`role=switch`), buttons `New key`, `Create key`, `Done`; public key dialog labels `Name` and `Allowed origins` (one origin per line), buttons `New public key`, `Create public key`. Explore filters are URL params; `service` is a JSON array shared by `/logs`, `/traces`, `/errors` (`?service=%5B%22<name>%22%5D`). Route paths (pathless layouts stripped): `/auth/sign-up`, `/auth/sign-in`, `/organization-setup`, `/`, `/api-keys`, `/github`, `/logs`, `/traces`, `/errors`, `/runs`, `/dashboards`, `/runbooks`, `/alerts`, `/repos`, `/cost-analysis`, `/users-management`, `/billing`, `/account`; API `/api/health`, `/api/github/install/start`, `/webhook/github`.

CLI stable handles: CLI subcommands and flags from `packages/cli/src/cli.rs`; `--format json|ndjson|table` on queries (ndjson is the default off a TTY); `everr wrap` names the service `everr-wrap-<program>` and sets log attributes `everr.wrap.stream` (`stdout`/`stderr`/`exit`), `everr.wrap.command`, `everr.wrap.executable`, `everr.wrap.exit_code`. Attributes are ClickHouse `JSON` columns: read them as `LogAttributes.everr.wrap.stream`, not `LogAttributes['...']` (that errors with `ILLEGAL_TYPE_OF_ARGUMENT`). UI routes: `/logs`, `/traces`, `/traces/<traceId>`, `/errors`, `/settings`, `/developer`; the Logs search box maps to the `q` search param.

## Evidence

Surface A location: `$REPO/.verify-everr/artifacts/<RUN_ID>/` (gitignored, outside the scratch dir, so cleanup never deletes it). Layout:

- `run.txt` (run id, git HEAD/branch, binary version and mtime, launch time), `run.env`, `pids.txt`, `launch.{stdout,stderr,exit}`
- `cli/<label>/{command.txt,stdout,stderr,exit_code,at.txt}` per `$V cli` call
- `cli/<label>/until.txt` for `$V cli-until` calls
- `ui/<label>.{png,txt,url}` saved with `agent-browser` (see Browser)
- `local.log` (supervisor + collector log, copied at cleanup), `cleanup.stop.txt`

Surface B location: `$REPO/.verify-everr/artifacts/web-<RUN_ID>/`:

- `run.txt` (run id, compose project, git HEAD/branch, docker version, image tags, launch seconds), `run.env`, `app.env.redacted` (no secrets), `pids.txt`, `compose-build.log`, `compose-up.log`, `collector-config.yaml` (the generated config), `compose-collector-restart.log`
- `sdk-page/` from `web-sdk-page`: `entry.ts`, `index.html`, `build.log`, `page.txt` (origin, endpoint, key prefix, recording on/absent)
- `web/<recipe>-<step>.{png,txt,url}` saved with `agent-browser` (see Browser)
- `http/<label>/{command.txt,status,headers,body}` and `delivery.txt` for webhooks
- `seed/` from `web-seed`: `traces.json`, `logs.json` (the exact payloads), `seed.txt` (responses, row counts, tenant check, `SEEDED` line), `rows.json`, `trace_id`
- `db/<label>/{query.sql,stdout,stderr,exit_code}`
- `web.log` (dev server + workers) and `compose.log` (container logs, including the collector), copied at cleanup; `cleanup.txt`

- `net/<label>.{requests,serverfn,errors}.txt` from `web-net`; `http/apply-*/` from `web-apply`; `report.md` from `web-report`
- `video/` from `web-record`: `<name>.mp4`, `<name>-<frame>.png`, `<name>.timeline.txt`, `<name>.probe.txt`

Visual proof (required for any change that touches UI):

- A verification report backs every UI claim with an image: a screenshot per claim (`ab_save <label> "<claim>"`) or a `web-record` video with key frames. A UI claim with no image or video behind it is unverified, and the report says so in those words.
- Take screenshots after the data renders: `wait --text` for the asserted text first, then `ab_save`. Dismiss the consent banner first (`$V web-onboard` does it) and use the 1280x800 viewport (`web-onboard` sets it; otherwise `agent-browser set viewport 1280 800`; `web-record` defaults to it).
- `ab_save` sleeps 0.7s before the screenshot: after a client-side navigation the DOM (what `wait` and the `.txt` see) updates before the compositor paints, and an immediate screenshot showed the previous page (observed 2026-10-20 on the dashboards panel link). Also wait for something that only the new page lacks or has, not text both pages share.
- Before reporting, open each image (Read the PNG) and confirm it shows what its caption claims: the asserted data is visible, nothing covers it, it is the right page. Fix or drop captions that do not match. When a shot is re-taken, copy it to a new file name before opening it again: an image viewer can serve the earlier version of a path it already showed.
- `$V web-report [RUN_ID]` collects the run's videos (with timeline and key frames) and screenshots with their captions and URLs into `<evidence>/report.md`, with image links relative to the evidence dir, plus a checklist for the two rules above. Prints `REPORT ... screenshots=<n> uncaptioned=<n>`; give every screenshot that backs a claim a caption. Attach or link `report.md` in the verification report.

Video (`web-record`): a Playwright recording of a scripted journey, for a reviewer who wants to watch the change rather than read `.txt` files. It is a companion to the `agent-browser` evidence, not a replacement: assert with recipes, record afterwards.

```bash
$V web-record --steps .agents/skills/verify-everr/scripts/record-examples/explore-seeded.ts [--name explore] [--viewport 1280x800] [--no-captions] [--crf 28] [--max-mb 10]
```

- Defaults from the current web run: `--base-url` is the run's app, `--storage-state` is this run's `agent-browser` session (saved with `agent-browser state save` into the scratch dir, so the signed-in user carries over; sign up first), `--out` is `<evidence>/video`. Any of them passed explicitly wins; `--cookie name=value` replaces the storage state.
- The steps file default-exports `async (r) => { ... }`, with `r.page` (the recorded Playwright page), `r.base`, `r.caption(text, {sub, tone})`, `r.frame(name)`, `r.step(label)`, `r.hold(ms)`, `r.now()` (see `scripts/record.ts`). `scripts/record-examples/explore-seeded.ts` is a generic example (the seeded Explore pages after `web-seed`); write PR-specific journeys the same way, taking ports and keys from `r.base` or the environment, never hardcoded. Steps files need a `"type": "module"` `package.json` above them (`scripts/package.json` covers files under `scripts/`).
- Output: H.264 High, yuv420p, 25 fps, faststart, no audio (plays on GitHub and in chat). Last line `RECORDED <mp4> codec=h264 duration=<s> size=<MB> frames=<n>`. If a step throws, the video so far is still encoded, `<name>-failure.png` is saved, and the exit code is 1. Check with `ffprobe` (the helper writes `<name>.probe.txt`).
- Prerequisites: `playwright-core` (not a repo dependency) plus Playwright's own ffmpeg for its raw video: `npm i --prefix ~/.cache/verify-everr/playwright playwright-core && ~/.cache/verify-everr/playwright/node_modules/.bin/playwright-core install ffmpeg` (or point `VERIFY_PLAYWRIGHT_DIR` at a dir whose `node_modules` has it). System `ffmpeg` and `ffprobe` with libx264 (`apt-get install ffmpeg`). Chrome: `VERIFY_CHROME`, else agent-browser's downloaded Chrome, else `google-chrome`/`chromium` on PATH. Headless; Linux tested.
- The video runs in real time: on a loaded host, page loads show up as long stalls. Record on an idle box, after the recipes passed.

Note: `web/api-keys-03-issued.*` and `web/api-keys-07-public-issued.*` contain the freshly issued `ek_` keys (the helper reads keys from the scratch dir, never from evidence). It is only valid against the run's database, which cleanup destroys.

Proof standards:

- Exercise the real user path: CLI commands, OTLP over HTTP, the UI routes. Do not insert rows with `curl` against the SQL port, and do not call collector internals.
- Capture the action and the resulting state: the command that produced data AND a second, read-only view of it (a `local query` and/or a UI shot), filtered by a unique per-run marker so old rows can't satisfy the check.
- Verify side effects alongside output: rows in chDB, files written (skills install), ports opened/closed, exit codes.
- No mocks: the whole loop is local, so nothing needs mocking.
- Dry-runs: `skills install --dry-run` must leave the target dir unchanged; check with `find`, don't trust the flag name.
- Web: a screenshot alone is not proof. Pair the UI end state with a second view: a reload (new page load), a different route, or a `web-psql` row.
- Web: never seed users or sessions with SQL or internal endpoints. Create them through the UI journey.
- Web: telemetry goes in only through `web-seed` (OTLP through the run's collector with a UI-created key). Never insert into `otel.*`/`app.*` with `web-ch`: that skips the key check and tenant stamping the proof is about.
- A query exit code alone is not proof: a non-SELECT statement exits 0 with empty stdout and writes nothing (see `features/local-query.md`).

## Cleanup

```bash
$V cleanup        # surface A
$V web-cleanup    # surface B
```

`cleanup` runs `everr local stop` for this run (stops UI + collector via the supervisor), waits for the 3 run ports to close, and if any are still held, kills only the PIDs recorded at launch that still own those ports. Never kill by process name: other agents and the user may run their own `everr-local-collector`. It closes this run's `agent-browser` session (its Chrome), copies `local.log` into the evidence dir, deletes `/tmp/verify-everr/<RUN_ID>/` (data, throwaway HOME, extracted assets) and `.verify-everr/current` if it names this run, then lists the evidence that survived. Run it after every attempt, including failed ones. Also remove any scratch dirs a feature recipe created (they say so).

`web-cleanup` sends SIGTERM (then SIGKILL) to the dev server's recorded process group, stops the SDK page server's process group if `web-sdk-page` ran, waits for the web port to close, closes this run's `agent-browser` session, copies `web.log` and `compose logs`, then runs `docker compose -p <this run's project> ... down -v --remove-orphans`, which removes only this project's containers (collector included), network and named volumes (`clickhouse-data`, `postgres-data`, `collector-queue`), and warns about any container still labeled with the project. It deletes `/tmp/verify-everr/web-<id>/` (env with secrets; refused unless it resolves inside the scratch root) and `.verify-everr/current-web` if it names this run, and lists the surviving evidence. Images are not removed by cleanup (the next run of the same tree reuses them). They accumulate one pair per collector/ClickHouse tree; `$V web-images` lists them and `$V web-images --prune` removes this skill's stale ones: only `everr-verify-clickhouse`/`everr-verify-collector` tags in the skill's own format (16-hex tree hash or `dirty-<hash>`), never the current checkout's tags, never a tag any container (any project, running or stopped) was created from, never other tags (`local`, hand-made ones). Opt-in; run it after cleanup when disk is short. Never `docker compose down` without `-p`, never `docker rm` by name: the developer's stack (project `everr`) may be running on the same host.

## Helpers

- `scripts/verify-everr.ts` (executable TypeScript entry, run by Node). Subcommands: `build`, `launch [RUN_ID]`, `doctor`, `env`, `cli <label> -- ARGS`, `cli-until <label> <text> -- ARGS`, `ui-get <path>`, `ui-cmd <command> [json]`, `browser-env`, `cleanup`, and `web-launch [RUN_ID]`, `web-doctor`, `web-env`, `web-browser-env`, `web-http <label> <METHOD> <path> [curl args]`, `web-webhook <label> <event> <payload>`, `web-psql <label> <SQL>`, `web-ch <label> <SQL>`, `web-key-save <name>`, `web-seed [--key-name N | --key-file F]`, `web-collector-restart`, `web-sdk-page [--local]`, `web-record --steps F [...]`, `web-key <name>`, `web-onboard`, `web-apply <body> [...]`, `web-net <label> <s> [--reload]`, `web-report [RUN_ID]`, `web-images [--prune]`, `web-cleanup`. Run it with no args for usage. Env knobs: `EVERR_VERIFY_SCRATCH` (scratch root, default `/tmp/verify-everr`), `VERIFY_BUILD_OTLP_ENDPOINT` (where `build` sends its own spans, default the dead port `http://127.0.0.1:9`), `VERIFY_CWD` (cwd for `cli`), `UNTIL_S`, and `RUN_ID` / `WEB_RUN_ID` to target a run other than the current one.
- `scripts/common.ts`: paths, run-id validation, scratch-root containment, ports, process helpers.
- `scripts/web.ts`: the `web-*` subcommands.
- `scripts/package.json`: only `"type": "module"`, so Node loads the `.ts` files as ES modules without a warning.
- `scripts/compose.verify.yaml`: the per-run compose override (ports, volumes, image tags, and the host-networked `collector` service).
- `scripts/collector-config.ts`: generates the run's collector config from `collector/config.example.yml` (uses the repo's `yaml` package through `packages/app`'s dependencies). No hand-kept copy exists; do not add one.
- `scripts/apply-examples/dashboard-runbook.json`: an as-code body (dashboard `verify/traffic` with a static-list variable and 2 panels, runbook `verify/verify-runbook` embedding one) for `web-apply`.
- `scripts/record.ts`: the `web-record` recorder (Playwright + ffmpeg); runnable standalone. `scripts/record-examples/`: generic steps files.
- `scripts/sdk-page/`: `index.html`, `entry.template.ts` (the page `web-sdk-page` bundles) and `serve.ts` (loopback static server).
- `scripts/workflow-run.webhook.json`: a minimal signed-webhook payload for `web-webhook`.

Maintain the feature map with `/maintain-verification-skill` when commands, routes, or attributes change.
