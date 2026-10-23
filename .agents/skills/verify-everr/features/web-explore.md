# Web Explore and Runs pages

Signed-in users explore their organization's telemetry on `/logs`, `/traces` and `/errors`, and CI history on `/runs`. Each page queries ClickHouse through the app's tenant-scoped reader (`app_ro` with the org's tenant setting) and shows filters, a volume chart, and an empty state when the org has no data yet. Telemetry reaches those tables over public OTLP ingest: an `ek_` key with `Send telemetry`, checked by the collector against the app, with the tenant stamped from the key's organization.

## Sub-features

- `explore-logs` `/logs` renders filters (Service, Environment, Search, Severity counts all 0, Trace, Attributes) and `Log volume`.
- `explore-traces` `/traces` renders for a provisioned org.
- `explore-errors` `/errors` renders for a provisioned org.
- `explore-runs` `/runs` shows `No runs in this range` / `No workflow runs match the current filters.` and filters for repository, status, branch, workflow.
- `explore-seeded-logs` after `web-seed`, `/logs` filtered to service `verify-seed-api` lists the 3 seeded bodies, `Showing all 3 matching events`, and Severity counts Error 1, Warning 1, Info 1.
- `explore-seeded-traces` `/traces` filtered to `verify-seed-api` lists one `/checkout` trace with status `Error` (`Showing all 1 matching traces`).
- `explore-seeded-trace-detail` `/traces/<trace id>` shows `3 spans`: `POST /checkout`, `SELECT orders`, `charge card`.
- `explore-seeded-errors` `/errors` filtered to `verify-seed-api` groups the exception log as `VerifySeedPaymentError` / `card declined by verify-seed provider`, `1 occurrence` (`Showing all 1 matching errors`).
- `explore-ingest-tenant` ingest rejects an invalid key (`401`) and stores the rows under the key's organization, not the `everr.tenant.id` the client sent.

## How to get to it (user POV)

- Sidebar `EXPLORE` group: `Logs`, `Errors`, `Traces`; `CI/CD` group: `Runs`, `Cost Analysis`.
- Direct URLs; filters live in the query string (for example `/logs?levels=[]&attributes=[]&showVolume=true`).

## Driving it with verify-everr

Preconditions:

- `WEB DOCTOR OK`, `eval "$($V web-browser-env)"` in the driving shell, this run's browser signed in (`web-auth.md` Sign up ran), organization provisioned (sign-up reached `Welcome to Everr`).
- Seeded recipes only: `web-doctor` shows the collector checks `ok`, and `web-api-keys.md` "Create, list, reload" ran in this run (it saves the key as `secret`).

- **All four pages.** Run:

  ```bash
  agent-browser open "$WEB/logs" && agent-browser wait --text "Log volume" && agent-browser wait --text "Severity" && ab_save explore-01-logs
  agent-browser open "$WEB/traces" && agent-browser wait --text "Traces" && ab_save explore-02-traces
  agent-browser open "$WEB/errors" && agent-browser wait --text "Errors" && ab_save explore-03-errors
  agent-browser eval "location.assign('$WEB/runs')" && agent-browser wait --timeout 180000 --text "No workflow runs match the current filters." && ab_save explore-04-runs
  ```

  Every command exits `0`: `explore-01-logs.txt` contains `Log volume` and `Severity` with every count `0`; `explore-02-traces.txt`, `explore-03-errors.txt` render their titles; `explore-04-runs.txt` contains `No workflow runs match the current filters.` (`explore-logs`, `explore-traces`, `explore-errors`, `explore-runs`).
- **Queries really ran.** Check the run's dev log has no ClickHouse errors: `grep -ciE 'clickhouse.*(error|exception)' /tmp/verify-everr/web-$WEB_RUN_ID/web.log` prints `0` (during the run; after cleanup use `.verify-everr/artifacts/web-<id>/web.log`).
- **Seed telemetry.** Do this after the empty-state check above, in the same run, once the web-api-keys.md "Create, list, reload" recipe has run (it saves the key as `secret` in the scratch dir). Run `$V web-seed` (or `$V web-seed --key-name <name>` / `--key-file <file>`). Exit `0`; output (and `seed/seed.txt`) shows `-> 200` for `/v1/traces` and `/v1/logs`, `(invalid key) -> 401`, `rows after <n>s:` with `logs=3 (severity >= 17: 1)` and `traces=3 (status Error: 2)` (either order), `tenant_id <org> == key organization <org>`, and the `SEEDED ... logs=3 errors=1 spans=3 traces=1` line (`explore-ingest-tenant`).
- **Seeded pages.** Run:

  ```bash
  TRACE=$(cat "$SHOTS/../seed/trace_id"); SVC='service=%5B%22verify-seed-api%22%5D'
  agent-browser open "$WEB/logs?$SVC" && agent-browser wait --text "verify-seed: charge failed" && ab_save explore-seeded-01-logs
  grep -q "Showing all 3 matching events" "$SHOTS/explore-seeded-01-logs.txt" && grep -q "verify-seed: checkout started" "$SHOTS/explore-seeded-01-logs.txt" && grep -q "verify-seed: payment provider slow" "$SHOTS/explore-seeded-01-logs.txt"
  agent-browser open "$WEB/traces?$SVC" && agent-browser wait --text "verify-seed-api" && ab_save explore-seeded-02-traces
  grep -q "Showing all 1 matching traces" "$SHOTS/explore-seeded-02-traces.txt" && grep -q "/checkout" "$SHOTS/explore-seeded-02-traces.txt"
  agent-browser open "$WEB/traces/$TRACE" && agent-browser wait --text "charge card" && ab_save explore-seeded-03-trace
  grep -q "3 spans" "$SHOTS/explore-seeded-03-trace.txt" && grep -q "SELECT orders" "$SHOTS/explore-seeded-03-trace.txt"
  agent-browser open "$WEB/errors?$SVC" && agent-browser wait --text "VerifySeedPaymentError" && ab_save explore-seeded-04-errors
  grep -q "card declined by verify-seed provider" "$SHOTS/explore-seeded-04-errors.txt" && grep -q "1 occurrence" "$SHOTS/explore-seeded-04-errors.txt" && grep -q "verify-seed-api" "$SHOTS/explore-seeded-04-errors.txt"
  ```

  Every command exits `0` (the `grep -q` lines are the assertions); `explore-seeded-01-logs.txt` also lists Severity `Error 1`, `Warning 1`, `Info 1` (`explore-seeded-logs`, `explore-seeded-traces`, `explore-seeded-trace-detail`, `explore-seeded-errors`).
- **Second view of the rows.** Run `$V web-ch seeded-rows "SELECT tenant_id, ServiceName, SeverityText, Body FROM app.logs WHERE ServiceName = 'verify-seed-api' ORDER BY Timestamp"`. Three rows, one `tenant_id`, equal to the `tenant=` in the `SEEDED` line.
- **Tenant user provisioned.** Run `$V web-ch sql-api-users "SELECT name FROM system.users WHERE name LIKE 'sql_api_org_%'"`. One row per provisioned organization.
- **Proof.** `web/explore-*`, `web/explore-seeded-*`, `seed/`, `db/seeded-rows/`, `db/sql-api-users/`.

## Gotchas

- Empty is the expected state until `web-seed` runs: only this run's key can write into this run's ClickHouse. Data on the empty-state recipe means it ran after seeding, or the app points at another database (`$V web-env`).
- `web-seed` refuses a second call in the same run: the count assertions (`3 matching events`, `1 matching traces`) assume exactly one seed. Relaunch for a clean count. The counts are filtered to service `verify-seed-api`, so other telemetry in the same run (the SDK page's `verify-sdk-web`, replay segments) does not change them; the `.url` evidence must still contain `service=%5B%22verify-seed-api%22%5D`.
- The first visit to `/runs` compiles a large route tree in the dev server and has taken 57s and more on a busy host, so the recipe waits up to 180s. `agent-browser open` has its own fixed navigation timeout that can expire before that wait starts, so the recipe navigates with `eval "location.assign(...)"` (returns at once) and lets `wait` do the waiting. A timeout there is a slow compile until `web.log` says otherwise.
- Never seed with `web-ch` inserts. It skips the key check and tenant stamping, and `app_ro` reads go through row policies that a hand-written `tenant_id` can satisfy by accident.
- The traces list renders the root span as a `POST` badge plus `/checkout`, so wait on `verify-seed-api`, not `POST /checkout`. The logs table does not show the service name; assert it on `/traces` and `/errors`.
- Collectors run natively under Process Compose and verify keys through the matching application's Portless HTTPS origin. Docker runs only the databases and optional Mailpit.
- A key minted for `Manage as code` only is refused at ingest (`verify-key` requires the `ingest` scope); the recipe turns on `Send telemetry`.
- `/runs` is out of scope here and stays empty: the list reads Postgres `workflow_runs`, written from GitHub webhooks for an installation linked to the org, and run detail reads CI traces from the collector's GitHub receiver (SKILL.md boundary).
- Pages render behind `_provisioned`: if the org's `clickhouseReady` is still false, you are held on `/organization-setup`. Reopen `/` and wait for `Welcome to Everr`; do not flip the flag in SQL.
- The default time range is `Last 7 days`.
