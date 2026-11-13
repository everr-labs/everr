package localcollector

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func freeOrigin(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()
	return "http://" + ln.Addr().String()
}

func health(origin string) (int, map[string]any) {
	resp, err := http.Get(origin + "/health")
	if err != nil {
		return 0, nil
	}
	defer resp.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	return resp.StatusCode, body
}

func sendLog(t *testing.T, otlp, body string) {
	t.Helper()
	payload := fmt.Sprintf(`{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"localcollector-test"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"%d","body":{"stringValue":%q}}]}]}]}`, time.Now().UnixNano(), body)
	resp, err := http.Post(otlp+"/v1/logs", "application/json", strings.NewReader(payload))
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)
}

func countLogs(t *testing.T, sql, body string) int {
	t.Helper()
	query := fmt.Sprintf("SELECT count() AS n FROM logs WHERE Body = '%s'", body)
	resp, err := http.Post(sql+"/sql", "text/plain", bytes.NewBufferString(query))
	require.NoError(t, err)
	defer resp.Body.Close()
	out, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	if resp.StatusCode != http.StatusOK {
		t.Logf("sql %d: %s", resp.StatusCode, out)
		return -1
	}
	var row struct {
		N json.Number `json:"n"`
	}
	require.NoError(t, json.Unmarshal(out, &row), string(out))
	n, err := row.N.Int64()
	require.NoError(t, err)
	return int(n)
}

func runUntilReady(t *testing.T, g *Gateway, sql string) (cancel func()) {
	t.Helper()
	ctx, stop := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- g.Run(ctx) }()
	require.Eventually(t, func() bool {
		code, _ := health(sql)
		return code == http.StatusOK
	}, 20*time.Second, 50*time.Millisecond)
	return func() {
		stop()
		require.ErrorIs(t, <-done, context.Canceled)
	}
}

func TestGatewayRestartsPipelineOnTheSameChDB(t *testing.T) {
	if os.Getenv("CHDB_LIB_PATH") == "" {
		t.Skip("CHDB_LIB_PATH not set")
	}
	otlp, sql := freeOrigin(t), freeOrigin(t)
	g, err := Open(Options{
		OTLPEndpoint: otlp,
		SQLEndpoint:  sql,
		ChDBPath:     t.TempDir(),
		TTL:          24 * time.Hour,
		Version:      "1.2.3",
		InstanceID:   "test-instance",
	})
	require.NoError(t, err)
	defer g.Close(context.Background())

	code, identity := health(sql)
	require.Equal(t, http.StatusServiceUnavailable, code)
	require.Equal(t, "starting", identity["status"])
	require.Equal(t, "test-instance", identity["instance_id"])

	stop := runUntilReady(t, g, sql)
	sendLog(t, otlp, "first")
	require.Eventually(t, func() bool { return countLogs(t, sql, "first") == 1 }, 10*time.Second, 100*time.Millisecond)
	stop()

	code, _ = health(sql)
	require.Equal(t, http.StatusServiceUnavailable, code)

	stop = runUntilReady(t, g, sql)
	defer stop()
	sendLog(t, otlp, "second")
	require.Eventually(t, func() bool { return countLogs(t, sql, "second") == 1 }, 10*time.Second, 100*time.Millisecond)
	require.Equal(t, 1, countLogs(t, sql, "first"))
}
