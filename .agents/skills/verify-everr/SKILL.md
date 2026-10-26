---
name: verify-everr
description: Drive Everr the way a user does, in isolated throwaway instances, and capture proof. Two surfaces, the `everr` CLI with its local stack (embedded collector, chDB, local browser UI) and App/Cloud through the standard `pnpm dev` stack, with the browser driven by `agent-browser`. Use when a change touches `packages/cli`, `collector/cmd/everr-local-collector`, `packages/local-app`, `packages/telemetry-explorer` or `packages/app`, or when you must prove `everr local`/`wrap`/`skills`, the local Logs UI, or web sign-up/sign-in, API keys, Explore pages with seeded logs/traces/errors, dashboards and runbooks applied as code, the browser SDK `@everr/otel-web` against public ingest, session replay, or the GitHub connect boundary actually work.
user-invocable: true
metadata:
  internal: true
---

# Verify Everr (CLI + local stack, and the web app)

This skill covers two surfaces. Each has its own Launch, Doctor, Drive and Cleanup, and both write evidence under `.verify-everr/artifacts/`. They are independent: run either alone, or both at once.

- **A. CLI + local stack** (`launch`, `doctor`, `cli`, `ui-*`, `browser-env`, `cleanup`).
- **B. App and Cloud** (`web-launch`, `web-doctor`, `web-browser-env`, `web-http`, `web-webhook`, `web-psql`, `web-ch`, `web-key-save`, `web-key`, `web-onboard`, `web-seed`, `web-apply`, `web-net`, `web-collector-restart`, `web-sdk-page`, `web-record`, `web-report`, `web-cleanup`). Implemented in `scripts/web.ts`.

Surface A: the `everr` CLI, in particular the local telemetry loop (`everr local start` boots a supervisor that serves the local UI and runs the embedded Go collector with in-process chDB; `everr wrap` and any OTLP exporter write into it; `everr local query` and the local UI read from it). Everything here runs offline with no auth.

Surface B: App and Cloud (Vite, better-auth, Drizzle/Postgres, ClickHouse, Graphile Worker). Cloud is selected by default for its sign-up and organization-provisioning recipes. Use `web-launch --app app` for the self-hosted installation setup. Each run creates a throwaway user through the browser in a fresh database. The `.auth` file AGENTS.md mentions holds credentials for the developer's own long-lived dev database; an isolated run does not use it. What does need real secrets is listed under "Web app boundary" below.

Not covered:

- Cloud-backed CLI commands need a separate authenticated session. When testing them against a web run, isolate `EVERR_CONFIG_DIR` and point login at the selected app; use its backing loopback HTTP port if the CLI cannot trust the local Portless CA.
- Docs site `packages/docs` (`pnpm dev:docs`, port 3000), Storybook.

Everything goes through one helper: `.agents/skills/verify-everr/scripts/verify-everr.ts` (below: `V`), TypeScript that Node >= 24 runs directly (no build step or separate dependency install). Run it from anywhere (`$V ...`, or `node $V ...`); it resolves the repo from its own path.

```bash
V=.agents/skills/verify-everr/scripts/verify-everr.ts
```

## Launch

### A. CLI + local stack

1. Toolchain (once per machine). The build needs: Node >= 24 (repo pins `.nvmrc` = 24; Node 20 cannot run the `.ts` build scripts), pnpm via corepack (version pinned in `packageManager`), stable Rust (CI uses `dtolnay/rust-toolchain@stable`), Go >= the `collector/go.mod` version (1.26), `make`, a C toolchain, `curl`, `tar`. The helper itself runs on that Node and needs `ss` (Linux) or `lsof` (macOS), and `curl` (`web-http`); some recipes also use `jq`. The browser is driven with the [`agent-browser`](https://www.npmjs.com/package/agent-browser) CLI (required for every UI step; `doctor` and `web-doctor` check it): `npm install -g agent-browser && agent-browser install` (downloads its Chrome; on a bare Linux host add `--with-deps`). Tested with 0.39.1. Port ownership is checked with `ss -ltnp` on Linux and `lsof` on macOS.
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

### B. App and Cloud

Prerequisites are the standard [worktree development](../../../docs/development.md) toolchain, a reachable Docker daemon, and `agent-browser`. Both packages use their existing GitHub settings in dotenv files, just as normal development does. The standard startup copies each unconfigured package's `.env` from the primary worktree; existing package configuration stays untouched. Cloud also reads its required optional-service settings from `packages/cloud/.env`. The helper reserves 6 GiB of available memory for the complete graph; `--ignore-memory` explicitly overrides that guard.

```bash
$V web-launch <RUN_ID>               # both products, Cloud selected
$V web-launch <RUN_ID> --app app     # self-hosted App selected
```

The helper launches the standard `pnpm dev` stack. Cloud sends email to its Mailpit; App uses email only when its own SMTP settings are configured. Each run owns a scratch state directory, Compose project and volumes, Portless service names, and the standard Process Compose Unix socket under its state directory (`state/pc.sock`). The helper uses the default development control API; no server flags are added at launch. The developer's usual stack can coexist. GitHub and Smee start by default using the existing package dotenv settings, using the default development mode for both products. Follow [CONTRIBUTING.md](../../../CONTRIBUTING.md) for their configuration; no extra profile or shell exports are needed.

Ready means both applications, both combined collectors (public OTLP and private GitHub listeners), PostgreSQL, both ClickHouse servers and Mailpit passed the standard development readiness checks. The selected application's migrations must also be applied. Allow up to ten minutes for cold native collector builds and first route compilation.

`web-env` prints connection metadata, including `WEB_ORIGIN`, both product origins and ingest URLs, `WEB_PORT` (the selected app's backing HTTP port), selected `CLICKHOUSE_URL`, selected `OTLP_GRPC_ORIGIN`, both product gRPC origins, both private GitHub replay origins, and `MAILPIT_ORIGIN`. It contains no generated application credentials. The helper trusts Portless's public local CA for Node HTTPS requests. Application dotenv files are read by Vite; database credentials and authentication settings come from the standard development YAML. Application self-telemetry points at a dead port so this throwaway run does not write into another instance.

Start with the selected product's browser recipe: Cloud uses [web-auth.md](features/web-auth.md); App uses [web-installation.md](features/web-installation.md). Create API keys through the UI. `web-seed` sends telemetry through the selected product's public collector and verifies the resulting rows and tenant. Database helpers also target the selected product.

The collector configs are the actual `scripts/dev/collector-app.yaml` and `collector-cloud.yaml`, copied into evidence without transformation. Edit those files when changing development ingestion; `web-collector-restart` restarts the selected native collector and refreshes its snapshot. Changes to the standalone `collector/config.example.yml` need separate validation if they do not affect development configs.

### Web app boundary

The default graph starts with the existing GitHub App configuration. Once it is running, signup/setup, sessions, API keys, authenticated OTLP, Explore pages, dashboards, runbooks and Mailpit exercise local services. These paths require real configuration:

| Capability | Required configuration |
| --- | --- |
| GitHub connection, webhook signature checks, CI collection | Keep the real GitHub App settings in each package's existing dotenv file as described in CONTRIBUTING.md. Each selected package may set its own `SMEE_CHANNEL` for real deliveries. Linking a repository also needs a real GitHub installation. |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` in the selected application's configuration |
| Billing checkout | Real Polar sandbox token, product and webhook settings in Cloud's configuration |

Use real supplied values. When a boundary cannot be reached, record the missing configuration and leave that capability unverified. Email capture is isolated: query `MAILPIT_ORIGIN/api/v1/messages`, or open its UI. There is no shared SMTP port.

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

Checks the standard Process Compose readiness states, this project's four running containers, both application health endpoints, product-specific ClickHouse tenant-policy counts, that each product's configured ClickHouse reader (`CLICKHOUSE_USERNAME` from `process-compose.yaml`) can read `app.logs`, collector source snapshots, private GitHub signature rejection, selected collector HTTP/gRPC authentication and HTTP CORS, selected database migrations, app port ownership, supervisor liveness, collector schema-detection errors, and `agent-browser`. Ends with `WEB DOCTOR OK` or `WEB DOCTOR FAILED`. On failure inspect `/tmp/verify-everr/web-<id>/web.log`, then clean up and relaunch. After editing a collector config, restart it before running Doctor again.

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

- Rendered app: drive it with `agent-browser` (see "Browser" below) at `$WEB` from `eval "$($V web-browser-env)"`. Cloud journeys sign up a throwaway user; App journeys create the installation owner; export these first:

  ```bash
  export VERIFY_NAME="Verify Bot" VERIFY_EMAIL="verify-$(date +%s)@example.com" \
         VERIFY_PASSWORD="verify-password-123" VERIFY_KEY_NAME="verify-key-$(date +%s)"
  ```
- HTTP: `$V web-http <label> <METHOD> <path> [curl args]` records command, status, headers, body.
- GitHub webhooks: `$V web-webhook <label> <event> <payload.json>` signs the body with this run's `GITHUB_APP_WEBHOOK_SECRET` (`x-hub-signature-256`), as GitHub does for a configured App.
- Onboarding: `$V web-onboard` (after sign-up) sets the browser to 1280x800, answers the consent banner with `Deny` so it never covers screenshots or buttons, and clicks through the four Home onboarding steps (focus + Enter) until the selected product's Home dashboard renders (App: `Reporting services`; Cloud: `Usage by signal`), saving `web/onboard-*` and checking `organization.metadata.onboardingCompleted`. Prints `ONBOARDED ...`; idempotent. Recipes that need Home's dashboard view, or clean screenshots, run it right after sign-up.
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
eval "$($V web-browser-env)"   # surface B: AGENT_BROWSER_SESSION=verify-everr-web-<id>, WEB, APP_WEB, CLOUD_WEB, WEB_APP, SHOTS=<evidence>/web, SDK_PAGE_ORIGIN, SDK_URL, ab_save
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

Web stable handles (from source): App setup inputs `#workspace-name`, `#owner-name`, `#owner-email`, `#owner-password`; Cloud sign-up inputs `#name`, `#email`, `#password`; sign-in `#email`, `#password`; submit `button[type=submit]`; user menu is the sidebar button containing the user's name, with menu item `Log out` (`role=menuitem`); API key dialog `#api-key-name`, switch `Send telemetry` / `Manage as code` (`role=switch`), buttons `New key`, `Create key`, `Done`; public key dialog labels `Name` and `Allowed origins` (one origin per line), buttons `New public key`, `Create public key`. Explore filters are URL params; `service` is a JSON array shared by `/logs`, `/traces`, `/errors` (`?service=%5B%22<name>%22%5D`). Route paths (pathless layouts stripped): `/setup`, `/auth/sign-up`, `/auth/sign-in`, `/organization-setup`, `/`, `/api-keys`, `/github`, `/logs`, `/traces`, `/errors`, `/runs`, `/dashboards`, `/runbooks`, `/alerts`, `/repos`, `/cost-analysis`, `/users-management`, `/billing`, `/account`; API `/api/health`, `/api/github/install/start`, `/webhook/github`.

CLI stable handles: CLI subcommands and flags from `packages/cli/src/cli.rs`; `--format json|ndjson|table` on queries (ndjson is the default off a TTY); `everr wrap` names the service `everr-wrap-<program>` and sets log attributes `everr.wrap.stream` (`stdout`/`stderr`/`exit`), `everr.wrap.command`, `everr.wrap.executable`, `everr.wrap.exit_code`. Attributes are ClickHouse `JSON` columns: read them as `LogAttributes.everr.wrap.stream`, not `LogAttributes['...']` (that errors with `ILLEGAL_TYPE_OF_ARGUMENT`). UI routes: `/logs`, `/traces`, `/traces/<traceId>`, `/errors`, `/settings`, `/developer`; the Logs search box maps to the `q` search param.

## Evidence

Surface A location: `$REPO/.verify-everr/artifacts/<RUN_ID>/` (gitignored, outside the scratch dir, so cleanup never deletes it). Layout:

- `run.txt` (run id, git HEAD/branch, binary version and mtime, launch time), `run.env`, `pids.txt`, `launch.{stdout,stderr,exit}`
- `cli/<label>/{command.txt,stdout,stderr,exit_code,at.txt}` per `$V cli` call
- `cli/<label>/until.txt` for `$V cli-until` calls
- `ui/<label>.{png,txt,url}` saved with `agent-browser` (see Browser)
- `local.log` (supervisor + collector log, copied at cleanup), `cleanup.stop.txt`

Surface B location: `$REPO/.verify-everr/artifacts/web-<RUN_ID>/`:

- `run.txt` (run id, selected product, command, project, git HEAD and launch time), `run.env` (connection metadata), `collector-app.yaml`, `collector-cloud.yaml` (source snapshots)
- `sdk-page/` from `web-sdk-page`: `entry.ts`, `index.html`, `build.log`, `page.txt` (origin, endpoint, key prefix, recording on/absent)
- `web/<recipe>-<step>.{png,txt,url}` saved with `agent-browser` (see Browser)
- `http/<label>/{command.txt,status,headers,body}` and `delivery.txt` for webhooks
- `seed/` from `web-seed`: `traces.json`, `logs.json` (the exact payloads), `seed.txt` (responses, row counts, tenant check, `SEEDED` line), `rows.json`, `trace_id`
- `db/<label>/{query.sql,stdout,stderr,exit_code}`
- `web.log` (Process Compose output, native collectors, apps and workers) and `compose.log` (database and Mailpit container logs), copied at cleanup; `cleanup.txt`

- `net/<label>.{requests,serverfn,errors}.txt` from `web-net`; `http/apply-*/` from `web-apply`; `report.md` from `web-report`
- `video/` from `web-record`: `<name>.mp4`, `<name>-<frame>.png`, `<name>.timeline.txt`, `<name>.probe.txt`
- `timings.tsv`: one row per `web-*` command and launch/seed sub-step (`phase`, start, end, seconds, `ok` or `fail (exit N)`), written even when the step fails

Visual proof (required for any change that touches UI):

- A verification report backs every UI claim with an image: a screenshot per claim (`ab_save <label> "<claim>"`) or a `web-record` video with key frames. A UI claim with no image or video behind it is unverified, and the report says so in those words.
- Take screenshots after the data renders: `wait --text` for the asserted text first, then `ab_save`. Dismiss the consent banner first (`$V web-onboard` does it) and use the 1280x800 viewport (`web-onboard` sets it; otherwise `agent-browser set viewport 1280 800`; `web-record` defaults to it).
- `ab_save` sleeps 0.7s before the screenshot: after a client-side navigation the DOM (what `wait` and the `.txt` see) updates before the compositor paints, and an immediate screenshot showed the previous page (observed 2026-10-20 on the dashboards panel link). Also wait for something that only the new page lacks or has, not text both pages share.
- Before reporting, open each image (Read the PNG) and confirm it shows what its caption claims: the asserted data is visible, nothing covers it, it is the right page. Fix or drop captions that do not match. When a shot is re-taken, copy it to a new file name before opening it again: an image viewer can serve the earlier version of a path it already showed.
- `$V web-report [RUN_ID]` collects the run's videos (with timeline and key frames) and screenshots with their captions and URLs into `<evidence>/report.md`, with image links relative to the evidence dir, a Timings table from `timings.tsv` (each command and sub-step, a `gap` row for the time between commands, and the total), plus a checklist for the two rules above. Prints `REPORT ... screenshots=<n> uncaptioned=<n> duplicates=<n>`; give every screenshot that backs a claim a caption. Byte-identical screenshots saved under different labels are listed as `DUPLICATE a = b` and in a `Duplicate screenshots` section: retake them so each claim has its own frame. Attach or link `report.md` in the verification report.

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

`web-cleanup` stops this run through its owned Process Compose socket, falling back to its recorded process group if needed. It stops any SDK page server, closes the run's browser, preserves logs and removes only this run's Compose project, volumes and project-local images. The shared Portless proxy remains running. Scratch removal is guarded by the scratch root; evidence survives. If Docker removal fails, resources remain, or cleanup cannot confirm their removal, the command exits nonzero and keeps the run metadata and selection. Restore Docker access and rerun `web-cleanup` (or set `WEB_RUN_ID` to the retained run id). Successful host-process shutdown clears its PID file so retrying does not signal an old PID. Run cleanup after every attempt, including failed launches. Never issue an unscoped `docker compose down` against another stack.

## Helpers

- `scripts/verify-everr.ts` (executable TypeScript entry, run by Node). Subcommands: `build`, `launch [RUN_ID]`, `doctor`, `env`, `cli <label> -- ARGS`, `cli-until <label> <text> -- ARGS`, `ui-get <path>`, `ui-cmd <command> [json]`, `browser-env`, `cleanup`, and `web-launch [RUN_ID] [--app app|cloud] [--ignore-memory]`, `web-doctor`, `web-env`, `web-browser-env`, `web-http <label> <METHOD> <path> [curl args]`, `web-webhook <label> <event> <payload>`, `web-psql <label> <SQL>`, `web-ch <label> <SQL>`, `web-key-save <name>`, `web-seed [--key-name N | --key-file F]`, `web-collector-restart`, `web-sdk-page [--local]`, `web-record --steps F [...]`, `web-key <name>`, `web-onboard`, `web-apply <body> [...]`, `web-net <label> <s> [--reload]`, `web-report [RUN_ID]`, `web-cleanup`. Run it with no args for usage. Env knobs: `EVERR_VERIFY_SCRATCH` (scratch root, default `/tmp/verify-everr`), `VERIFY_BUILD_OTLP_ENDPOINT` (where `build` sends its own spans, default the dead port `http://127.0.0.1:9`), `VERIFY_CWD` (cwd for `cli`), `UNTIL_S`, `RUN_ID` to target a run other than the current one, and `WEB_RUN_ID` to target a web run when none is selected (the selected web run wins, so a sourced `run.env` from an earlier run cannot redirect commands).
- `scripts/common.ts`: paths, run-id validation, scratch-root containment, ports, process helpers.
- `scripts/web.ts`: the `web-*` subcommands.
- `scripts/package.json`: only `"type": "module"`, so Node loads the `.ts` files as ES modules without a warning.
- `scripts/apply-examples/dashboard-runbook.json`: an as-code body (dashboard `verify/traffic` with a static-list variable and 2 panels, runbook `verify/verify-runbook` embedding one) for `web-apply`.
- `scripts/record.ts`: the `web-record` recorder (Playwright + ffmpeg); runnable standalone. `scripts/record-examples/`: generic steps files.
- `scripts/sdk-page/`: `index.html`, `entry.template.ts` (the page `web-sdk-page` bundles) and `serve.ts` (loopback static server).
- `scripts/workflow-run.webhook.json`: a minimal signed-webhook payload for `web-webhook`.

Maintain the feature map with `/maintain-verification-skill` when commands, routes, or attributes change.
