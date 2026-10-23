#!/bin/bash
set -eu
for variant in cloud app; do
  if [ "$variant" = cloud ]; then
    export COLLECTOR_RW_PASSWORD="$CLOUD_COLLECTOR_PASSWORD" APP_RO_PASSWORD="$CLOUD_READER_PASSWORD" WEB_APP_ADMIN_PASSWORD="$CLOUD_WRITER_PASSWORD"
  else
    export COLLECTOR_RW_PASSWORD="$APP_COLLECTOR_PASSWORD" APP_RO_PASSWORD="$APP_READER_PASSWORD" WEB_APP_ADMIN_PASSWORD="$APP_WRITER_PASSWORD"
  fi
  for file in /dev-init/$variant/*; do
    case "$file" in
      *.sh) bash "$file" ;;
      *.sql) clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --multiquery < "$file" ;;
    esac
  done
done
clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --multiquery <<'SQL'
ALTER USER collector_rw IDENTIFIED WITH sha256_password BY 'dev';
ALTER USER app_ro IDENTIFIED WITH sha256_password BY 'dev';
ALTER USER web_app_admin IDENTIFIED WITH sha256_password BY 'dev';
ALTER USER installation_collector_rw IDENTIFIED WITH sha256_password BY 'dev';
ALTER USER installation_app_ro IDENTIFIED WITH sha256_password BY 'dev';
ALTER USER installation_web_app_admin IDENTIFIED WITH sha256_password BY 'dev';
ALTER USER installation_sql_api IDENTIFIED WITH sha256_password BY 'dev';
SQL
