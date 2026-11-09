CREATE DATABASE IF NOT EXISTS otel;
CREATE DATABASE IF NOT EXISTS app;

CREATE USER IF NOT EXISTS collector_rw IDENTIFIED WITH sha256_password BY {collector_rw_password:String};
CREATE USER IF NOT EXISTS app_ro IDENTIFIED WITH sha256_password BY {app_ro_password:String};
-- Application writes are granted on the alert-history table when it is created.
CREATE USER IF NOT EXISTS web_app_admin IDENTIFIED WITH sha256_password BY {web_app_admin_password:String};

-- Collector writes raw telemetry into otel schema.
GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE ON otel.* TO collector_rw;

-- App reads only curated read-model tables.
GRANT SELECT ON app.* TO app_ro;
