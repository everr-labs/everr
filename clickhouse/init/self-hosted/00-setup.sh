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
-- Application writes are granted on the alert-history table when it is created.
CREATE USER IF NOT EXISTS web_app_admin IDENTIFIED WITH sha256_password BY '${WEB_APP_ADMIN_PASSWORD}';

-- Collector writes raw telemetry into otel schema.
GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE ON otel.* TO collector_rw;

-- App reads only curated read-model tables.
GRANT SELECT ON app.* TO app_ro;

SQL
