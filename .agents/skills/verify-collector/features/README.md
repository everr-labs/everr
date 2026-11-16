# Everr collector verification map

This directory is the maintained source for verifying the user-facing behavior of the Everr collector distributions. Its users are telemetry senders (SDKs, browsers, the application replaying GitHub deliveries) and operators running the binary with a config. Read the index before driving, then use the matching feature file as the recipe. `V` below is `.agents/skills/verify-collector/scripts/verify-collector.ts`.

## Baseline preconditions

- One run per checkout, started with `$V launch [RUN_ID] [--profile cloud|app|deploy]` (default `cloud`). Launch rebuilds the distribution from this checkout, starts a throwaway ClickHouse from `scripts/dev/compose.yaml`, applies `packages/app/clickhouse`, starts the stub verifier, then the collector with the profile's config, unmodified.
- `$V doctor` ends with `COLLECTOR DOCTOR OK` before any recipe.
- The ClickHouse server is new for each run, so it starts empty. Recipes still filter by a marker (`$V otlp` puts `<RUN_ID>-<label>` in the log body, span name and the `everr.verify.marker` attribute) or by tenant.
- The stub's keys exist only in this run (`$V keys`): `secret` (tenant `verify-<RUN_ID>-a`, logs 7d, traces 14d, metrics 30d), `other` (tenant `verify-<RUN_ID>-b`, 90d each), `public` (tenant a, allowed origin `https://allowed.verify.test`), `apply-only` (no `ingest` scope).
- Never drive a collector or ClickHouse this run did not start, including the development stacks on this machine.

## Driving conventions

- Send telemetry only through the collector's public listeners: `$V otlp`, `$V grpc`, `$V webhook`, `$V http`. Never insert into `otel.*` or `app.*` with `$V ch`: that skips the authentication and stamping the proof is about.
- Read results with `$V ch` (one read) or `$V ch-until` (retry until the text appears; ingestion is asynchronous). Queries run as `default` with database `app`.
- Labels name evidence folders and must be unique within a run.
- Run shell loops in `bash`, or quote arguments one by one. zsh does not split an unquoted `$var` into words, so a loop that builds arguments in a string sends one long label instead.

## Proof and skip reporting

- Ingest proof: the sending command (`http/<label>/` or `grpc/<label>/`, with status) plus a `db/<label>/` read that shows the marker row with its `tenant_id` and `retention_days`.
- Rejection proof: the status from the collector plus the matching line in `verify.log` (the stub's decision for that key name and origin). A 401 with no `verify.log` line means the collector rejected the request before asking the verifier (missing header or wrong scheme).
- Record the feature ID (sub-feature IDs below) in each label.
- Report a sub-feature that needs the real application or GitHub as "needs verify-web-app" with the reason. Do not report it as verified through the stub.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior, then exactly four H2 sections in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-collector` (starts with `Preconditions:`, then labeled bullets pairing each action with an exact command and observable result), `Gotchas`.

## Features

- [Authenticated OTLP ingest](./otlp-ingest.md): OTLP/HTTP JSON for logs, traces and metrics, OTLP/gRPC, tenant and per-signal retention from the key, forged attributes and reserved `everr.*` metrics dropped.
- [Rejected keys](./ingest-auth.md): missing header, wrong scheme, unknown key, key without `ingest` scope, public key without origin, secret key from a browser, public key from a foreign origin.
- [Browser ingest and CORS](./browser-cors.md): CORS preflight, and a public key accepted from its allowed origin.
- [Signed GitHub webhooks](./github-webhook.md): signed `workflow_job` deliveries become spans with tenant and retention from the replay headers; bad signatures and skipped events.
- [Usage accounting](./usage-accounting.md): Cloud only. `everr.ingestion.volume` per customer and signal, and the monthly usage query.

## Changed path -> features

Pick recipes from the paths a change touches (`git diff --name-only origin/main...`). Always run Launch and Doctor first.

| Changed path | Run |
| --- | --- |
| `collector/extension/everrapikeyauth/**` | `ingest-auth.md`, `browser-cors.md`, `otlp-ingest.md` |
| `collector/receiver/githubactionsreceiver/**` | `github-webhook.md` (`workflow_run` needs verify-web-app with a real GitHub App) |
| `collector/processor/everrusageprocessor/**`, `collector/connector/everrusageconnector/**`, `collector/extension/everrusageextension/**` | `usage-accounting.md` |
| `collector/config/manifest.*.yaml`, `collector/go.mod`, `collector/internal/**`, `collector/semconv/**` | every feature, with `--profile cloud` and again with `--profile deploy` |
| `scripts/dev/collector-cloud.yaml` | every feature with `--profile cloud` |
| `scripts/dev/collector-app.yaml` | `otlp-ingest.md`, `ingest-auth.md`, `browser-cors.md`, `github-webhook.md` with `--profile app` |
| `deploy/collector.yaml` | `otlp-ingest.md`, `ingest-auth.md`, `browser-cors.md` with `--profile deploy` |
| `packages/app/clickhouse/**` | `otlp-ingest.md` with `--profile cloud` and `--profile deploy`, `usage-accounting.md`; reads through `app_ro` need [verify-web-app](../../verify-web-app/SKILL.md) |
| `collector/cmd/everr-local-collector/**`, `collector/exporter/chdbexporter/**` | [verify-cli](../../verify-cli/SKILL.md), not this map |
| `packages/app/src/routes/api/internal/verify-key.ts`, `packages/app/src/lib/public-ingest-keys.ts` | [verify-web-app](../../verify-web-app/SKILL.md): the stub stands in for these here |
| `collector/config.example.yml`, `collector/Dockerfile` | not covered (see SKILL.md) |
