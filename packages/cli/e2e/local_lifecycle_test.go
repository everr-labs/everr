package e2e

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// instance runs a real local collector with its own ports and directories.
type instance struct {
	*Env
	data    string
	sql     string
	otlp    string
	ui      string
	chdbLib string
}

func newInstance(t *testing.T) *instance {
	t.Helper()
	if _, err := os.Stat("../internal/assets/localui/index.html"); err != nil {
		t.Skip("local UI not staged; run scripts/stage-go-assets.ts")
	}
	data := t.TempDir()
	i := &instance{
		Env:  NewEnv(t),
		data: data,
		sql:  stoppedOrigin(t),
		otlp: stoppedOrigin(t),
		ui:   stoppedOrigin(t),
	}
	i.Setenv("EVERR_SQL_HTTP_ORIGIN", i.sql).
		Setenv("EVERR_OTLP_HTTP_ORIGIN", i.otlp).
		Setenv("EVERR_LOCAL_UI_ORIGIN", i.ui).
		Setenv("EVERR_CONFIG_DIR", filepath.Join(data, "remote-config")).
		Setenv("EVERR_TELEMETRY_DIR", data).
		Setenv("EVERR_LOCAL_LOG_DIR", filepath.Join(data, "logs")).
		Setenv("EVERR_INTERNAL_TELEMETRY_ENDPOINT", i.otlp)
	// Reuse the library the collector tests download instead of extracting
	// the embedded copy into every test's fresh HOME.
	if lib, err := filepath.Abs("../../../target/chdb/v26.7.3-extract/libchdb.so"); err == nil {
		if _, err := os.Stat(lib); err == nil {
			i.Setenv("CHDB_LIB_PATH", lib)
		}
	}
	t.Cleanup(func() { _ = i.Command("local", "stop").Run() })
	return i
}

func (i *instance) identity(t *testing.T) map[string]any {
	t.Helper()
	resp, err := http.Get(i.ui + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var identity map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&identity); err != nil {
		t.Fatal(err)
	}
	return identity
}

func (i *instance) waitReady(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for i.Command("local", "status").Run() != nil {
		if time.Now().After(deadline) {
			t.Fatal("instance did not become ready")
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func (i *instance) sendLog(t *testing.T, body string) {
	t.Helper()
	payload := fmt.Sprintf(`{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"local-detach-test"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"%d","severityNumber":9,"severityText":"INFO","body":{"stringValue":%q}}]}]}]}`, time.Now().UnixNano(), body)
	resp, err := http.Post(i.otlp+"/v1/logs", "application/json", strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("ingest status %d", resp.StatusCode)
	}
}

func (i *instance) waitLog(t *testing.T, marker string) {
	t.Helper()
	sql := fmt.Sprintf("SELECT Body FROM logs WHERE Timestamp > now() - INTERVAL 10 MINUTE AND ServiceName = 'local-detach-test' AND Body = '%s' LIMIT 1", marker)
	deadline := time.Now().Add(10 * time.Second)
	for !strings.Contains(i.Run("local", "query", sql, "--format", "ndjson").Success(t).Stdout, marker) {
		if time.Now().After(deadline) {
			t.Fatal("fresh test log not ingested")
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func (i *instance) assertStopped(t *testing.T) {
	t.Helper()
	i.Run("local", "status").Failure(t, 2)
	for _, origin := range []string{i.sql, i.otlp, i.ui} {
		if conn, err := net.Dial("tcp", strings.TrimPrefix(origin, "http://")); err == nil {
			conn.Close()
			t.Fatalf("%s is still listening", origin)
		}
	}
}

func uiCommand(t *testing.T, origin, command string) map[string]any {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, origin+"/api/commands/"+command, strings.NewReader("{}"))
	req.Header.Set("Origin", origin)
	req.Header.Set("X-Everr-Local", "1")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("%s: status %d", command, resp.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body
}

func TestDetachedAndForegroundInstancesShareTheFullLifecycle(t *testing.T) {
	i := newInstance(t)
	// Local commands must work even with an unusable remote session.
	config := filepath.Join(i.data, "remote-config")
	if err := os.MkdirAll(config, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(config, "session-dev.json"), []byte("invalid"), 0o600); err != nil {
		t.Fatal(err)
	}
	logDir := filepath.Join(i.data, "logs")
	if err := os.MkdirAll(logDir, 0o700); err != nil {
		t.Fatal(err)
	}
	// Force rotation from real supervisor output, without restarting it.
	seed := bytes.Repeat([]byte("x"), 5*1024*1024-64)
	if err := os.WriteFile(filepath.Join(logDir, "local.log"), seed, 0o600); err != nil {
		t.Fatal(err)
	}

	// The local UI reads timestamps as UTC, whatever the machine's zone.
	i.Setenv("TZ", "America/New_York")
	out := i.Run("local", "start", "-d", "--no-open").Success(t).Stdout
	endpoints := fmt.Sprintf("otlp: %s\nsql: %s\nui: %s\n", i.otlp, i.sql, i.ui)
	if want := endpoints + "log: " + filepath.Join(logDir, "local.log") + "\n"; out != want {
		t.Fatalf("start output = %q, want %q", out, want)
	}
	identity := i.identity(t)
	if out := i.Run("local", "start", "--detach", "--no-open").Success(t).Stdout; out != endpoints {
		t.Fatalf("second start output = %q", out)
	}
	if got := i.identity(t); got["instance_id"] != identity["instance_id"] {
		t.Fatalf("second start replaced the instance: %v", got)
	}

	if tz := i.Run("local", "query", "SELECT timezone() AS tz", "--format", "ndjson").Success(t).Stdout; tz != `{"tz":"UTC"}`+"\n" {
		t.Fatalf("chDB timezone = %q", tz)
	}

	marker := "detach-" + filepath.Base(i.data)
	i.sendLog(t, marker)
	i.waitLog(t, marker)
	if restarted := uiCommand(t, i.ui, "restart_collector"); restarted["status"] != "running" {
		t.Fatalf("restart status = %v", restarted)
	}
	if got := i.identity(t); got["instance_id"] != identity["instance_id"] {
		t.Fatalf("restart replaced the instance: %v", got)
	}
	i.waitLog(t, marker)

	assertContains(t, i.Run("local", "stop").Success(t).Stdout, "Everr stopped")
	i.assertStopped(t)
	archived, err := os.ReadFile(filepath.Join(logDir, "local.log.1"))
	if err != nil {
		t.Fatal(err)
	}
	if len(archived) != 5*1024*1024 || !bytes.HasPrefix(archived, seed) {
		t.Fatalf("archived log has %d bytes", len(archived))
	}
	current, err := os.ReadFile(filepath.Join(logDir, "local.log"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains(t, string(archived[len(seed):])+string(current), endpoints)
	assertContains(t, i.Run("local", "stop").Success(t).Stdout, "already stopped")

	foreground := i.Command("local", "start", "--no-open")
	if err := foreground.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = foreground.Process.Kill(); _ = foreground.Wait() })
	i.waitReady(t)
	if got := i.identity(t); got["instance_id"] == identity["instance_id"] {
		t.Fatal("foreground start reused the stopped instance's identity")
	}
	i.waitLog(t, marker)
	i.Run("local", "stop").Success(t)
	if err := foreground.Wait(); err != nil {
		t.Fatalf("foreground supervisor: %v", err)
	}
	i.assertStopped(t)
}

func TestUnavailableLogDirectoryDoesNotStartASupervisor(t *testing.T) {
	i := newInstance(t)
	blocker := filepath.Join(i.data, "not-a-directory")
	if err := os.WriteFile(blocker, []byte("blocked"), 0o644); err != nil {
		t.Fatal(err)
	}
	res := i.Setenv("EVERR_LOCAL_LOG_DIR", blocker).Run("local", "start", "-d", "--no-open").Failure(t, 1)
	assertContains(t, res.Stderr, "background process exited", "create local log directory")
	i.assertStopped(t)
}

func TestLocalStopWaitsForSlowSupervisorTelemetryBeforeImmediateRestart(t *testing.T) {
	i := newInstance(t)
	exporter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(2 * time.Second)
	}))
	defer exporter.Close()
	start := i.Command("local", "start", "-d", "--no-open")
	start.Env = append(start.Env, "EVERR_INTERNAL_TELEMETRY_ENDPOINT="+exporter.URL)
	RunCmd(t, start).Success(t)

	// A controlling terminal need not share the supervisor's directory overrides.
	control := t.TempDir()
	stop := i.Command("local", "stop")
	stop.Env = append(stop.Env,
		"EVERR_TELEMETRY_DIR="+filepath.Join(control, "data"),
		"EVERR_LOCAL_LOG_DIR="+filepath.Join(control, "logs"))
	assertContains(t, RunCmd(t, stop).Success(t).Stdout, "Everr stopped")

	lock, err := os.Open(filepath.Join(i.data, "logs", "local.log.lock"))
	if err != nil {
		t.Fatal(err)
	}
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		t.Fatalf("stop returned before releasing the supervisor's log lock: %v", err)
	}
	lock.Close()
	i.Run("local", "start", "-d", "--no-open").Success(t)
	i.Run("local", "stop").Success(t)
}

func TestLocalStopWaitsForCleanupEvenWhenTheListenersAreAlreadyClosed(t *testing.T) {
	i := newInstance(t)
	lock, err := os.Create(filepath.Join(i.data, "local.lock"))
	if err != nil {
		t.Fatal(err)
	}
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	released := make(chan time.Time, 1)
	go func() {
		time.Sleep(600 * time.Millisecond)
		released <- time.Now()
		lock.Close()
	}()
	i.Run("local", "stop").Success(t)
	select {
	case <-released:
	default:
		t.Fatal("stop returned before supervisor cleanup")
	}
}

func TestFailedDetachedStartCleansUpAndReportsItsLog(t *testing.T) {
	i := newInstance(t)
	blocker, err := net.Listen("tcp", strings.TrimPrefix(i.otlp, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	res := i.Run("local", "start", "-d", "--no-open").Failure(t, 1)
	assertContains(t, res.Stderr, "background process exited", "local.log", "is unavailable")
	if conn, err := net.Dial("tcp", strings.TrimPrefix(i.ui, "http://")); err == nil {
		conn.Close()
		t.Fatal("UI is still listening after a failed start")
	}
	log, err := os.ReadFile(filepath.Join(i.data, "logs", "local.log"))
	if err != nil {
		t.Fatal(err)
	}
	assertContains(t, string(log), "is unavailable")
	blocker.Close()

	if out := i.Run("local", "start", "-d", "--quiet").Success(t).Stdout; out != "" {
		t.Fatalf("quiet start printed %q", out)
	}
	i.Run("local", "stop").Success(t)
	i.assertStopped(t)
}
