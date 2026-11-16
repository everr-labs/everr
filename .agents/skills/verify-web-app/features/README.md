# Everr web app verification map

This directory is the maintained source for verifying the user-facing behavior of App and Cloud through `pnpm dev`. Read the index before driving, then use the matching feature file as the recipe. `V` below is `.agents/skills/verify-web-app/scripts/verify-web-app.ts`.

## Baseline preconditions

- Docker works directly, and `$V web-launch` printed `WEB READY`; `$V web-doctor` ends with `WEB DOCTOR OK`.
- The database starts empty. For default Cloud runs, start with `web-auth.md` Sign up and `$V web-onboard`. For `--app app`, start with `web-installation.md` installation setup; later recipes reuse that session (this run's `agent-browser` session keeps its cookies until cleanup).
- `VERIFY_NAME`, `VERIFY_EMAIL`, `VERIFY_PASSWORD`, `VERIFY_KEY_NAME` exported (SKILL.md Drive).
- Drive and stop only the project, service names, browser and supervisor socket recorded for this run.

## Driving conventions

- Run web pages through `agent-browser` after `eval "$($V web-browser-env)"`, web HTTP through `$V web-http`, signed GitHub deliveries through `$V web-webhook`, and side-effect reads through `$V web-psql` / `$V web-ch`.
- Selectors come from source: element ids (`#email`), `role` + accessible name (`menuitem` `Log out`, `switch` `Send telemetry`), button text, route paths. No coordinates, no generated class names.
- Treat commands as literal. Keep quoting, especially SQL inside double quotes with string literals in single quotes.
- Never remove `.verify-everr/artifacts/`.

## Proof and skip reporting

- Web proof: every recipe command exited `0`, the end-state `web/<label>.{png,txt,url}`, and a second view (reload, other route, or a `db/` row).
- UI changes: every UI claim has a screenshot (`ab_save <label> "<claim>"`, taken after the asserted text rendered, banner dismissed, 1280x800) or a `web-record` video; each image was opened and matches its caption; `$V web-report` wrote `report.md`. A UI claim without an image is reported as unverified.
- Record the feature ID (sub-feature IDs below) with each artifact label.
- Report an unreachable path with the attempted command and the unmet precondition. Do not report a skipped entry point as verified through a different path.
- Capabilities behind the SKILL.md "Web app boundary" table are reported as blocked with the exact missing values from that table.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior, then exactly four H2 sections in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-web-app` (starts with `Preconditions:`, then labeled bullets pairing each action with an exact command and observable result), `Gotchas`.

## Features

- [Self-hosted installation setup](./web-installation.md): workspace and owner setup, persistence and App keys.
- [Web sign-up, sign-in and session](./web-auth.md): sign-up, organization setup, home, log out, route guard, wrong password, sign back in.
- [Web API keys](./web-api-keys.md): create, list and persist `ek_` keys on `/api-keys`, and public keys with allowed origins.
- [Web Explore and Runs pages](./web-explore.md): `/logs`, `/traces`, `/errors`, `/runs` empty for a fresh org, then logs, traces and an error seeded over OTLP with the run's key (`web-seed`).
- [Web dashboards and runbooks](./web-dashboards.md): `/api/apply` with a Manage-as-code key, grid with a static-list variable, panel pages carrying variables, runbook embed, built-ins, 404s.
- [Web browser SDK](./web-browser-sdk.md): `@everr/otel-web` on a test page with a public key: CORS preflight, errors, failed requests, recordings into `app.recordings`, and the local endpoint without a key.
- [Web session replay player](./web-replay.md): Replay on error and trace detail pages, Play, gap labels, default relative range vs absolute range, request-count check.
- [Web GitHub connection and webhook ingress](./web-github.md): `/github`, install start, webhook signature checks, signed delivery, and the GitHub App boundary.

## Changed path -> features

Pick recipes from the paths a change touches (`git diff --name-only origin/main...`). Always run Launch and Doctor first. Paths under `packages/cli`, `packages/local-app` and the local collector belong to [verify-cli](../../verify-cli/features/README.md); a collector change that needs no application belongs to [verify-collector](../../verify-collector/features/README.md); `packages/docs` belongs to [verify-docs](../../verify-docs/features/README.md).

| Changed path | Run |
| --- | --- |
| `packages/app/src/routes/auth/**`, `src/lib/auth*`, organization setup | `web-auth.md` |
| `packages/app/src/**/api-keys*`, `verify-key`, apikey schema | `web-api-keys.md`, then `web-explore.md` Seed |
| `packages/app/src/routes/**/logs*`, `traces*`, `errors*`, `src/data/**` (Explore queries) | `web-explore.md` (empty + seeded) |
| `packages/app/src/**/replay*`, `src/data/replay/**` | `web-browser-sdk.md`, `web-replay.md` |
| `packages/otel-web/**` | `web-browser-sdk.md` (+ `web-replay.md` when `src/recording*` changed) |
| `scripts/dev/collector-*.yaml`, `collector/**` (public edge, processors, exporters) | Web Launch + Doctor (CORS and config checks), `web-explore.md` Seed, `web-browser-sdk.md` |
| `packages/*/clickhouse/**` | Web Launch + Doctor (row policies), `web-explore.md` seeded, `web-replay.md` if `recordings` changed |
| `packages/app/drizzle/**` | Web Launch + Doctor (migrations), `web-auth.md` |
| `packages/app/src/**/github*`, `/webhook/github` | `web-github.md` |
| `packages/app/src/**/dashboards/**`, `src/components/dashboards/**`, `**/runbooks/**`, `src/data/as-code/**`, `/api/apply` | `web-dashboards.md` (needs `web-api-keys.md` with `VERIFY_KEY_MANAGE=1`, `web-seed`) |
| `packages/app/src/routes/**/runs*` | `web-explore.md` empty `/runs` (rest is behind the GitHub boundary) |
