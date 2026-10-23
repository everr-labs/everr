#!/bin/bash
set -e

: "${COLLECTOR_RW_PASSWORD:?COLLECTOR_RW_PASSWORD is required}"
: "${APP_RO_PASSWORD:?APP_RO_PASSWORD is required}"
: "${WEB_APP_ADMIN_PASSWORD:?WEB_APP_ADMIN_PASSWORD is required}"

: "${CLICKHOUSE_SQL_API_PASSWORD:?CLICKHOUSE_SQL_API_PASSWORD is required}"
sql_api_password="${CLICKHOUSE_SQL_API_PASSWORD//\\/\\\\}"
sql_api_password="${sql_api_password//\'/\\\'}"

clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --multiquery <<SQL
CREATE DATABASE IF NOT EXISTS otel;
CREATE DATABASE IF NOT EXISTS app;

CREATE USER IF NOT EXISTS collector_rw IDENTIFIED WITH sha256_password BY '${COLLECTOR_RW_PASSWORD}';
CREATE USER IF NOT EXISTS app_ro IDENTIFIED WITH sha256_password BY '${APP_RO_PASSWORD}';
-- Application writes are granted on the alert-history table when it is created.
CREATE USER IF NOT EXISTS web_app_admin IDENTIFIED WITH sha256_password BY '${WEB_APP_ADMIN_PASSWORD}';

-- Collector writes raw telemetry into otel schema.
GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE ON otel.* TO collector_rw;

-- App reads only curated read-model tables.
GRANT SELECT ON app.* TO app_ro;

-- One SQL API identity for the whole installation. Its read-only role and
-- query limits are assigned in 15-create-sql-api-role.sql.
CREATE USER IF NOT EXISTS sql_api IDENTIFIED WITH sha256_password BY '$sql_api_password';
SQL
