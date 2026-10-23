package recipe

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// Exec loads local connection settings and replaces itself with the YAML command.
// Portless owns HTTP ports and names; Process Compose owns process lifetime.
func Exec(args []string) error {
	if len(args) < 3 {
		return fmt.Errorf("expected exec <app|collector> <app|cloud> <command> [args...]")
	}
	kind, variant := args[0], args[1]
	if (kind != "app" && kind != "collector") || (variant != "app" && variant != "cloud") {
		return fmt.Errorf("invalid development process: %s %s", kind, variant)
	}
	suffix := ".env.json"
	if kind == "collector" {
		suffix = ".collector.env.json"
	}
	data, err := os.ReadFile(filepath.Join(os.Getenv("DEV_RUN_DIR"), variant+suffix))
	if err != nil {
		return err
	}
	var env map[string]string
	if err := json.Unmarshal(data, &env); err != nil {
		return err
	}
	ch, err := dockerPort("clickhouse-"+variant, "8123")
	if err != nil {
		return err
	}
	env["CLICKHOUSE_URL"] = "http://127.0.0.1:" + ch
	prefix := "DEV_" + strings.ToUpper(variant)
	if kind == "app" {
		pg, err := dockerPort("postgres", "5432")
		if err != nil {
			return err
		}
		env["DATABASE_PORT"] = pg
		env["BETTER_AUTH_URL"] = os.Getenv("PORTLESS_URL")
		env["INGRESS_COLLECTOR_URL"] = os.Getenv(prefix + "_INGEST_URL")
		key := "EVERR_PUBLIC_INGEST_URL"
		if variant == "cloud" {
			key = "VITE_EVERR_PUBLIC_INGEST_URL"
		}
		env[key] = os.Getenv(prefix + "_INGEST_URL")
	} else {
		env["INGEST_VERIFY_URL"] = os.Getenv(prefix+"_URL") + "/api/internal/verify-key"
		if variant == "cloud" {
			if err := os.MkdirAll(env["EVERR_QUEUE_DIRECTORY"], 0700); err != nil {
				return err
			}
		}
		if ca := os.Getenv("NODE_EXTRA_CA_CERTS"); ca != "" {
			env["SSL_CERT_FILE"] = ca
		}
	}
	for key, value := range env {
		if err := os.Setenv(key, value); err != nil {
			return err
		}
	}
	path, err := exec.LookPath(args[2])
	if err != nil {
		return err
	}
	return syscall.Exec(path, args[2:], os.Environ())
}
func dockerPort(service, target string) (string, error) {
	cmd := exec.Command("docker", "compose", "port", service, target)
	cmd.Stderr = os.Stderr
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	_, port, err := net.SplitHostPort(strings.TrimSpace(string(output)))
	return port, err
}
