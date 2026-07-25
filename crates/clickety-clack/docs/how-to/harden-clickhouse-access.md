# How to harden the ClickHouse user

**This is the real security boundary for rule SQL. Read it before exposing rule
creation to untrusted tenants.**

clickety-clack evaluates tenant-authored SQL against ClickHouse. That SQL is
**untrusted input** and runs with the privileges of `CC_CH_USER`. The in-app SQL
guard (the `sqlguard` module) only checks the statement *shape* — that it is a single,
parseable, read-only `SELECT` — and the per-query `readonly=1` setting blocks
writes. **Neither stops a valid `SELECT` from reading data it shouldn't or reaching
the network.** Containing that is the job of the ClickHouse user's privileges,
which is deployment configuration and is **not** done for you.

## The threat

A perfectly valid `SELECT` that passes every in-app check can still:

- **Exfiltrate data or hit internal endpoints (SSRF)** via ClickHouse table
  functions: `url(...)`, `file(...)`, `s3(...)`, `remote(...)`/`remoteSecure(...)`,
  `mysql(...)`, `postgresql(...)`, `jdbc(...)`, `odbc(...)`, `hdfs(...)`. For
  example `SELECT * FROM url('http://169.254.169.254/latest/meta-data/...', ...)`
  reaches the cloud metadata endpoint. `readonly=1` does **not** block these — they
  are reads.
- **Read sensitive or cross-tenant data**: `system.*` tables (cluster config,
  other tenants' in-flight queries, users), or any table the user can see.

The defenses below remove those capabilities at the source.

> **Do not run as `default`.** The repo's default `CC_CH_USER=default` (empty
> password) typically has full privileges — the worst case. The first and most
> important step is a dedicated, least-privilege user.

The `api` and `evaluator` roles enforce that much at startup: with
`CC_CH_AUTH_MODE=shared` and `CC_CH_USER=default` they refuse to boot unless
`CC_DEV_INSECURE_CH_DEFAULT_USER=1` says the risk is accepted (the dev compose
stack sets it). Roles that never run rule SQL are unaffected. It is a guard
against forgetting this page, not a substitute for it: no startup check can tell
a locked-down `shared` user from a privileged one, so everything below still
applies once you are off `default`.

## Step 1 — Create a least-privilege user (the critical step)

Put your alerting tables in their own database (here `alerts`) and grant the
evaluator **read-only access to that database only**. Using ClickHouse SQL-driven
access control:

```sql
-- A role that can read ONLY the alerting data — nothing else.
CREATE ROLE cc_alerting;
GRANT SELECT ON alerts.* TO cc_alerting;

CREATE USER cc_evaluator
    IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';
GRANT cc_alerting TO cc_evaluator;
```

A user created this way has **no implicit grants**: it cannot read other
databases, cannot read `system.*`, and — crucially — has **no `SOURCES`
privileges**, so the `url`/`file`/`s3`/`remote`/`mysql`/… table functions are
denied. That single fact closes the SSRF/exfiltration vector.

> **Never** `GRANT SOURCES` (or any of `URL`, `FILE`, `S3`, `REMOTE`, `MYSQL`,
> `POSTGRES`, `HDFS`, `JDBC`, `ODBC`, …) to this user/role. Granting any of them
> re-opens the SSRF hole.

Confirm SQL-driven access control is enabled for the admin user creating these
(`access_management = 1` in the admin user's profile), or manage the equivalent in
`users.xml`.

## Step 2 — Constrain settings (defense in depth)

The app already sends `readonly=1` and cost caps per query, but pin them
server-side too so they can't be relaxed, and disable DDL and introspection:

```sql
CREATE SETTINGS PROFILE cc_alerting_profile SETTINGS
    allow_ddl = 0 CONST,
    allow_introspection_functions = 0 CONST,
    max_execution_time = 10 MAX 10,
    max_rows_to_read = 50000000 MAX 50000000,
    max_memory_usage = 2000000000 MAX 2000000000;

ALTER USER cc_evaluator SETTINGS PROFILE cc_alerting_profile;
```

The `MAX` constraints let the app *tighten* a limit but never *raise* it.

> **`readonly` interaction.** The app sets `readonly=1` per query (see
> `sqlguard::resource_limit_settings`). If you *also* pin `readonly=1` at the
> profile level, some ClickHouse versions reject the app's attempt to set the other
> limits in the same request ("Cannot modify setting in readonly mode"). If you hit
> that, either (a) leave `readonly` to the app's per-query setting and pin only the
> `MAX` caps above, or (b) mark the cost settings `CHANGEABLE_IN_READONLY` in the
> profile so the app can still tighten them. Test against your ClickHouse version.

## Step 3 — Add a quota (bound aggregate cost)

Per-query limits don't bound a tenant spamming many cheap queries. Add a quota:

```sql
CREATE QUOTA cc_alerting_quota
    FOR INTERVAL 1 minute MAX queries = 600, read_rows = 1000000000
    TO cc_evaluator;
```

Tune to your expected rule count and evaluation interval.

## Step 4 — Network egress controls

Belt-and-suspenders for the SSRF vector: even with `SOURCES` denied, firewall the
ClickHouse server's **outbound** network so it cannot reach the cloud metadata
endpoint (`169.254.169.254`), internal services, or arbitrary hosts. If the
alerting ClickHouse never legitimately calls out, default-deny egress.

## Step 5 — Point the app at the hardened user

Set the evaluator/`api` processes to use the new credentials (see
[configuration](../reference/configuration.md#datastores)):

```bash
export CC_CH_USER=cc_evaluator
export CC_CH_PASSWORD='CHANGE_ME_STRONG_PASSWORD'
```

## Step 6 — Verify the controls

Create rules with hostile SQL via `POST /v1/rules/:id/test` (ad-hoc, no state) and
confirm ClickHouse **rejects** them with an access error, not a result:

```bash
# Expect: access denied for the url() table function.
curl -s -X POST localhost:8080/v1/rules/$ID/test \
  -H "X-CC-Tenant: $TENANT" -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT * FROM url('"'"'http://169.254.169.254/'"'"', CSV, '"'"'a String'"'"')",
       "interval_secs":30,"for_secs":0,"label_columns":["a"],"severity":"info"}'

# Expect: access denied / unknown table for system access.
curl -s -X POST localhost:8080/v1/rules/$ID/test \
  -H "X-CC-Tenant: $TENANT" -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT name FROM system.users","interval_secs":30,"for_secs":0,"label_columns":["name"],"severity":"info"}'
```

Both should return a ClickHouse error (not rows). If either returns data, the user
is over-privileged — revisit Step 1.

## What the in-app guard does and does not do

| Layer | Protects against | Does **not** protect against |
| ----- | ---------------- | ---------------------------- |
| `sqlguard::validate` (parse-shape) | Non-`SELECT` statements, stacked statements, `INSERT … SELECT`, unparseable SQL | Anything *inside* a valid SELECT — table functions, system reads, cross-tenant reads |
| `readonly=1` per query | Writes, DDL, in-query setting changes | Reads via table functions / system tables (those are reads) |
| **ClickHouse user privileges (this guide)** | **SSRF/exfiltration, system/cross-tenant reads, cost abuse** | — |

The first two are convenience and defense-in-depth. **This guide is the boundary.**

## Per-tenant users (`CC_CH_AUTH_MODE=derived|map`)

The guide above assumes a single hardened user shared by all tenants. Setting
`CC_CH_AUTH_MODE=derived` (or `map`) makes a **per-tenant least-privilege
ClickHouse user** the automatic authentication model: each tenant's rule SQL runs
as that tenant's own ClickHouse user. The least-privilege grants, settings
constraints, quotas, and (if configured) row policies described above then become
the **per-tenant isolation boundary** — tenant A's SQL can only ever see what
tenant A's user is granted.

clickety-clack **authenticates** as these users but does **not** provision them.
Creating the users, roles, settings profiles, quotas, and row policies — one set
per tenant — is the operator's (or platform's) responsibility. Apply the same
hardening from Steps 1–4 to *each* per-tenant user.

See [Configuration](../reference/configuration.md#datastores) for the
`CC_CH_AUTH_MODE`, `CC_CH_USER_TEMPLATE`, `CC_CH_MASTER_KEY`,
`CC_CH_PASSWORD_SUFFIX`, and `CC_CH_TENANT_MAP` variables.

## See also

- [The security model](../explanation/security-model.md) — where this fits.
- [Write alert rules](write-alert-rules.md) — the untrusted-input surface.
- [Configuration](../reference/configuration.md#datastores) — the ClickHouse vars.
