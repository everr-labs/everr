// Package recipe prepares Everr's development dependencies independently of the supervisor.
package recipe

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const devPassword = "dev"
const devSecret = "everr-development-only-not-a-secret"

func Prepare(state, runtime string) error {
	for _, variant := range []string{"app", "cloud"} {
		env := map[string]string{
			"NODE_ENV": "development", "SKIP_ENV_VALIDATION": "false", "DATABASE_HOST": "127.0.0.1", "DATABASE_NAME": "everr_" + variant, "DATABASE_USER": "everr_" + variant, "DATABASE_PASSWORD": devPassword, "DATABASE_SSL": "false",
			"CLICKHOUSE_DATABASE": "app", "CLICKHOUSE_USERNAME": "app_ro", "CLICKHOUSE_PASSWORD": devPassword, "CLICKHOUSE_ADMIN_USERNAME": "web_app_admin", "CLICKHOUSE_ADMIN_PASSWORD": devPassword,
			"CLICKHOUSE_SQL_API_USERNAME": "sql_api", "CLICKHOUSE_SQL_API_PASSWORD": devPassword, "CLICKHOUSE_SQL_API_MASTER_KEY": devSecret,
			"BETTER_AUTH_SECRET": devSecret, "INGEST_VERIFY_SHARED_SECRET": devSecret,
			"EVERR_GITHUB_ENABLED": "false", "SMEE_CHANNEL": "", "GITHUB_APP_ID": "", "GITHUB_APP_PRIVATE_KEY": "", "GITHUB_APP_WEBHOOK_SECRET": "", "GITHUB_APP_INSTALL_URL": "",
		}
		collectorEnv := map[string]string{
			"CLICKHOUSE_USERNAME": "collector_rw", "CLICKHOUSE_PASSWORD": devPassword,
			"CLICKHOUSE_DATABASE": "otel", "INGEST_VERIFY_SHARED_SECRET": devSecret,
		}
		if variant == "cloud" {
			collectorEnv["EVERR_QUEUE_DIRECTORY"] = filepath.Join(state, "cloud-queue")
		}
		if err := writeJSON(filepath.Join(runtime, variant+".collector.env.json"), collectorEnv); err != nil {
			return err
		}
		if err := writeJSON(filepath.Join(runtime, variant+".env.json"), env); err != nil {
			return err
		}
	}
	return nil
}

func writeJSON(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

func Databases(ctx context.Context) error {
	run := func(input string, args ...string) error {
		cmd := exec.CommandContext(ctx, "docker", append([]string{"compose"}, args...)...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Stdin = strings.NewReader(input)
		return cmd.Run()
	}
	if err := run("ALTER ROLE postgres PASSWORD 'dev';\n", "exec", "-T", "postgres", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"); err != nil {
		return err
	}
	for _, variant := range []string{"app", "cloud"} {
		name := "everr_" + variant
		sql := fmt.Sprintf("SELECT 'CREATE ROLE %s LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '%s')\\gexec\nALTER ROLE %s PASSWORD '%s';\nSELECT 'CREATE DATABASE %s OWNER %s' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '%s')\\gexec\n", name, name, name, devPassword, name, name, name)
		if err := run(sql, "exec", "-T", "postgres", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"); err != nil {
			return err
		}
	}
	return nil
}
