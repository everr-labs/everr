# Web Explore and Runs pages

Signed-in users explore their organization's telemetry on `/logs`, `/traces` and `/errors`, and CI history on `/runs`. Each page queries ClickHouse through the app's tenant-scoped reader (`app_ro` with the org's tenant setting) and shows filters, a volume chart, and an empty state when the org has no data yet.

## Sub-features

- `explore-logs` `/logs` renders filters (Service, Environment, Search, Severity counts all 0, Trace, Attributes) and `Log volume`.
- `explore-traces` `/traces` renders for a provisioned org.
- `explore-errors` `/errors` renders for a provisioned org.
- `explore-runs` `/runs` shows `No runs in this range` / `No workflow runs match the current filters.` and filters for repository, status, branch, workflow.
- `explore-data` rows from ingested telemetry appear in these pages (blocked, needs the collector).

## How to get to it (user POV)

- Sidebar `EXPLORE` group: `Logs`, `Errors`, `Traces`; `CI/CD` group: `Runs`, `Cost Analysis`.
- Direct URLs; filters live in the query string (for example `/logs?levels=[]&attributes=[]&showVolume=true`).

## Driving it with verify-everr

Preconditions:

- `WEB DOCTOR OK`, signed-in session in this run (`sign-up.json` ran), organization provisioned (sign-up reached `Welcome to Everr`).

- **All four pages.** Run `$V web-steps explore-empty explore-empty.json`. All 13 steps `ok`: `01-logs.txt` contains `Log volume` and `Severity` with every count `0`; `02-traces.txt`, `03-errors.txt` render their titles; `04-runs.txt` contains `No workflow runs match the current filters.` (`explore-logs`, `explore-traces`, `explore-errors`, `explore-runs`).
- **Queries really ran.** Check the run's dev log has no ClickHouse errors: `grep -ciE 'clickhouse.*(error|exception)' /tmp/verify-everr/web-$WEB_RUN_ID/web.log` prints `0` (during the run; after cleanup use `.verify-everr/artifacts/web-<id>/web.log`).
- **Tenant user provisioned.** Run `$V web-ch sql-api-users "SELECT name FROM system.users WHERE name LIKE 'sql_api_org_%'"`. One row per provisioned organization.
- **Proof.** `web/explore-empty/`, `db/sql-api-users/`.

## Gotchas

- Empty is the expected state: no collector runs in this stack, so nothing writes `app.logs`/`app.traces`. A page that shows data in this setup is suspicious; check which database the app is pointed at (`$V web-env`).
- `explore-data` is blocked until the collector service can run (needs `collector/config.yml` and `collector/dev-everr-app.pem`, see SKILL.md boundary). Report it as skipped with that reason.
- Pages render behind `_provisioned`: if the org's `clickhouseReady` is still false, you are held on `/organization-setup`. Rerun `sign-in.json` and wait, do not flip the flag in SQL.
- The default time range is `Last 7 days`.
