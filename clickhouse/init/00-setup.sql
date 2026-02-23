CREATE DATABASE IF NOT EXISTS otel;
CREATE DATABASE IF NOT EXISTS app;

CREATE USER IF NOT EXISTS collector_rw IDENTIFIED WITH sha256_password BY 'change-me-strong';
CREATE USER IF NOT EXISTS app_ro IDENTIFIED WITH sha256_password BY 'change-me-strong';
CREATE USER IF NOT EXISTS app_mv_admin IDENTIFIED WITH sha256_password BY 'change-me-strong';

-- Collector writes raw telemetry into otel schema.
GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE ON otel.* TO collector_rw;

-- App reads only curated read-model tables.
GRANT SELECT ON app.* TO app_ro;

-- Dedicated user that owns/maintains app materialized views.
GRANT SELECT ON otel.* TO app_mv_admin;
GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE, DROP TABLE ON app.* TO app_mv_admin;
GRANT CREATE VIEW, ALTER VIEW, DROP VIEW ON app.* TO app_mv_admin;
