# `/api/cli/sql` tenant-isolation problem

## The setup

The new endpoint forwards user-written SQL to ClickHouse. A row policy filters rows by `tenant_id = getSetting('SQL_everr_tenant_id')`. Before each query, the app sets `SQL_everr_tenant_id` to the user's real org id.

## The problem

ClickHouse lets a query change settings inline:

```sql
SELECT ... SETTINGS SQL_everr_tenant_id = 'victim-org'
```

The inline value wins over the one the app sent. So the user can hand themselves any org id and read that org's data. Verified end-to-end against our actual client and ClickHouse 26.1.

We tried to lock the setting:

- `readonly = 1` blocks all setting changes — including the app's. Every query fails.
- `readonly = 2` allows changes — by the app *and* by the user. Bypass still works.
- `CHANGEABLE_IN_READONLY` (a per-setting exemption) — same outcome: once the setting is mutable, it's mutable from inside the SQL too.

ClickHouse has no "settable by the app, not by the query" mode. To it, a setting sent in the URL and one sent inside the SQL are the same thing on the same query.

## The fix: one ClickHouse user per org

Stop using a setting for tenant id. Provision a ClickHouse user per org, and bake the org id into that user's row policy as a constant. Whatever `SETTINGS` the user writes, the policy doesn't care — it's pinned to the connected user.

**Cost:** provisioning hook on org create, cleanup on delete, backfill for existing orgs, a per-org client cache, password storage or derivation.

**Wins:** isolation that can't be bypassed (the real reason), plus free per-org rate limits and per-org query logs.

**Don't do this if** we expect tens of thousands of orgs — at that scale a SQL gateway that strips `SETTINGS` clauses scales better.

## Rejected alternative: app-controlled HTTP header

Move only the SQL API tenant context out of ClickHouse settings and into an HTTP header that only the app sends to ClickHouse.

How it would work:

- Keep normal app queries on the existing setting-based row policy if we want.
- Split the SQL API row policies from the app row policies. For `sql_api_role`, use:

```sql
USING tenant_id = getClientHTTPHeader('X-Everr-Tenant-Id')
```

- In `sql_api_profile`, keep `readonly = 1 READONLY` and add `allow_get_client_http_header = 1 READONLY`.
- In `querySqlApi`, stop sending `SQL_everr_tenant_id`. Send a per-query header instead:

```ts
http_headers: {
  "X-Everr-Tenant-Id": organizationId,
}
```

- Do not forward incoming `/api/cli/sql` request headers to ClickHouse. Build this header only from `context.session.session.activeOrganizationId`.

Why this avoids the current bypass:

- User SQL can still contain `SETTINGS SQL_everr_tenant_id = 'victim-org'`, but the SQL API row policy no longer reads that setting.
- User SQL cannot create or override the outbound HTTP header on the server-side ClickHouse request.
- `readonly = 1` can stay enabled because the app no longer needs to change per-query settings for the SQL API path.

Costs / risks:

- Needs an end-to-end test on ClickHouse 26.1.
- `getClientHTTPHeader` only works for HTTP requests. The current JS client uses HTTP, so this should fit this route.
- Header names are case-sensitive. The docs say `X-ClickHouse-*` and `Authentication` headers are blocked, but the real auth header is `Authorization`, and testing on ClickHouse 26.1 shows it is readable.
- In distributed queries, `getClientHTTPHeader` returns a non-empty value only on the initiator node. That looks okay for the current local `app.*` MergeTree tables, but test before using this with Distributed tables or remote shards.
- This still assumes the SQL API ClickHouse credentials and direct ClickHouse endpoint are private. If somebody can connect directly to ClickHouse as `sql_api_user`, they can send their own header. For that threat model, use the one-user-per-org fix, or add a signed header check.

New finding: reject this for now.

`getClientHTTPHeader` can read the ClickHouse request's `Authorization` header on ClickHouse 26.1:

```sql
SELECT getClientHTTPHeader('Authorization')
```

That returns the Basic auth value for `sql_api_user`, which is enough to recover the ClickHouse password. ClickHouse's setting is all-or-nothing (`allow_get_client_http_header`); there is no header allowlist where the row policy can read only `X-Everr-Tenant-Id`.

Could we block this function but allow the row policy to use it? Probably not. The setting gates the function for the whole query, not just user-written expressions. If `allow_get_client_http_header = 0`, the row policy cannot safely depend on it either.

Could we block every other function execution? Also probably not inside ClickHouse. ClickHouse has controls for some function families (`allow_introspection_functions`, `allow_get_client_http_header`, source/table-function privileges, `dictGet`, `CREATE FUNCTION`, etc.), but normal scalar functions are part of `SELECT` expression execution. There is no general "only these functions may be called" profile setting.

Verdict:

Do not use this as-is. It only becomes plausible if we put a controlled proxy between the app and ClickHouse that strips every sensitive header and authenticates to ClickHouse without a readable `Authorization` header. Even then, we would need to test every header that reaches ClickHouse and keep `allow_get_client_http_header` scoped only to this SQL API user.

## Other researched options

### Candidate: one shared user, one role per org

Keep one `sql_api_user`, but stop using a tenant setting. Provision one ClickHouse role per org and put the tenant constant in row policies attached to that org role.

Shape:

- `sql_api_read_role`: has `SELECT` grants, `readonly = 1`, resource caps, and a default-deny row policy:

```sql
CREATE ROW POLICY sql_api_deny_by_default
ON app.traces
FOR SELECT
USING 0
TO sql_api_read_role;
```

- `sql_api_org_<org_id>`: has row policies with a constant tenant id:

```sql
CREATE ROW POLICY sql_api_org_<org_id>_traces
ON app.traces
FOR SELECT
USING tenant_id = '<org_id>'
TO sql_api_org_<org_id>;
```

- Grant `sql_api_read_role` plus the org roles to `sql_api_user`.
- On each app query, set exactly two roles through the ClickHouse HTTP role parameter: `sql_api_read_role` and the active org role.

Local test on ClickHouse 26.1:

- `role=tmp_codex_sql_api_read&role=tmp_codex_org_a` returned only `org-a`.
- `role=tmp_codex_sql_api_read&role=tmp_codex_org_b` returned only `org-b`.
- `role=tmp_codex_sql_api_read` returned no rows after adding the default-deny policy.
- `SELECT ... SETTINGS role='tmp_codex_org_b'` failed with `UNKNOWN_SETTING`.
- `SET ROLE ...; SELECT ...` failed because HTTP multi-statements are not allowed.
- `SET ROLE ...` by itself did not leak data, and the app should not use user-controlled `session_id`.
- `@clickhouse/client` with `role: ['tmp_codex_sql_api_read', 'tmp_codex_org_a']` returned only `org-a`.
- `@clickhouse/client` with `role: 'tmp_codex_sql_api_read'` returned no rows.

Why this is interesting:

- No per-org ClickHouse passwords.
- No mutable tenant setting.
- No SQL parsing.
- `readonly = 1` can stay on the SQL API profile.

Risks:

- If `sql_api_user` credentials leak, direct ClickHouse access can choose any granted org role. This is weaker than one ClickHouse user per org.
- If the app ever lets the caller influence the HTTP `role` parameter, isolation fails.
- If the app activates two org roles at once, ClickHouse combines the org row policies with `OR`, so both tenants become visible. The app must set exactly one org role.
- Org cleanup must drop row policies as well as roles. In local testing, row policies survived a database drop as access entities.

Verdict:

Most promising alternative to one-user-per-org if we accept that direct access with leaked `sql_api_user` credentials is out of scope. It trades per-org passwords for per-org roles and policies.

### Candidate: salvage the header approach by removing readable auth headers

The header row-policy idea only failed because ClickHouse received a readable `Authorization` header. A safer variant is to make sure ClickHouse receives no sensitive regular headers at all.

Shape:

- Keep `getClientHTTPHeader('X-Everr-Tenant-Id')` in SQL API row policies.
- Authenticate to ClickHouse with `X-ClickHouse-User` and `X-ClickHouse-Key`, not `Authorization`.
- Configure the JS client with `set_basic_auth_header: false`, and send `X-ClickHouse-User` / `X-ClickHouse-Key` through client-owned `http_headers`.
- Do not forward any incoming request headers to ClickHouse.
- Keep `allow_get_client_http_header = 1 READONLY` only on the SQL API profile.

Local test on ClickHouse 26.1:

```sql
SELECT
  getClientHTTPHeader('X-ClickHouse-Key') AS key,
  getClientHTTPHeader('Authorization') AS auth,
  getClientHTTPHeader('X-Everr-Tenant-Id') AS tenant
SETTINGS allow_get_client_http_header = 1
```

With `X-ClickHouse-User`, `X-ClickHouse-Key`, and `X-Everr-Tenant-Id` headers, ClickHouse returned empty strings for the key and auth header, and returned the tenant header.

Risks:

- `allow_get_client_http_header` still exposes any non-blocked header. This requires a strict audit that no `Cookie`, `Authorization`, bearer token, trace baggage, or other sensitive header reaches ClickHouse.
- `set_basic_auth_header` is marked experimental in the JS client types.
- If direct ClickHouse access is possible with `sql_api_user`, an attacker can forge `X-Everr-Tenant-Id`.

Verdict:

Plausible only if we can prove the outgoing ClickHouse request contains no sensitive readable headers. Still weaker than one-user-per-org because direct ClickHouse access can forge the tenant header.

### Candidate: per-org views or databases

Expose only org-scoped views or org-scoped databases to the SQL API instead of base `app.*` tables.

Example:

```sql
CREATE VIEW org_<org_id>.traces
SQL SECURITY DEFINER
AS SELECT *
FROM app.traces
WHERE tenant_id = '<org_id>';
```

Then the SQL API grants access only to that org's exposed database/views.

Why this helps:

- Tenant isolation is a constant in the view definition.
- User SQL cannot override a ClickHouse setting to change the tenant.
- `SQL SECURITY DEFINER` lets the view owner read base tables while the SQL API user only gets `SELECT` on the view.

Risks:

- With one shared user, granting access to all org views lets a user query a victim's fully qualified view. This needs one org role/user per org, or some gateway rule that prevents cross-org database names.
- Many orgs means many views/databases and DDL churn.
- Queries must use the exposed database/view names. If existing guidance says `FROM traces`, the app must set the default database to the org database and not grant base `app.*`.

Verdict:

Useful if we want tenant isolation to be visible in grants/schema instead of row policies. By itself it still needs per-org roles/users to stop fully qualified cross-org reads.

### Candidate: stop exposing raw SQL

If raw SQL is negotiable, replace `/api/cli/sql` with server-owned query templates or a smaller query DSL. ClickHouse also has predefined HTTP handlers, but doing this in the app is probably simpler for Everr.

Why this helps:

- The user no longer controls arbitrary ClickHouse expressions, table names, functions, or `SETTINGS`.
- Tenant filtering stays in application-owned SQL.
- Much smaller security surface.

Risks:

- It is no longer a general SQL endpoint.
- Agents lose some flexibility for custom debugging queries.

Verdict:

Safest if product requirements allow it. Not a drop-in fix for raw SQL.

Docs checked:

- ClickHouse `getClientHTTPHeader`: https://clickhouse.com/docs/sql-reference/functions/other-functions#getclienthttpheader
- ClickHouse `allow_get_client_http_header`: https://clickhouse.com/docs/operations/settings/settings#allow_get_client_http_header
- ClickHouse JS `http_headers`: https://clickhouse.com/docs/integrations/javascript#configuration
- ClickHouse row policies: https://clickhouse.com/docs/sql-reference/statements/create/row-policy
- ClickHouse HTTP role query parameter: https://clickhouse.com/docs/interfaces/http#setting-a-role-with-query-parameters
- ClickHouse HTTP auth methods: https://clickhouse.com/docs/interfaces/http#authentication
- ClickHouse view SQL security: https://clickhouse.com/docs/sql-reference/statements/create/view#sql-security
