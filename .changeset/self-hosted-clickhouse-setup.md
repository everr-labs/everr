---
"@everr/app": minor
---

Self-hosted ClickHouse now gets its databases and users from the deployment, not from the app. The Compose bundle creates them with `deploy/clickhouse-init.sh` each time ClickHouse starts, from the passwords in `.env`. It never changes the password of a user that already exists. If you run your own ClickHouse, create the `otel` and `app` databases and the `collector_rw`, `app_ro`, `app_admin` and `sql_api` users before you start the app; it grants their access on startup.

The database and user names are now fixed: the app connects to `app` as `app_ro` and `app_admin`, and the SQL API uses `sql_api`. `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_ADMIN_USERNAME`, `CLICKHOUSE_SQL_API_USERNAME` and `CLICKHOUSE_COLLECTOR_PASSWORD` are no longer read, so remove them from your environment.
