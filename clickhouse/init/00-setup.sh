#!/bin/bash
set -e

: "${COLLECTOR_RW_PASSWORD:?COLLECTOR_RW_PASSWORD is required}"
: "${APP_RO_PASSWORD:?APP_RO_PASSWORD is required}"
: "${APP_RETENTION_PASSWORD:?APP_RETENTION_PASSWORD is required}"

clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --multiquery <<SQL
CREATE DATABASE IF NOT EXISTS otel;
CREATE DATABASE IF NOT EXISTS app;

CREATE USER IF NOT EXISTS collector_rw IDENTIFIED WITH sha256_password BY '${COLLECTOR_RW_PASSWORD}';
CREATE USER IF NOT EXISTS app_ro IDENTIFIED WITH sha256_password BY '${APP_RO_PASSWORD}';
CREATE USER IF NOT EXISTS app_retention IDENTIFIED WITH sha256_password BY '${APP_RETENTION_PASSWORD}';

-- Collector writes raw telemetry into otel schema.
GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE ON otel.* TO collector_rw;

-- App reads only curated read-model tables.
GRANT SELECT ON app.* TO app_ro;

-- App writes per-tenant retention rows; the dictionary refreshes itself via
-- LIFETIME(MIN 60 MAX 120). Tables and the dictionary are created in 10-create-mvs.sql.
GRANT INSERT ON app.tenant_retention_source TO app_retention;
SQL
