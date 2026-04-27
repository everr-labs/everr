package smoke

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

const (
	collectorBinaryName = "everr-local-collector"
)

func TestChdbSmoke(t *testing.T) {
	binary := resolveCollectorBinary(t)
	if _, err := os.Stat(binary); err != nil {
		t.Skipf("collector binary not built: %v", err)
	}

	otlpPort := freeTCPPort(t)
	chdbDir := filepath.Join(t.TempDir(), "chdb")
	cfgPath := filepath.Join(t.TempDir(), "collector.yaml")
	writeCollectorConfig(t, cfgPath, chdbDir, otlpPort)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cmd := exec.CommandContext(ctx, binary, "--config", cfgPath)
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output

	if err := cmd.Start(); err != nil {
		t.Fatalf("start collector: %v", err)
	}
	t.Cleanup(func() {
		cancel()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})

	waitForCollectorLogs(t, otlpPort, cmd, &output)

	waitForPopulatedDir(t, chdbDir, 10*time.Second)
}

func TestSQLHTTPRoundTrip(t *testing.T) {
	binary := resolveCollectorBinary(t)
	if _, err := os.Stat(binary); err != nil {
		t.Skipf("collector binary not built: %v", err)
	}

	otlpPort := freeTCPPort(t)
	healthPort := freeTCPPort(t)
	sqlPort := freeTCPPort(t)
	chdbDir := filepath.Join(t.TempDir(), "chdb")
	cfgPath := filepath.Join(t.TempDir(), "collector.yaml")
	writeCollectorConfigWithSQL(t, cfgPath, chdbDir, otlpPort, healthPort, sqlPort)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cmd := exec.CommandContext(ctx, binary, "--config", cfgPath)
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output

	if err := cmd.Start(); err != nil {
		t.Fatalf("start collector: %v", err)
	}
	t.Cleanup(func() {
		cancel()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})

	waitForHTTP(t, fmt.Sprintf("http://127.0.0.1:%d/", healthPort), 10*time.Second)
	waitForCollectorLogs(t, otlpPort, cmd, &output)

	waitForSQLResponse(
		t,
		fmt.Sprintf("http://127.0.0.1:%d/sql", sqlPort),
		`SELECT count() AS c FROM otel_logs`,
		10*time.Second,
		func(body string) bool { return strings.Contains(body, `"c":1`) },
	)

	resp, err := http.Post(
		fmt.Sprintf("http://127.0.0.1:%d/sql", sqlPort),
		"text/plain",
		strings.NewReader(`INSERT INTO otel_logs VALUES (1)`),
	)
	if err != nil {
		t.Fatalf("sql insert request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 400 from write attempt, got %d: %s", resp.StatusCode, body)
	}
}

func resolveCollectorBinary(t *testing.T) string {
	t.Helper()
	if env := os.Getenv("EVERR_COLLECTOR_BIN"); env != "" {
		return env
	}

	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}

	return filepath.Join(filepath.Dir(thisFile), "..", "..", "build-local", collectorBinaryName)
}

func freeTCPPort(t *testing.T) int {
	t.Helper()

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	defer l.Close()

	addr, ok := l.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("unexpected listener addr type %T", l.Addr())
	}

	return addr.Port
}

func writeCollectorConfig(t *testing.T, path, chdbDir string, otlpPort int) {
	t.Helper()

	cfg := fmt.Sprintf(`
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:%d
processors:
  batch:
    timeout: 250ms
exporters:
  chdb:
    path: %q
service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [chdb]
  telemetry:
    metrics:
      level: none
`, otlpPort, chdbDir)

	if err := os.WriteFile(path, []byte(cfg), 0o644); err != nil {
		t.Fatalf("write collector config: %v", err)
	}
}

func writeCollectorConfigWithSQL(
	t *testing.T,
	path, chdbDir string,
	otlpPort, healthPort, sqlPort int,
) {
	t.Helper()

	cfg := fmt.Sprintf(`
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:%d
processors:
  batch:
    timeout: 250ms
exporters:
  chdb:
    path: %q
    ttl: 48h
extensions:
  health_check:
    endpoint: 127.0.0.1:%d
  sqlhttp:
    endpoint: 127.0.0.1:%d
    path: %q
service:
  extensions: [health_check, sqlhttp]
  pipelines:
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [chdb]
  telemetry:
    metrics:
      level: none
`, otlpPort, chdbDir, healthPort, sqlPort, chdbDir)

	if err := os.WriteFile(path, []byte(cfg), 0o644); err != nil {
		t.Fatalf("write collector config: %v", err)
	}
}

func waitForCollectorLogs(t *testing.T, port int, cmd *exec.Cmd, output *bytes.Buffer) {
	t.Helper()

	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(15 * time.Second)

	for time.Now().Before(deadline) {
		if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
			t.Fatalf("collector exited early:\n%s", output.String())
		}

		reqBody := bytes.NewReader([]byte(logBodyPayload()))
		resp, err := client.Post(fmt.Sprintf("http://127.0.0.1:%d/v1/logs", port), "application/json", reqBody)
		if err == nil && resp != nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}

		time.Sleep(100 * time.Millisecond)
	}

	_ = cmd.Process.Kill()
	t.Fatalf("collector never accepted OTLP logs:\n%s", output.String())
}

func logBodyPayload() string {
	return fmt.Sprintf(
		`{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"smoke"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"%d","severityText":"INFO","body":{"stringValue":"hello"}}]}]}]}`,
		time.Now().UnixNano(),
	)
}

func waitForPopulatedDir(t *testing.T, dir string, timeout time.Duration) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		entries, err := os.ReadDir(dir)
		if err == nil && len(entries) > 0 {
			return
		}

		time.Sleep(200 * time.Millisecond)
	}

	t.Fatalf("chdb data dir stayed empty: %s", dir)
}

func waitForHTTP(t *testing.T, url string, timeout time.Duration) {
	t.Helper()

	client := &http.Client{Timeout: 500 * time.Millisecond}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}

	t.Fatalf("timed out waiting for %s", url)
}

func waitForSQLResponse(
	t *testing.T,
	url, sql string,
	timeout time.Duration,
	match func(string) bool,
) {
	t.Helper()

	client := &http.Client{Timeout: 500 * time.Millisecond}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := client.Post(url, "text/plain", strings.NewReader(sql))
		if err == nil {
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK && match(string(body)) {
				return
			}
		}
		time.Sleep(250 * time.Millisecond)
	}

	t.Fatalf("timed out waiting for sql response from %s", url)
}
