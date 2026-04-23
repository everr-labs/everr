package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	sqlHTTPPort = 54397
	otlpPort    = 54398
	healthPort  = 54399
)

var tables = []string{
	"otel_traces",
	"otel_logs",
	"otel_metrics_sum",
	"otel_metrics_gauge",
	"otel_metrics_histogram",
	"otel_metrics_exponential_histogram",
	"otel_metrics_summary",
}

func main() {
	out := flag.String("out", "", "output file")
	binary := flag.String("binary", "build-local/everr-local-collector", "path to everr-local-collector")
	flag.Parse()

	if *out == "" {
		log.Fatal("--out required")
	}
	if _, err := os.Stat(*binary); err != nil {
		log.Fatalf("collector binary: %v", err)
	}

	dir, err := os.MkdirTemp("", "gen-ai-schema-*")
	if err != nil {
		log.Fatal(err)
	}
	defer os.RemoveAll(dir)

	cfgPath := filepath.Join(dir, "collector.yaml")
	writeGenConfig(cfgPath, dir)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cmd := exec.CommandContext(ctx, *binary, "--config", cfgPath)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		log.Fatal(err)
	}
	defer func() {
		cancel()
		_ = cmd.Wait()
	}()

	waitHealth(fmt.Sprintf("http://127.0.0.1:%d/", healthPort), 10*time.Second)
	pokeOTLP(fmt.Sprintf("http://127.0.0.1:%d", otlpPort))
	waitReady(fmt.Sprintf("http://127.0.0.1:%d/sql", sqlHTTPPort), 10*time.Second)

	var b strings.Builder
	b.WriteString("# Local telemetry schema\n\n")
	for _, table := range tables {
		cols, err := describe(fmt.Sprintf("http://127.0.0.1:%d/sql", sqlHTTPPort), table)
		if err != nil {
			log.Fatalf("%s: %v", table, err)
		}
		b.WriteString(RenderTable(table, cols))
		b.WriteString("\n")
	}

	if err := os.WriteFile(*out, []byte(b.String()), 0o644); err != nil {
		log.Fatal(err)
	}
}

func writeGenConfig(path, dir string) {
	cfg := fmt.Sprintf(`
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:%d
processors:
  batch:
    timeout: 100ms
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
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [chdb]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [chdb]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [chdb]
  telemetry:
    metrics:
      level: none
`, otlpPort, filepath.Join(dir, "chdb"), healthPort, sqlHTTPPort, filepath.Join(dir, "chdb"))

	if err := os.WriteFile(path, []byte(cfg), 0o644); err != nil {
		log.Fatal(err)
	}
}

func waitHealth(url string, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 500 * time.Millisecond}
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
	log.Fatalf("health timeout: %s", url)
}

func waitReady(sqlURL string, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 500 * time.Millisecond}
	for time.Now().Before(deadline) {
		resp, err := client.Post(sqlURL, "text/plain", strings.NewReader("SELECT 1"))
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(250 * time.Millisecond)
	}
	log.Fatalf("sqlhttp never became ready: %s", sqlURL)
}

func pokeOTLP(baseURL string) {
	now := time.Now()
	start := now.Add(-time.Second)

	postOTLP(
		baseURL+"/v1/logs",
		fmt.Sprintf(
			`{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"gen"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"%d","severityNumber":9,"severityText":"INFO","body":{"stringValue":"hi"}}]}]}]}`,
			now.UnixNano(),
		),
	)

	postOTLP(
		baseURL+"/v1/traces",
		fmt.Sprintf(
			`{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"gen"}}]},"scopeSpans":[{"scope":{"name":"genaischema"},"spans":[{"traceId":"0102030405060708090a0b0c0d0e0f10","spanId":"1112131415161718","name":"gen.schema.trace","kind":1,"startTimeUnixNano":"%d","endTimeUnixNano":"%d","status":{"code":1}}]}]}]}`,
			start.UnixNano(),
			now.UnixNano(),
		),
	)

	postOTLP(
		baseURL+"/v1/metrics",
		fmt.Sprintf(
			`{"resourceMetrics":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"gen"}}]},"scopeMetrics":[{"scope":{"name":"genaischema"},"metrics":[{"name":"gen.schema.metric","sum":{"aggregationTemporality":2,"isMonotonic":true,"dataPoints":[{"asInt":"1","startTimeUnixNano":"%d","timeUnixNano":"%d","attributes":[{"key":"kind","value":{"stringValue":"seed"}}]}]}}]}]}]}`,
			start.UnixNano(),
			now.UnixNano(),
		),
	)
}

func postOTLP(url, body string) {
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := http.Post(url, "application/json", strings.NewReader(body))
		if err == nil {
			payload, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
			if resp.StatusCode != http.StatusNotFound {
				log.Fatalf("poke OTLP %s status %d: %s", url, resp.StatusCode, strings.TrimSpace(string(payload)))
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	log.Fatalf("poke OTLP %s did not reach a ready receiver", url)
}

func describe(sqlURL, table string) ([]Column, error) {
	resp, err := http.Post(sqlURL, "text/plain", strings.NewReader(fmt.Sprintf("DESCRIBE TABLE %s", table)))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var cols []Column
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), 1<<20)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var col Column
		if err := json.Unmarshal(line, &col); err != nil {
			return nil, fmt.Errorf("decode row: %w (line=%q)", err, string(line))
		}
		cols = append(cols, col)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return cols, nil
}
