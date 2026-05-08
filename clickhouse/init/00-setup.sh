#!/bin/bash
set -e

: "${COLLECTOR_RW_PASSWORD:?COLLECTOR_RW_PASSWORD is required}"
: "${APP_RO_PASSWORD:?APP_RO_PASSWORD is required}"
: "${WEB_APP_ADMIN_PASSWORD:?WEB_APP_ADMIN_PASSWORD is required}"

clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --multiquery <<SQL
CREATE DATABASE IF NOT EXISTS otel;
CREATE DATABASE IF NOT EXISTS app;

CREATE USER IF NOT EXISTS collector_rw IDENTIFIED WITH sha256_password BY '${COLLECTOR_RW_PASSWORD}';
CREATE USER IF NOT EXISTS app_ro IDENTIFIED WITH sha256_password BY '${APP_RO_PASSWORD}';
-- web_app_admin holds every privilege the web-app process needs that goes
-- beyond app_ro's read-only data access: writing per-tenant retention rows,
-- and provisioning per-org access entities (users + row policies) for the
-- /sql API. See the GRANT block below for the exact split.
CREATE USER IF NOT EXISTS web_app_admin IDENTIFIED WITH sha256_password BY '${WEB_APP_ADMIN_PASSWORD}';

-- Collector writes raw telemetry into otel schema.
GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE ON otel.* TO collector_rw;

-- App reads only curated read-model tables.
GRANT SELECT ON app.* TO app_ro;

-- App writes per-tenant retention rows; the dictionary refreshes itself via
-- LIFETIME(MIN 60 MAX 120). Tables and the dictionary are created in 10-create-mvs.sql.
-- SELECT is granted so the dictionary source can authenticate as web_app_admin.
GRANT INSERT, SELECT ON app.tenant_retention_source TO web_app_admin;

-- dictGet is needed wherever the TTL expression evaluates dictGetOrDefault:
-- collector_rw inserts trigger the materialized views which call dictGet during
-- the cascading INSERT into app.*; app_ro queries may also reference it.
GRANT dictGet ON app.tenant_retention TO collector_rw;
GRANT dictGet ON app.tenant_retention TO app_ro;

-- Access-management grants for /sql API per-org provisioning:
--   CREATE/ALTER/DROP USER: needed to make per-org users \`sql_api_org_<id>\`.
--     CH does not allow scoping user creation by name pattern.
--   CREATE/DROP ROW POLICY ON app.*: scoped to the app database. Means a
--     compromised web app could drop tenant filters — but not an escalation
--     beyond what app_ro already gives a compromised app process, since app_ro
--     can override SQL_everr_tenant_id (no readonly profile).
-- The ADMIN OPTION on sql_api_role is granted in 15-create-sql-api-role.sql
-- once the role exists, so web_app_admin can grant it to per-org users.
GRANT CREATE USER, ALTER USER, DROP USER ON *.* TO web_app_admin;
GRANT CREATE ROW POLICY, DROP ROW POLICY ON app.* TO web_app_admin;
SQL
