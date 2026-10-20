#!/bin/bash
set -eu
: "${CLICKHOUSE_SQL_API_PASSWORD:?CLICKHOUSE_SQL_API_PASSWORD is required}"
username="${CLICKHOUSE_SQL_API_USERNAME:-sql_api}"
[[ "$username" =~ ^[a-zA-Z0-9_]+$ ]] || { echo 'Invalid SQL API username' >&2; exit 1; }
password="${CLICKHOUSE_SQL_API_PASSWORD//\\/\\\\}"
password="${password//\'/\\\'}"
clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --multiquery <<SQL
CREATE USER IF NOT EXISTS \`$username\` IDENTIFIED WITH sha256_password BY '$password' SETTINGS PROFILE 'sql_api_profile';
GRANT sql_api_role TO \`$username\`;
ALTER USER \`$username\` DEFAULT ROLE sql_api_role;
CREATE QUOTA IF NOT EXISTS sql_api_quota KEYED BY user_name
  FOR INTERVAL 1 minute MAX queries = 120, errors = 20,
  FOR INTERVAL 1 hour MAX queries = 2400, read_rows = 20000000000, execution_time = 1200
  TO sql_api_role;
SQL
