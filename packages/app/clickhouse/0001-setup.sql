CREATE DATABASE IF NOT EXISTS otel;
CREATE DATABASE IF NOT EXISTS app;

CREATE USER IF NOT EXISTS collector_rw IDENTIFIED WITH sha256_password BY {collector_rw_password:String};
CREATE USER IF NOT EXISTS app_ro IDENTIFIED WITH sha256_password BY {app_ro_password:String};
-- app_admin holds what the web-app process needs beyond app_ro's read-only
-- access. Writes to alert history are granted when that table is created.
-- Cloud adds per-organization provisioning in 0002-cloud-grant-provisioning.sql.
CREATE USER IF NOT EXISTS app_admin IDENTIFIED WITH sha256_password BY {app_admin_password:String};

-- Collector writes raw telemetry into otel schema.
GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE ON otel.* TO collector_rw;

-- App reads only curated read-model tables.
GRANT SELECT ON app.* TO app_ro;
