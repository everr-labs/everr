-- web_app_admin needs ADMIN OPTION on sql_api_role to grant it to the per-org
-- users it provisions. Granted here (not in 00-setup.sh) because the role
-- doesn't exist yet at that point in the boot order.
GRANT sql_api_role TO web_app_admin WITH ADMIN OPTION;

-- Keep sql_api_role out of web_app_admin's default roles. Otherwise CH would
-- auto-activate it on every connection and apply sql_api_profile (readonly=1,
-- allow_ddl=0, etc.) to web_app_admin's sessions, which would break the
-- CREATE USER / GRANT / CREATE ROW POLICY work it has to do. The app code
-- uses SET ROLE to activate it only for the GRANT statement.
ALTER USER web_app_admin DEFAULT ROLE NONE;

-- Quota: per-tenant limits. Keyed by client_key so each org gets its own
-- bucket via the X-ClickHouse-Quota header (querySqlApi in
-- packages/app/src/lib/clickhouse.ts sets it to the per-org username). The CH
-- client never propagates a header from user input, so the key is not
-- attacker-controlled. OR REPLACE so the keying change applies on fresh init
-- even when the quota name was already created by an earlier image.
CREATE QUOTA OR REPLACE sql_api_quota
  KEYED BY client_key
  FOR INTERVAL 1 minute MAX queries = 120, errors = 20,
  FOR INTERVAL 1 hour   MAX queries = 2400, read_rows = 20000000000, execution_time = 1200
  TO sql_api_role EXCEPT web_app_admin;
