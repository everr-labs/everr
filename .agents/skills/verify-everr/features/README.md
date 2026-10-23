# Everr verification map

This directory is the maintained source for verifying the user-facing behavior of the Everr CLI with its local stack (surface A) and App/Cloud through `pnpm dev` (surface B). Read the index before driving, then use the matching feature file as the recipe. `V` below is `.agents/skills/verify-everr/scripts/verify-everr.ts`.

## Baseline preconditions

Surface A (CLI):

- Port ownership checks use `ss` (iproute2) on Linux or `lsof` on macOS.
- The debug CLI is built from this checkout with `$V build` (`pnpm dev:cli`), and `$V doctor` shows no "sources newer than binary" warning.
- One isolated instance per run, started with `$V launch`: random ports, `EVERR_TELEMETRY_DIR` and `EVERR_LOCAL_LOG_DIR` under `/tmp/verify-everr/<RUN_ID>/`, throwaway `HOME`/`XDG_*`.
- `$V doctor` ends with `DOCTOR OK` before any recipe.
- The telemetry store starts empty. Recipes create their own data with a unique marker (for example `M=verify-$(date +%s)`).
- Never drive an instance this run did not start, including the user's own on ports 54318/54320/54321 (debug) or 54418/54420/54421 (release).

Surface B (web app):

- Docker works directly, and `$V web-launch` printed `WEB READY`; `$V web-doctor` ends with `WEB DOCTOR OK`.
- The database starts empty. For default Cloud runs, start with `web-auth.md` Sign up and `$V web-onboard`. For `--app app`, start with `web-installation.md` installation setup; later recipes reuse that session (this run's `agent-browser` session keeps its cookies until cleanup).
- `VERIFY_NAME`, `VERIFY_EMAIL`, `VERIFY_PASSWORD`, `VERIFY_KEY_NAME` exported (SKILL.md Drive).
- Drive and stop only the project, service names, browser and supervisor socket recorded for this run.

## Driving conventions

- Run CLI actions through `$V cli <label> -- <args>`. Labels name the evidence folder, so keep them unique within a run.
- Run local UI API calls through `$V ui-get` / `$V ui-cmd`, and rendered UI through `agent-browser` after `eval "$($V browser-env)"` (SKILL.md Browser).
- Run web pages through `agent-browser` after `eval "$($V web-browser-env)"`, web HTTP through `$V web-http`, signed GitHub deliveries through `$V web-webhook`, and side-effect reads through `$V web-psql` / `$V web-ch`.
- Web selectors come from source: element ids (`#email`), `role` + accessible name (`menuitem` `Log out`, `switch` `Send telemetry`), button text, route paths. No coordinates, no generated class names.
- Use `--format ndjson` (or `json`) for assertions. `table` is for humans.
- Filter every read by the run's marker and a recent time window (`Timestamp > now() - INTERVAL 10 MINUTE`).
- Treat commands as literal. Keep quoting, especially SQL inside double quotes with string literals in single quotes.
- Remove any scratch project dirs a recipe creates. Never remove `.verify-everr/artifacts/`.

## Proof and skip reporting

- CLI proof: `cli/<label>/` with command, stdout, stderr, exit code.
- Ingestion proof: the producing command plus a read-only `local query` that returns the marker rows.
- UI proof: `ui/<label>.png` plus `ui/<label>.txt` containing the marker (`ab_save`).
- Web proof: every recipe command exited `0`, the end-state `web/<label>.{png,txt,url}`, and a second view (reload, other route, or a `db/` row).
- UI changes: every UI claim has a screenshot (`ab_save <label> "<claim>"`, taken after the asserted text rendered, banner dismissed, 1280x800) or a `web-record` video; each image was opened and matches its caption; `$V web-report` wrote `report.md`. A UI claim without an image is reported as unverified.
- Record the feature ID (sub-feature IDs below) with each artifact label.
- Report an unreachable path with the attempted command and the unmet precondition. Do not report a skipped entry point as verified through a different path.
- Cloud-backed CLI commands (`cloud`, `ci`, `apply`, `resources`) are out of scope for this map; report them as skipped with "needs Everr Cloud session".
- Web capabilities behind the SKILL.md "Web app boundary" table are reported as blocked with the exact missing values from that table.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior, then exactly four H2 sections in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-everr` (starts with `Preconditions:`, then labeled bullets pairing each action with an exact command and observable result), `Gotchas`.

## Features

- [Local stack lifecycle](./local-lifecycle.md): `everr local start`, `status`, `stop`, idempotent restart, stopped exit code.
- [Wrap a command](./wrap.md): `everr wrap` mirrors output and exit code and ingests stdout/stderr/exit as logs.
- [Query local telemetry](./local-query.md): `everr local query` over chDB in json/ndjson/table, errors, read-only behavior.
- [Local Logs UI](./local-ui-logs.md): the browser Logs explorer and its command API show ingested logs and search.
- [Bundled skills](./skills.md): `everr skills list/install/uninstall` for a project, including dry-run.

Web app (surface B):

- [Self-hosted installation setup](./web-installation.md): workspace and owner setup, persistence and App keys.
- [Web sign-up, sign-in and session](./web-auth.md): sign-up, organization setup, home, log out, route guard, wrong password, sign back in.
- [Web API keys](./web-api-keys.md): create, list and persist `ek_` keys on `/api-keys`, and public keys with allowed origins.
- [Web Explore and Runs pages](./web-explore.md): `/logs`, `/traces`, `/errors`, `/runs` empty for a fresh org, then logs, traces and an error seeded over OTLP with the run's key (`web-seed`).
- [Web dashboards and runbooks](./web-dashboards.md): `/api/apply` with a Manage-as-code key, grid with a static-list variable, panel pages carrying variables, runbook embed, built-ins, 404s.
- [Web browser SDK](./web-browser-sdk.md): `@everr/otel-web` on a test page with a public key: CORS preflight, errors, failed requests, recordings into `app.recordings`, and the local endpoint without a key.
- [Web session replay player](./web-replay.md): Replay on error and trace detail pages, Play, gap labels, default relative range vs absolute range, request-count check.
- [Web GitHub connection and webhook ingress](./web-github.md): `/github`, install start, webhook signature checks, signed delivery, and the GitHub App boundary.

## Changed path -> features

Pick recipes from the paths a change touches (`git diff --name-only origin/main...`). Always run the surface's Launch and Doctor first.

| Changed path | Run |
| --- | --- |
| `packages/cli/**`, `collector/cmd/everr-local-collector/**` | `local-lifecycle.md`, `wrap.md`, `local-query.md` |
| `packages/local-app/**`, `packages/telemetry-explorer/**` | `local-ui-logs.md` (+ `local-query.md`) |
| `packages/cli/skills/**`, skills commands | `skills.md` |
| `packages/app/src/routes/auth/**`, `src/lib/auth*`, organization setup | `web-auth.md` |
| `packages/app/src/**/api-keys*`, `verify-key`, apikey schema | `web-api-keys.md`, then `web-explore.md` Seed |
| `packages/app/src/routes/**/logs*`, `traces*`, `errors*`, `src/data/**` (Explore queries) | `web-explore.md` (empty + seeded) |
| `packages/app/src/**/replay*`, `src/data/replay/**` | `web-browser-sdk.md`, `web-replay.md` |
| `packages/otel-web/**` | `web-browser-sdk.md` (+ `web-replay.md` when `src/recording*` changed) |
| `scripts/dev/collector-*.yaml`, `collector/**` (public edge, processors, exporters) | Web Launch + Doctor (CORS and config checks), `web-explore.md` Seed, `web-browser-sdk.md` |
| `clickhouse/init/**`, `clickhouse/manual/**` | Web Launch + Doctor (row policies), `web-explore.md` seeded, `web-replay.md` if `recordings` changed |
| `packages/app/drizzle/**` | Web Launch + Doctor (migrations), `web-auth.md` |
| `packages/app/src/**/github*`, `/webhook/github` | `web-github.md` |
| `packages/app/src/**/dashboards/**`, `src/components/dashboards/**`, `**/runbooks/**`, `src/data/as-code/**`, `/api/apply` | `web-dashboards.md` (needs `web-api-keys.md` with `VERIFY_KEY_MANAGE=1`, `web-seed`) |
| `packages/app/src/routes/**/runs*` | `web-explore.md` empty `/runs` (rest is behind the GitHub boundary) |
