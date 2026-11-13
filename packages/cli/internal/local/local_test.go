package local

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"testing/fstest"
	"time"

	"github.com/klauspost/compress/zstd"

	"github.com/everr-labs/everr/packages/cli/internal/build"
	"github.com/everr-labs/everr/packages/cli/internal/internaltelemetry"
)

func testServer(t *testing.T, telemetry *internaltelemetry.Config) string {
	t.Helper()
	origin, s := startingServer(t, telemetry)
	s.ready.Store(true)
	return origin
}

func startingServer(t *testing.T, telemetry *internaltelemetry.Config) (string, *server) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	origin := "http://" + ln.Addr().String()
	ui := fstest.MapFS{"index.html": {Data: []byte("<title>Everr Local</title>")}}
	s := newServer(origin, "test-instance", make(chan supervisorRequest), ui, telemetry)
	srv := &http.Server{Handler: s.handler()}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })
	return origin, s
}

func TestUIReportsStartingAndRefusesCommandsUntilReady(t *testing.T) {
	origin, s := startingServer(t, nil)
	if got := Probe(context.Background(), origin+"/health", uiService); got.State != StateStarting {
		t.Fatalf("state before ready = %v", got.State)
	}
	resp := post(t, origin, "/api/commands/get_collector_status", "{}", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("command before ready: status = %d", resp.StatusCode)
	}
	s.ready.Store(true)
	if got := Probe(context.Background(), origin+"/health", uiService); got.State != StateRunning {
		t.Fatalf("state after ready = %v", got.State)
	}
}

func TestCommandsFailOnceTheSupervisorHasStopped(t *testing.T) {
	origin, s := startingServer(t, nil)
	s.ready.Store(true)
	close(s.stopped)
	resp := post(t, origin, "/api/commands/restart_collector", "{}", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("restart after stop: status = %d", resp.StatusCode)
	}
}

func post(t *testing.T, origin, path, body string, headers map[string]string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, origin+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", origin)
	req.Header.Set("X-Everr-Local", "1")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func decode(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body
}

func TestStopRejectsAStaleInstanceID(t *testing.T) {
	origin := testServer(t, nil)
	resp := post(t, origin, "/api/commands/stop_local", `{"instance_id":"old-instance"}`, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if got := decode(t, resp)["error"]; got != "local instance changed; check status and retry" {
		t.Fatalf("error = %v", got)
	}
}

func TestTelemetryProxyUsesOnlyInternalDestinationAndCredentials(t *testing.T) {
	type export struct{ path, auth, origin, local, contentType, body string }
	exports := make(chan export, 3)
	exporter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		exports <- export{r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("Origin"), r.Header.Get("X-Everr-Local"), r.Header.Get("Content-Type"), string(body)}
	}))
	defer exporter.Close()
	origin := testServer(t, &internaltelemetry.Config{
		Endpoint: exporter.URL,
		Headers:  http.Header{"Authorization": {"Bearer internal-key"}, "Origin": {"https://ui.example"}},
	})
	for _, signal := range []string{"logs", "traces", "metrics"} {
		resp := post(t, origin, "/api/telemetry/"+signal, "otlp-test-body", map[string]string{"Authorization": "Bearer customer-key"})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("%s: status = %d", signal, resp.StatusCode)
		}
		want := export{"/v1/" + signal, "Bearer internal-key", "https://ui.example", "", "application/json", "otlp-test-body"}
		if got := <-exports; got != want {
			t.Fatalf("%s: forwarded %+v", signal, got)
		}
	}
	context := decode(t, post(t, origin, "/api/commands/get_telemetry_context", "{}", nil))
	if context["telemetryEnabled"] != true || context["deploymentEnvironment"] != internaltelemetry.DeploymentEnvironment() {
		t.Fatalf("context = %v", context)
	}
	if encoded, _ := json.Marshal(context); bytes.Contains(encoded, []byte("internal-key")) {
		t.Fatal("telemetry context exposes the ingest key")
	}
}

func TestDisabledTelemetryProxyDiscardsEventsAndInvalidSignals(t *testing.T) {
	origin := testServer(t, nil)
	for signal, want := range map[string]int{"logs": http.StatusNoContent, "invalid": http.StatusNotFound} {
		if got := post(t, origin, "/api/telemetry/"+signal, "otlp-body", nil).StatusCode; got != want {
			t.Fatalf("%s: status = %d, want %d", signal, got, want)
		}
	}
}

func TestTelemetryProxyDoesNotFollowRedirectsOrRetryFailedExports(t *testing.T) {
	var fallbackHits, exporterHits atomic.Int32
	fallback := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { fallbackHits.Add(1) }))
	defer fallback.Close()
	status := http.StatusFound
	exporter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		exporterHits.Add(1)
		w.Header().Set("Location", fallback.URL+"/v1/logs")
		w.WriteHeader(status)
	}))
	defer exporter.Close()
	origin := testServer(t, &internaltelemetry.Config{Endpoint: exporter.URL})
	for _, status = range []int{http.StatusFound, http.StatusServiceUnavailable} {
		if got := post(t, origin, "/api/telemetry/logs", "otlp-body", nil).StatusCode; got != http.StatusBadGateway {
			t.Fatalf("exporter %d: status = %d", status, got)
		}
	}
	if exporterHits.Load() != 2 || fallbackHits.Load() != 0 {
		t.Fatalf("exporter hits = %d, fallback hits = %d", exporterHits.Load(), fallbackHits.Load())
	}
}

func TestSQLCommandsRejectInvalidArgumentsWithJSONErrors(t *testing.T) {
	origin := testServer(t, nil)
	for _, args := range []string{`{}`, `{"sql":42}`, `{"sql":"SELECT 1","params":null}`, `{"sql":"SELECT 1","params":[]}`} {
		resp := post(t, origin, "/api/commands/telemetry_sql_query", args, nil)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: status = %d", args, resp.StatusCode)
		}
		body := decode(t, resp)
		if msg, _ := body["error"].(string); !strings.HasPrefix(msg, "invalid SQL arguments:") || len(body) != 1 {
			t.Fatalf("%s: body = %v", args, body)
		}
	}
}

func TestHealthIdentifiesUIWithoutRequiringBrowserHeaders(t *testing.T) {
	origin := testServer(t, nil)
	resp, err := http.Get(origin + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("status = %d, cache-control = %q", resp.StatusCode, resp.Header.Get("Cache-Control"))
	}
	service := Probe(context.Background(), origin+"/health", uiService)
	if service.State != StateRunning || service.Identity != uiIdentity("test-instance") {
		t.Fatalf("probe = %+v", service)
	}
}

func TestLocalCommandsRequireSameOriginAndCustomHeader(t *testing.T) {
	origin := testServer(t, nil)
	for _, c := range []struct {
		origin string
		header bool
	}{{"https://untrusted.example", true}, {origin, false}, {"null", true}} {
		req, _ := http.NewRequest(http.MethodPost, origin+"/api/commands/get_telemetry_context", strings.NewReader("{}"))
		req.Header.Set("Origin", c.origin)
		if c.header {
			req.Header.Set("X-Everr-Local", "1")
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%+v: status = %d", c, resp.StatusCode)
		}
	}
	resp := post(t, origin, "/api/commands/get_telemetry_context", "{}", nil)
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	want := map[string]any{"serviceVersion": build.Version(), "telemetryEnabled": false, "deploymentEnvironment": internaltelemetry.DeploymentEnvironment()}
	if got := decode(t, resp); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("context = %v", got)
	}
}

func TestRebindingHostsAndUnknownAPIRoutesAreRejected(t *testing.T) {
	origin := testServer(t, nil)
	req, _ := http.NewRequest(http.MethodGet, origin, nil)
	req.Host = "untrusted.example"
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("rebinding host: status = %d", resp.StatusCode)
	}
	req, _ = http.NewRequest(http.MethodGet, origin+"/api/missing", nil)
	req.Header.Set("Origin", origin)
	req.Header.Set("X-Everr-Local", "1")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown API route: status = %d", resp.StatusCode)
	}
}

func TestDirectBrowserRoutesServeShellAndMissingAssetsReturn404(t *testing.T) {
	origin := testServer(t, nil)
	resp, err := http.Get(origin + "/traces/0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") || !strings.Contains(string(body), "Everr Local") {
		t.Fatalf("route: status = %d, type = %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	if resp, err = http.Get(origin + "/assets/missing.js"); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing asset: status = %d", resp.StatusCode)
	}
}

func identityServer(t *testing.T, status int, body string) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", "/elsewhere")
		w.WriteHeader(status)
		fmt.Fprint(w, body)
	}))
	t.Cleanup(server.Close)
	return server.URL + "/health"
}

func TestInvalidIdentityOrReadinessIsNotRecognized(t *testing.T) {
	valid := map[string]any{"service": collectorService, "version": "0.8.2", "instance_id": "one", "protocol_version": 1, "status": "ok"}
	for _, c := range []struct {
		field  string
		value  any
		status int
	}{
		{"service", "other-service", 200},
		{"version", "", 200},
		{"instance_id", "", 200},
		{"protocol_version", 2, 200},
		{"status", "starting", 200},
		{"status", "ok", 503},
		{"status", nil, 200},
	} {
		identity := map[string]any{}
		for k, v := range valid {
			identity[k] = v
		}
		if c.value == nil {
			delete(identity, c.field)
		} else {
			identity[c.field] = c.value
		}
		body, _ := json.Marshal(identity)
		if got := Probe(context.Background(), identityServer(t, c.status, string(body)), collectorService); got.State != StateOccupied {
			t.Fatalf("accepted invalid %s=%v: %+v", c.field, c.value, got)
		}
	}
}

func TestHealthStatusMapsToServiceState(t *testing.T) {
	for _, c := range []struct {
		status string
		code   int
		want   ServiceState
	}{
		{"ok", 200, StateRunning},
		{"starting", 503, StateStarting},
		{"stopped", 503, StateStopped},
	} {
		body := fmt.Sprintf(`{"service":%q,"version":"0.8.2","instance_id":"one","protocol_version":1,"status":%q}`, collectorService, c.status)
		if got := Probe(context.Background(), identityServer(t, c.code, body), collectorService); got.State != c.want {
			t.Fatalf("%s: state = %v, want %v", c.status, got.State, c.want)
		}
	}
}

func TestRedirectAndOversizedResponseAreNotRecognized(t *testing.T) {
	for _, c := range []struct {
		status int
		body   string
	}{{http.StatusFound, ""}, {http.StatusOK, strings.Repeat("x", maxHealthBody+1)}} {
		if got := Probe(context.Background(), identityServer(t, c.status, c.body), collectorService); got.State != StateOccupied {
			t.Fatalf("status %d: %+v", c.status, got)
		}
	}
}

func TestStartupReadinessRequiresTheSpawnedInstance(t *testing.T) {
	body, _ := json.Marshal(map[string]any{"service": collectorService, "version": "0.8.2", "instance_id": "existing", "protocol_version": 1, "status": "ok"})
	if waitForCollector(context.Background(), identityServer(t, 200, string(body)), "new", 150*time.Millisecond) {
		t.Fatal("accepted a different instance as ready")
	}
}

func TestSilentListenerIsUnreachableInsteadOfStopped(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		if conn, err := ln.Accept(); err == nil {
			time.Sleep(2 * time.Second)
			conn.Close()
		}
	}()
	if got := Probe(context.Background(), "http://"+ln.Addr().String()+"/health", collectorService); got.State != StateUnreachable {
		t.Fatalf("probe = %+v", got)
	}
}

func TestPermissionDeniedConnectionMentionsSandboxNetworkAccess(t *testing.T) {
	err := fmt.Errorf("POST http://127.0.0.1/sql: %w", &net.OpError{Op: "dial", Err: os.NewSyscallError("connect", syscall.EPERM)})
	if !isConnectError(err) || connectionFailureMessage(err) != networkBlockedMessage {
		t.Fatalf("message = %q", connectionFailureMessage(err))
	}
	refused := &net.OpError{Op: "dial", Err: os.NewSyscallError("connect", syscall.ECONNREFUSED)}
	if connectionFailureMessage(refused) != collectorUnavailableMessage {
		t.Fatal("refused connection should mention starting the collector")
	}
}

func ready() Status {
	identity := Identity{Service: collectorService, Version: "0.8.2", InstanceID: "one", ProtocolVersion: 1, Status: "ok"}
	ui := identity
	ui.Service = uiService
	return Status{Collector: Service{StateRunning, identity}, UI: Service{StateRunning, ui}}
}

func TestOpensReadyUIOnceAtTheConfiguredOrigin(t *testing.T) {
	var opened []string
	ok, err := openUI(ready(), "http://127.0.0.1:1", func(url string) error {
		opened = append(opened, url)
		return nil
	})
	if !ok || err != nil || len(opened) != 1 || opened[0] != "http://127.0.0.1:1" {
		t.Fatalf("ok = %v, err = %v, opened = %v", ok, err, opened)
	}
}

func TestUnavailableInstancesDoNotOpenTheBrowser(t *testing.T) {
	mismatched := ready()
	mismatched.UI.Identity.InstanceID = "two"
	for _, status := range []Status{{}, {Collector: ready().Collector}, mismatched} {
		ok, err := openUI(status, "http://127.0.0.1:1", func(string) error {
			t.Fatal("opened the browser")
			return nil
		})
		if ok || err != nil {
			t.Fatalf("ok = %v, err = %v", ok, err)
		}
	}
}

func TestBrowserFailureIncludesTheManualURLAndCause(t *testing.T) {
	_, err := openUI(ready(), "http://127.0.0.1:1", func(string) error { return errors.New("no browser") })
	if err == nil || !strings.Contains(err.Error(), "Open this URL manually: http://127.0.0.1:1") || !strings.Contains(err.Error(), "no browser") {
		t.Fatalf("err = %v", err)
	}
}

func TestDataLockExcludesAnotherOwnerAndCanBeReusedAfterExit(t *testing.T) {
	dir := t.TempDir()
	first, err := lockTelemetryDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lockTelemetryDir(dir); err == nil {
		t.Fatal("second owner acquired the lock")
	}
	first.Close()
	second, err := lockTelemetryDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	second.Close()
}

func TestLogDefaultsFollowPlatformConventionsAndIgnoreRelativeXDGPaths(t *testing.T) {
	home := "/home/test"
	app := filepath.Base(defaultLogDir(home, "", true))
	if got := defaultLogDir(home, "", true); got != filepath.Join(home, "Library/Logs", app) {
		t.Fatalf("macos = %q", got)
	}
	if got := defaultLogDir(home, "", false); got != filepath.Join(home, ".local/state", app) {
		t.Fatalf("linux = %q", got)
	}
	if defaultLogDir(home, "relative", false) != defaultLogDir(home, "", false) {
		t.Fatal("relative XDG_STATE_HOME was used")
	}
	if got := defaultLogDir(home, "/state", false); got != filepath.Join("/state", app) {
		t.Fatalf("XDG_STATE_HOME = %q", got)
	}
}

func TestRotationBoundsStoragePreservesOrderAndExcludesCompetingWriters(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "local.log")
	log, err := openRotatingLog(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := openRotatingLog(path); err == nil {
		t.Fatal("second writer opened the log")
	}
	for b := byte('a'); b <= 'f'; b++ {
		if _, err := log.Write(bytes.Repeat([]byte{b}, maxLogBytes)); err != nil {
			t.Fatal(err)
		}
	}
	log.Write([]byte("latest"))
	if got, _ := os.ReadFile(path); string(got) != "latest" {
		t.Fatalf("current log = %q", got)
	}
	for index, b := range []byte("fed") {
		got, _ := os.ReadFile(fmt.Sprintf("%s.%d", path, index+1))
		if !bytes.Equal(got, bytes.Repeat([]byte{b}, maxLogBytes)) {
			t.Fatalf("backup %d is wrong", index+1)
		}
	}
	if entries, _ := os.ReadDir(dir); len(entries) != logBackups+2 {
		t.Fatalf("%d files in the log directory", len(entries))
	}
	log.Close()
	if log, err = openRotatingLog(path); err != nil {
		t.Fatal(err)
	}
	log.Write([]byte(" again"))
	log.Close()
	if tail, _ := logTail(path); tail != "latest again" {
		t.Fatalf("tail = %q", tail)
	}
}

func TestOversizedExistingLogKeepsRecentOutputAndNewLogsArePrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "logs", "local.log")
	log, err := openRotatingLog(path)
	if err != nil {
		t.Fatal(err)
	}
	for file, want := range map[string]os.FileMode{filepath.Dir(path): 0o700, path: 0o600} {
		if info, _ := os.Stat(file); info.Mode().Perm() != want {
			t.Fatalf("%s mode = %v", file, info.Mode().Perm())
		}
	}
	log.Close()
	if err := os.WriteFile(path, append(bytes.Repeat([]byte("x"), maxLogBytes+100), "recent"...), 0o600); err != nil {
		t.Fatal(err)
	}
	if log, err = openRotatingLog(path); err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	if info, _ := os.Stat(path); info.Size() != maxLogBytes {
		t.Fatalf("size = %d", info.Size())
	}
	if tail, _ := logTail(path); !strings.HasSuffix(tail, "recent") {
		t.Fatal("recent output was dropped")
	}
	log.Write([]byte("new output"))
	if info, _ := os.Stat(path + ".1"); info.Size() != maxLogBytes {
		t.Fatalf("backup size = %d", info.Size())
	}
	if got, _ := os.ReadFile(path); string(got) != "new output" {
		t.Fatalf("current log = %q", got)
	}
}

func compressed(t *testing.T, data string) []byte {
	t.Helper()
	encoder, err := zstd.NewWriter(nil)
	if err != nil {
		t.Fatal(err)
	}
	defer encoder.Close()
	return encoder.EncodeAll([]byte(data), nil)
}

// extract unpacks data and releases the library at once, as a process that
// already exited would.
func extract(t *testing.T, root, data, digest string) string {
	t.Helper()
	library, inUse, err := extractToCache(root, compressed(t, data), digest)
	if err != nil {
		t.Fatal(err)
	}
	inUse.Close()
	return library
}

func TestExtractionWritesTheLibraryToADigestNamedCacheAndPrunesOthers(t *testing.T) {
	root := t.TempDir()
	first := extract(t, root, "one", "aaa")
	if got, _ := os.ReadFile(first); string(got) != "one" {
		t.Fatalf("library = %q", got)
	}
	second := extract(t, root, "two", "bbb")
	if _, err := os.Stat(filepath.Dir(first)); !os.IsNotExist(err) {
		t.Fatal("stale library was not pruned")
	}
	if got, _ := os.ReadFile(second); string(got) != "two" {
		t.Fatalf("library = %q", got)
	}
}

func TestALibraryInUseIsNotPruned(t *testing.T) {
	root := t.TempDir()
	first, inUse, err := extractToCache(root, compressed(t, "one"), "aaa")
	if err != nil {
		t.Fatal(err)
	}
	defer inUse.Close()
	extract(t, root, "two", "bbb")
	if got, _ := os.ReadFile(first); string(got) != "one" {
		t.Fatalf("library in use = %q", got)
	}
}

func TestCacheHitRepairsLibraryPermissions(t *testing.T) {
	root := t.TempDir()
	library := extract(t, root, "lib", "aaa")
	os.Chmod(library, 0o600)
	extract(t, root, "lib", "aaa")
	if info, _ := os.Stat(library); info.Mode().Perm() != 0o644 {
		t.Fatalf("mode = %v", info.Mode().Perm())
	}
}

func TestExtractionRedoesATruncatedLibraryAndDropsLeftoverTempFiles(t *testing.T) {
	root := t.TempDir()
	library := extract(t, root, "complete library", "aaa")
	os.WriteFile(library, []byte("cut"), 0o644)
	leftover := library + ".999.tmp"
	os.WriteFile(leftover, []byte("partial"), 0o644)

	extract(t, root, "complete library", "aaa")
	if got, _ := os.ReadFile(library); string(got) != "complete library" {
		t.Fatalf("library = %q", got)
	}
	if _, err := os.Stat(leftover); !os.IsNotExist(err) {
		t.Fatal("leftover temp file was kept")
	}
}

type flakyWriter struct {
	failures int
	written  strings.Builder
}

func (w *flakyWriter) Write(p []byte) (int, error) {
	if w.failures > 0 {
		w.failures--
		return 0, errors.New("no space left on device")
	}
	return w.written.Write(p)
}

func TestLogCopyResumesAfterAFailedWrite(t *testing.T) {
	reader, writer := io.Pipe()
	log := &flakyWriter{failures: 1}
	done := make(chan error, 1)
	go func() { done <- copyLossy(log, reader) }()
	writer.Write([]byte("lost "))
	writer.Write([]byte("kept"))
	writer.Close()
	if err := <-done; err == nil {
		t.Fatal("the failed write was not reported")
	}
	if got := log.written.String(); got != "kept" {
		t.Fatalf("log = %q", got)
	}
}
