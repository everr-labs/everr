#!/bin/bash
# Creates the databases and users Everr connects with, from the passwords
# configure.sh wrote to .env. The ClickHouse image runs it on every start
# (CLICKHOUSE_ALWAYS_RUN_INITDB_SCRIPTS), so it finishes an interrupted first
# run and adds users a newer release needs. Existing users keep their
# passwords. The app's migrations then grant each user its access.
#
# The image sources this file instead of running it when it is not
# executable, so it changes no shell options and defines no functions.

for everr_database in otel app; do
  clickhouse client --host 127.0.0.1 --user default --password "${CLICKHOUSE_PASSWORD:?}" \
    --query "CREATE DATABASE IF NOT EXISTS $everr_database" || exit 1
done

# Passwords go in as query parameters, so any character in them is safe.
for everr_user in \
  "collector_rw:${COLLECTOR_RW_PASSWORD:?}" \
  "app_ro:${APP_RO_PASSWORD:?}" \
  "app_admin:${WEB_APP_ADMIN_PASSWORD:?}" \
  "sql_api:${CLICKHOUSE_SQL_API_PASSWORD:?}"; do
  clickhouse client --host 127.0.0.1 --user default --password "$CLICKHOUSE_PASSWORD" \
    --param_password="${everr_user#*:}" \
    --query "CREATE USER IF NOT EXISTS ${everr_user%%:*} IDENTIFIED WITH sha256_password BY {password:String}" ||
    exit 1
done
unset everr_database everr_user
