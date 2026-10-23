#!/bin/bash
set -e

sql_api_username="${CLICKHOUSE_SQL_API_USERNAME:-sql_api}"
if [[ ! "$sql_api_username" =~ ^[a-zA-Z0-9_]+$ ]]; then
  echo 'CLICKHOUSE_SQL_API_USERNAME must contain only letters, digits, or underscores' >&2
  exit 1
fi

: "${CLICKHOUSE_SQL_API_PASSWORD:?CLICKHOUSE_SQL_API_PASSWORD is required}"
sql_api_password="${CLICKHOUSE_SQL_API_PASSWORD//\\/\\\\}"
sql_api_password="${sql_api_password//\'/\\\'}"

# One restricted SQL API identity for the whole installation.
clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --multiquery <<SQL
CREATE USER IF NOT EXISTS \`$sql_api_username\` IDENTIFIED WITH sha256_password BY '$sql_api_password' SETTINGS PROFILE 'sql_api_profile';
GRANT sql_api_role TO \`$sql_api_username\`;
ALTER USER \`$sql_api_username\` DEFAULT ROLE sql_api_role;
SQL
