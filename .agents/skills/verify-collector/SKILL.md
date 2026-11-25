---
name: verify-collector
description: Run the Everr collector distribution (`collector/`, built with OCB from `collector/config/manifest.*.yaml`) from this checkout against a throwaway ClickHouse with the repo's schema and a stub key verifier, drive its public OTLP and GitHub webhook listeners the way senders do, and capture proof. Use when a change touches `collector/` (other than the local collector and chDB exporter), `scripts/dev/collector-*.yaml`, `deploy/collector.yaml`, `packages/app/clickhouse` or `packages/cloud/clickhouse`, or when you must prove authenticated OTLP ingest, key rejection, browser CORS, tenant and retention stamping, signed GitHub webhook ingest, or usage accounting.
user-invocable: true
metadata:
  internal: true
---

# Verify the Everr collector

The collector distributions on their own: the Cloud and self-hosted builds of `collector/` with their custom components (API key auth extension, GitHub Actions receiver, usage processor, connector and extension), run with the repo's own configs. A run builds the binary from this checkout, starts one ClickHouse container with the schema from `packages/app/clickhouse` and the profile's own directory, starts a stub key verifier, starts the collector on free loopback ports, and reads what lands in ClickHouse. No application, Postgres, Portless or browser. Launch takes about 4s once the image and Go caches are warm.

Other surfaces have their own skills: App and Cloud in [verify-web-app](../verify-web-app/SKILL.md) (which also runs both collectors inside the full `pnpm dev` stack with the real application verifying keys), the `everr` CLI with the local collector and chDB in [verify-cli](../verify-cli/SKILL.md), the docs and landing site in [verify-docs](../verify-docs/SKILL.md). Runs of different skills can coexist.

## The stub verifier boundary

The collector authenticates every OTLP request by POSTing the key and the request's `Origin` to the application's `/api/internal/verify-key` endpoint (`everr_apikey` extension). That HTTP call is the only place the collector touches the application, so this skill puts a stub there. The stub implements the endpoint's contract from `packages/app/src/routes/api/internal/verify-key.ts`: `403` without the shared secret, `400` for a bad body, `401` for an unknown key, `403` for a key without the `ingest` scope or one that fails the origin policy (`originPolicyAllows`: secret keys only without `Origin`, public keys only from their allowlist), else `200` with `tenantId`, `keyId` and the four retention days (logs, traces, metrics, profiles). It logs every decision to `verify.log` (key name, never the key).

GitHub deliveries reach the collector the same way: the application replays them with tenant and retention headers (`packages/app/src/server/github-events/collector.ts`). `$V webhook` sends that replayed request.

These claims therefore still need a [verify-web-app](../verify-web-app/SKILL.md) run:

- keys minted, scoped, revoked and rate limited in the application, and the retention it looks up per organization
- the application's GitHub side: original signature check, installation to organization mapping, retries, and every `workflow_run` path (job logs and resource metrics call the GitHub API)
- reads through `app_ro` and the Cloud row policies (this skill reads as `default`)
- the application's own ClickHouse migration runner (journal, lock); here the helper applies the same files with the same splitter
- the collectors under `process-compose.yaml`, Portless URLs, and the `collector/Dockerfile` image used by `deploy/compose.yaml`

Not covered by any skill yet: `collector/config.example.yml` (it hardcodes `clickhouse:8123` and a key file path for container use).

Everything goes through one helper: `.agents/skills/verify-collector/scripts/verify-collector.ts` (below: `V`), TypeScript that Node >= 24 runs directly (no build step or dependency install). Run it from anywhere (`$V ...`, or `node $V ...`); it resolves the repo from its own path.

```bash
V="$(git rev-parse --show-toplevel)/.agents/skills/verify-collector/scripts/verify-collector.ts"
```

## Launch

Prerequisites: Node >= 24, Go >= the `collector/go.mod` version (1.26), `make`, a reachable Docker daemon with `docker compose`, and `lsof` (macOS) or `ss` (Linux). `python3` only for the usage durability matrix.

```bash
$V launch [RUN_ID] [--profile cloud|app|deploy]   # default profile cloud; RUN_ID must match [a-z0-9][a-z0-9_-]*
```

A profile picks the build, the config and the verifier's tenant behavior:

| Profile | Binary (`make -C collector build EVERR_BUILD_TARGET=...`) | Config, run unmodified | Schema files | Stub `tenantId` | Listeners |
| --- | --- | --- | --- | --- | --- |
| `cloud` | `collector/build/cloud` | `scripts/dev/collector-cloud.yaml` | `packages/app/clickhouse` + `packages/cloud/clickhouse` | returned | OTLP HTTP, OTLP gRPC, GitHub, usage pipeline |
| `app` | `collector/build/self-hosted` | `scripts/dev/collector-app.yaml` | `packages/app/clickhouse` + `self-hosted/` | returned (the development App does) | OTLP HTTP, OTLP gRPC, GitHub |
| `deploy` | `collector/build/self-hosted` | `deploy/collector.yaml` plus a listener overlay | `packages/app/clickhouse` + `self-hosted/` | omitted (production self-hosted) | OTLP HTTP, OTLP gRPC, `health_check` |

Launch, in order:

1. Refuses if `.verify-everr/current-collector` names a live run.
2. Picks free loopback ports, generates the run's shared secret, webhook secret, a throwaway GitHub App private key (App id `1`) and four keys (`$V keys`).
3. Runs `make -C collector build` for the profile's target (output in `build.log`), so the binary always matches the checkout.
4. Starts the profile's ClickHouse service from `scripts/dev/compose.yaml` as Compose project `verify-everr-collector-<checkout hash>-<RUN_ID>` (the hash keeps the same run id in two checkouts apart), published on a Docker-chosen `127.0.0.1` port, and waits for `SELECT 1`.
5. Applies the profile's schema files in file-name order, statement by statement with the application's own `sqlStatements` (`packages/app/src/db/clickhouse-statements.ts`). The container's init script has already created the databases and users with the passwords `process-compose.yaml` uses (`dev`). After a file's statements it runs the file's seed (`NNNN-<name>.seed.ts`), if it has one. Node runs the seed directly, so a seed that imports more than types from the application fails here. `schema.txt` lists each file.
6. Starts the stub verifier (the helper itself, `_verify-stub`), then the collector with the config's environment variables only (no `OTEL_*` or developer settings leak in). `deploy/collector.yaml` binds `0.0.0.0` on fixed ports, so its run adds `listeners.overlay.yaml` as a second `--config` that moves the listeners to the run's loopback ports. (`--set` does not work: this distribution has no `yaml:` config provider.)
7. Ready means the same probe as `process-compose.yaml`: unauthenticated `POST /v1/logs` is `401`, the GitHub listener answers an unsigned `GET` with `400`, plus both OTLP ports owned by the collector's pid and, for `deploy`, `health_check` `200`. Ready line:

   ```
   COLLECTOR READY run=<id> profile=<p> otlp_http=http://127.0.0.1:<p> otlp_grpc=http://127.0.0.1:<p> github=http://127.0.0.1:<p>/webhook/github clickhouse=http://127.0.0.1:<p> verify=http://127.0.0.1:<p>
   ```

A failed launch leaves the run selected; run `$V cleanup` before the next launch. One run per checkout; runs in other checkouts and other skills coexist. The scratch root is shared by all checkouts, so launch refuses a run id whose scratch dir already holds a run. Never point the helper at a development stack (`dev-*` or `verify-everr-<hash>-*` Compose projects, or collectors on their ports): they are not yours.

## Doctor

Read-only. Run first, and whenever anything looks off:

```bash
$V doctor
```

Checks the binary exists and warns when a file under `collector/{receiver,extension,processor,connector,exporter,internal,semconv,config}` is newer than it (cleanup and launch again to rebuild); the profile's config is unchanged since launch (else `$V restart`); the ClickHouse container is running and `app.logs`, `app.traces`, `app.metrics_sum` exist; the collector pid is alive and owns every listener port; the stub pid owns its port and rejects a request without the secret; OTLP/HTTP without a key is `401`; OTLP/gRPC without a key is grpc-status `16`; the GitHub listener answers an unsigned `GET` with `400`; `health_check` is `200` (`deploy`); the collector log has no `schema detection failed`. It also prints the count of `error` lines in the collector log. Ends with `COLLECTOR DOCTOR OK` or `COLLECTOR DOCTOR FAILED`. On failure read `$COLLECTOR_LOG` (from `$V env`), then clean up and launch again.

## Drive

Pick the feature file from [`features/README.md`](features/README.md) and follow it. Every primitive records evidence under a label (letters, digits, `.`, `_`, `-`; unique per run) and prints the evidence path.

- OTLP/HTTP, what an SDK sends:

  ```bash
  $V otlp <label> <logs|traces|metrics> [--key NAME | --auth 'Bearer ...' | --no-auth] [--origin URL] [--marker M] [--body FILE]
  ```

  Default key `secret`. The generated body has one record stamped now, with the marker (default `<RUN_ID>-<label>`) as log body, span name and `everr.verify.marker` attribute, and forges `everr.tenant.id=forged-by-client` and `everr.retention.days=3650` on the resource and the record. Metrics add a reserved `everr.verify.forged` gauge. Prints the HTTP status and body.
- OTLP/gRPC logs (hand-encoded protobuf, same record and forgeries): `$V grpc <label> [--key NAME | --auth V | --no-auth] [--marker M]`. Prints the grpc-status and message.
- GitHub delivery, as the application replays it: `$V webhook <label> <event> <payload.json> [--tenant T | --no-tenant] [--bad-signature] [--keep-times]`. Signs the exact body with the run's webhook secret (`x-hub-signature-256`), sets `x-github-event`, a fresh `x-github-delivery`, `x-everr-tenant-id` (key `secret`'s tenant when the profile returns one) and the `secret` key's retention headers. By default it first shifts every ISO timestamp in the payload so the latest is now. Payload for completed jobs: `scripts/workflow-job.webhook.json`.
- Any other request: `$V http <label> <METHOD> <URL> [-H 'K: V']... [--data-file F]` (CORS preflights, the unsigned webhook `GET`). Prints status and response headers; `Authorization` is redacted in evidence.
- ClickHouse reads, as `default` with database `app`: `$V ch <label> [--param k=v]... ("<SQL>" | --file F)` and `$V ch-until <label> <text> ...` (retries every 0.5s for `UNTIL_S`, default 30, seconds; exit 1 if the text never appears, which is a failed proof, not a reason to loosen the query). Output is JSONEachRow. `--param month=2026-11` binds `{month:String}`.
- `$V restart`: SIGTERM the collector, wait up to 60s, start it again with the same config and ports, wait until ready. Used for the usage flush and after a config edit.
- `$V keys` lists the stub's keys (name, tenant, retention, scope, public origins). `$V key <name>` prints one key, for an external sender (an SDK, `telemetrygen`).
- `eval "$($V env)"` exports `OTLP_HTTP_ORIGIN`, `OTLP_GRPC_ORIGIN`, `GITHUB_WEBHOOK_URL`, `HEALTH_ORIGIN`, `CLICKHOUSE_ORIGIN` (with `CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD`), `COMPOSE_PROJECT`, `VERIFY_ORIGIN`, `COLLECTOR_LOG`, `VERIFY_LOG`, `EVIDENCE`.

Stable handles (from source): OTLP paths `/v1/logs`, `/v1/traces`, `/v1/metrics`; gRPC `opentelemetry.proto.collector.logs.v1.LogsService/Export`; GitHub path `/webhook/github`; rejection bodies `missing authorization header`, `authorization scheme must be Bearer`, `unauthorized`; tables `app.logs` (`Body`), `app.traces` (`SpanName`), `app.metrics_sum`/`app.metrics_gauge` (`MetricName`), each with `tenant_id`, `retention_days`, and JSON `ResourceAttributes` (`getSubcolumn(ResourceAttributes, 'everr.tenant.id')`); usage metric `everr.ingestion.volume` with `Attributes['everr.usage.tenant.id']` and `Attributes['everr.ingestion.signal']`.

## Evidence

Location: `$REPO/.verify-everr/artifacts/collector-<RUN_ID>/` (gitignored, outside the scratch dir, so cleanup never deletes it):

- `run.txt` (run id, profile, git HEAD and branch, dirty collector paths, binary and its build time), `build.log`, `compose-up.txt`, `schema.txt`, `collector-config.yaml` (copy of the profile's config), `listeners.overlay.yaml` (`deploy`), `collector.command.txt`, `keys.txt` (no key values), `launch.txt` (the ready line)
- `http/<label>/{command.txt,request.json,status,headers,body,at.txt}` from `otlp`, `webhook`, `http` (the key shows as `Bearer <secret key>`)
- `grpc/<label>/{command.txt,grpc-status,grpc-message,at.txt}`
- `db/<label>/{query.sql,params.json,status,stdout,at.txt}` and `until.txt` for `ch-until`
- `restart.txt` from `restart`
- copied at cleanup: `collector.log`, `verify.log` (every verifier decision), `verify-stub.log`, `clickhouse.log`, `cleanup.txt`

Proof standards:

- Exercise the real path: OTLP and webhooks through the collector's listeners. Never insert into `otel.*` or `app.*` with `ch`; that skips the authentication and stamping under test.
- Pair the action with a second, read-only view: the status of the send plus a `ch-until` read of the row with its `tenant_id` and `retention_days`, or plus the `verify.log` line for a rejection.
- Assert the forged values are gone, not only that the right ones are present.
- The stub is the one mock, at the application boundary described above. Name it in any report, and list the claims that still need verify-web-app.
- A `200` or `202` alone is not proof: rows older than their retention are dropped at insert after a successful response.

## Cleanup

```bash
$V cleanup
```

Sends SIGTERM to the collector and the stub recorded in `run.json` (SIGKILL after 60s and 10s). Each is recorded as pid plus start time, so a pid that was reused by another process is never signalled. It copies the logs into evidence, then runs `docker compose -p <project> -f scripts/dev/compose.yaml down -v` (`$V env` prints the project as `COMPOSE_PROJECT`) and checks that no container, volume or network with that project label is left. It deletes `/tmp/verify-everr/collector-<RUN_ID>/` (guarded by the scratch root) and `.verify-everr/current-collector` if it names this run, then lists the evidence. If Docker resources remain, a port is still open or a recorded process is still running, it exits 1 and keeps the scratch dir; fix Docker access and rerun (`RUN_ID=<id> $V cleanup` for a run that is no longer selected). It never touches another Compose project or kills by process name. Run it after every attempt, including failed launches.

## Helpers

- `scripts/verify-collector.ts` (executable TypeScript entry, run by Node). Subcommands: `launch [RUN_ID] [--profile P]`, `doctor`, `env`, `keys`, `key <name>`, `otlp`, `grpc`, `webhook`, `http`, `ch`, `ch-until`, `restart`, `cleanup`, and the internal `_verify-stub <dir>`. Run it with no args for usage. Env knobs: `EVERR_VERIFY_SCRATCH` (scratch root, default `/tmp/verify-everr`), `RUN_ID` to target a run other than the current one, `UNTIL_S`.
- `scripts/workflow-job.webhook.json`: a completed `workflow_job` delivery (installation `424242`, job `verify-collector-job`, two steps) for `webhook`.
- `../verify-shared/common.ts`: paths, run-id validation, scratch-root containment, ports, process helpers. Shared with the other `verify-*` skills, so a change there needs a run of each.
- `scripts/package.json`: only `"type": "module"`, so Node loads the `.ts` file as an ES module without a warning.
- `collector/test/smoke/usage.py` (repo harness, not part of this skill) runs against a run's ClickHouse; see `features/usage-accounting.md`.

Maintain the feature map with `/maintain-verification-skill` when listeners, configs, components or tables change.
