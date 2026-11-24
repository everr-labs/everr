-- What the infrastructure creates on Cloud before the app first starts: the
-- databases and the service users. Cloud's migrations grant them their access.
CREATE DATABASE IF NOT EXISTS otel;
CREATE DATABASE IF NOT EXISTS app;

CREATE USER IF NOT EXISTS collector_rw IDENTIFIED WITH sha256_password BY 'dev';
CREATE USER IF NOT EXISTS app_ro IDENTIFIED WITH sha256_password BY 'dev';
CREATE USER IF NOT EXISTS app_admin IDENTIFIED WITH sha256_password BY 'dev';
