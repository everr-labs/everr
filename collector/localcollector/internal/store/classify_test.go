package store

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestClassifySkipsAccessControl(t *testing.T) {
	for _, statement := range []string{
		"CREATE USER IF NOT EXISTS collector_rw IDENTIFIED WITH sha256_password BY {collector_rw_password:String}",
		"ALTER USER app_admin DEFAULT ROLE NONE",
		"DROP USER app_ro",
		"GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE ON otel.* TO collector_rw",
		"GRANT CURRENT GRANTS(CREATE USER, ALTER USER, DROP USER ON *.*) TO app_admin",
		"GRANT sql_api_role TO app_admin WITH ADMIN OPTION",
		"REVOKE SELECT ON system.tables FROM sql_api_role",
		"CREATE ROLE IF NOT EXISTS sql_api_role SETTINGS PROFILE 'sql_api_profile'",
		"ALTER ROLE sql_api_role",
		"DROP ROLE sql_api_role",
		"CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_traces ON app.traces",
		"CREATE ROW POLICY OR REPLACE tenant_filter_logs ON app.logs FOR SELECT USING 1",
		"DROP ROW POLICY tenant_filter_logs ON app.logs",
		"CREATE POLICY p ON app.logs USING 1",
		"CREATE SETTINGS PROFILE IF NOT EXISTS sql_api_profile SETTINGS max_result_rows = 1",
		"ALTER SETTINGS PROFILE sql_api_profile",
		"CREATE PROFILE p",
		"CREATE QUOTA OR REPLACE sql_api_quota KEYED BY client_key",
		"DROP QUOTA sql_api_quota",
		"SET ROLE sql_api_role",
		"SET DEFAULT ROLE sql_api_role TO app_admin",
		"grant select on app.logs to app_ro",
		"  \n\tCreate\n  Row\tPolicy p ON app.logs",
	} {
		require.Equal(t, accessControl, classify(statement), statement)
	}
}

func TestClassifyRunsEverythingElse(t *testing.T) {
	for _, statement := range []string{
		"CREATE DATABASE IF NOT EXISTS otel",
		"CREATE TABLE IF NOT EXISTS otel.otel_logs (Timestamp DateTime64(9)) ENGINE = Null",
		"CREATE TABLE user_events (a UInt8) ENGINE = Memory",
		"CREATE TABLE roles (a UInt8) ENGINE = Memory",
		"CREATE TABLE IF NOT EXISTS app.quota_usage (a UInt8) ENGINE = Memory",
		"CREATE MATERIALIZED VIEW IF NOT EXISTS app.roles_mv TO app.logs AS SELECT 1",
		"CREATE VIEW policy_view AS SELECT 1",
		"ALTER TABLE app.logs ADD INDEX IF NOT EXISTS idx_trace_id TraceId TYPE bloom_filter",
		"ALTER TABLE app.traces MODIFY COLUMN `Timestamp` CODEC(Delta(8), ZSTD(1))",
		"DROP TABLE app.users",
		"CREATE OR REPLACE FUNCTION errorFingerprint AS (a) -> a",
		"SET max_threads = 1",
		"SET DEFAULT_ROLE_X = 1",
		"SELECT 1",
		"USE app",
		"GRANTED",
		"",
		"   ",
	} {
		require.Equal(t, runLocally, classify(statement), statement)
	}
}
