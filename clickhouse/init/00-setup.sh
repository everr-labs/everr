#!/bin/bash
set -e

: "${COLLECTOR_RW_PASSWORD:?COLLECTOR_RW_PASSWORD is required}"
: "${APP_RO_PASSWORD:?APP_RO_PASSWORD is required}"
: "${APP_CDEVENTS_RW_PASSWORD:?APP_CDEVENTS_RW_PASSWORD is required}"

clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --multiquery <<SQL
CREATE DATABASE IF NOT EXISTS otel;
CREATE DATABASE IF NOT EXISTS app;

CREATE USER IF NOT EXISTS collector_rw IDENTIFIED WITH sha256_password BY '${COLLECTOR_RW_PASSWORD}';
CREATE USER IF NOT EXISTS app_ro IDENTIFIED WITH sha256_password BY '${APP_RO_PASSWORD}';
CREATE USER IF NOT EXISTS app_cdevents_rw IDENTIFIED WITH sha256_password BY '${APP_CDEVENTS_RW_PASSWORD}';

-- Collector writes raw telemetry into otel schema.
GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE ON otel.* TO collector_rw;

-- App reads only curated read-model tables.
GRANT SELECT ON app.* TO app_ro;

-- The app-side cdevents worker writes normalized rows directly into app.cdevents.
GRANT INSERT ON app.* TO app_cdevents_rw;
SQL
