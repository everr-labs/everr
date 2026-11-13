package e2e

import (
	"bufio"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// otlpServer accepts OTLP/HTTP exports and keeps every request body.
type otlpServer struct {
	*httptest.Server
	mu     sync.Mutex
	bodies []string
}

const otlpProbeBody = `{"resourceLogs":[]}`

func newOTLPServer(t *testing.T, nonProbeDelay time.Duration) *otlpServer {
	t.Helper()
	server := &otlpServer{}
	server.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if strings.TrimSpace(string(body)) != otlpProbeBody {
			time.Sleep(nonProbeDelay)
		}
		server.mu.Lock()
		server.bodies = append(server.bodies, string(body))
		server.mu.Unlock()
		_, _ = w.Write([]byte("{}"))
	}))
	t.Cleanup(server.Close)
	return server
}

// bodiesUntil waits up to 2s for ready, then returns what arrived.
func (s *otlpServer) bodiesUntil(ready func([]string) bool) []string {
	deadline := time.Now().Add(2 * time.Second)
	for {
		s.mu.Lock()
		bodies := append([]string(nil), s.bodies...)
		s.mu.Unlock()
		if ready(bodies) || time.Now().After(deadline) {
			return bodies
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func anyBody(bodies []string, wants ...string) bool {
	for _, body := range bodies {
		if containsAll(body, wants...) {
			return true
		}
	}
	return false
}

func containsAll(s string, wants ...string) bool {
	for _, want := range wants {
		if !strings.Contains(s, want) {
			return false
		}
	}
	return true
}

func hasCLICommandBody(bodies []string) bool { return anyBody(bodies, "everr.cli.command") }

func cliCommandBody(t *testing.T, bodies []string) string {
	t.Helper()
	for _, body := range bodies {
		if strings.Contains(body, "everr.cli.command") {
			return body
		}
	}
	t.Fatalf("expected CLI command telemetry payload, got: %q", bodies)
	return ""
}

func collectorEnv(t *testing.T, origin string) *Env {
	return NewEnv(t).Setenv("EVERR_OTLP_HTTP_ORIGIN", origin)
}

func TestWrapPreservesOutputAndSendsLogsToCollector(t *testing.T) {
	collector := newOTLPServer(t, 0)
	res := collectorEnv(t, collector.URL).
		Run("wrap", "--", "sh", "-c", "printf 'hello stdout\\n'; printf 'hello stderr\\n' >&2").
		Success(t)
	if res.Stdout != "hello stdout\n" || res.Stderr != "hello stderr\n" {
		t.Fatalf("stdout %q, stderr %q", res.Stdout, res.Stderr)
	}

	bodies := collector.bodiesUntil(func(bodies []string) bool {
		return anyBody(bodies, "hello stdout") && anyBody(bodies, "hello stderr") &&
			anyBody(bodies, `"service.name"`, "everr-wrap-sh")
	})
	for _, wants := range [][]string{
		{"hello stdout"},
		{"hello stderr"},
		{`"everr.wrap.stream"`, "stdout"},
		{`"everr.wrap.stream"`, "stderr"},
		{`"service.name"`, "everr-wrap-sh"},
	} {
		if !anyBody(bodies, wants...) {
			t.Errorf("no OTLP payload contains %q: %q", wants, bodies)
		}
	}
	for _, body := range bodies {
		if strings.Contains(body, `"everr.wrap.stream"`) {
			assertNotContains(t, body, `"service.version"`, `"deployment.environment"`)
		}
	}
}

func TestWrapPassesFlagsThroughWithoutSeparator(t *testing.T) {
	collector := newOTLPServer(t, 0)
	res := collectorEnv(t, collector.URL).Run("wrap", "sh", "-c", "printf '%s\\n' \"$0\" \"$1\"", "--foo", "-x").Success(t)
	if res.Stdout != "--foo\n-x\n" {
		t.Fatalf("stdout = %q", res.Stdout)
	}
}

func TestCLICommandTelemetryRecordsCommandShapeWithoutOptionValues(t *testing.T) {
	collector := newOTLPServer(t, 0)
	collectorEnv(t, collector.URL).Run("skills", "list", "--global", "--agent", "codex").Success(t)

	body := cliCommandBody(t, collector.bodiesUntil(hasCLICommandBody))
	assertContains(t, body, "everr-cli", "service.version", "everr.cli.command", "skills",
		"everr.cli.subcommand", "list", "everr.cli.options", "agent", "global", "os.type", runtime.GOOS)
	assertNotContains(t, body, "codex")
}

func TestCLICommandTelemetryDoesNotRecordWrappedCommand(t *testing.T) {
	collector := newOTLPServer(t, 0)
	res := collectorEnv(t, collector.URL).Run("wrap", "--", "sh", "-c", "printf 'secret\\n'").Success(t)
	if res.Stdout != "secret\n" {
		t.Fatalf("stdout = %q", res.Stdout)
	}

	body := cliCommandBody(t, collector.bodiesUntil(hasCLICommandBody))
	assertContains(t, body, "everr.cli.command", "wrap")
	assertNotContains(t, body, "sh", "printf", "secret")
}

func TestWrapForwardsPartialOutputBeforeNewline(t *testing.T) {
	collector := newOTLPServer(t, 0)
	cmd := collectorEnv(t, collector.URL).Command("wrap", "--", "sh", "-c", "printf partial; sleep 3; printf ' done\\n'")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill() })

	first := make(chan string, 1)
	rest := make(chan string, 1)
	go func() {
		buf := make([]byte, len("partial"))
		_, _ = io.ReadFull(stdout, buf)
		first <- string(buf)
		remaining, _ := io.ReadAll(stdout)
		rest <- string(remaining)
	}()
	select {
	case got := <-first:
		if got != "partial" {
			t.Fatalf("first output = %q", got)
		}
	case <-time.After(1500 * time.Millisecond):
		t.Fatal("partial output was not forwarded before newline")
	}
	if got := <-rest; got != " done\n" {
		t.Fatalf("rest = %q", got)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatalf("wrap failed: %v", err)
	}
}

func TestWrapPreservesWrappedCommandExitCode(t *testing.T) {
	collector := newOTLPServer(t, 0)
	res := collectorEnv(t, collector.URL).Run("wrap", "--", "sh", "-c", "printf 'before fail\\n'; exit 7").Failure(t, 7)
	if res.Stdout != "before fail\n" {
		t.Fatalf("stdout = %q", res.Stdout)
	}
	body := cliCommandBody(t, collector.bodiesUntil(hasCLICommandBody))
	assertContains(t, body, "everr.cli.command", "wrap")
}

func TestWrapRelaysInterruptSentToItAlone(t *testing.T) {
	collector := newOTLPServer(t, 0)
	cmd := collectorEnv(t, collector.URL).Command("wrap", "--", "sh", "-c",
		`trap 'exit 42' INT; echo ready; while :; do sleep 0.1; done`)
	// Without a controlling terminal, nothing else delivers the signal to the
	// wrapped command's process group.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	if _, err := bufio.NewReader(stdout).ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Process.Signal(syscall.SIGINT); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
		if code := cmd.ProcessState.ExitCode(); code != 42 {
			t.Fatalf("exit code = %d, want the child's 42", code)
		}
	case <-time.After(5 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("the wrapped command never received the interrupt")
	}
}

func TestWrapDeliversAGroupInterruptToTheChildOnce(t *testing.T) {
	collector := newOTLPServer(t, 0)
	// The child counts the interrupts it gets for two seconds, then exits
	// with that count.
	cmd := collectorEnv(t, collector.URL).Command("wrap", "--", "perl", "-e",
		`$n = 0; $SIG{INT} = sub { $n++ }; $| = 1; print "ready\n"; select(undef, undef, undef, 0.1) for 1 .. 20; exit $n`)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	if _, err := bufio.NewReader(stdout).ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	// Like a CI runner or `timeout -s INT`, signal wrap's whole group.
	if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGINT); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	if code := cmd.ProcessState.ExitCode(); code != 1 {
		t.Fatalf("child received %d interrupts, want 1", code)
	}
}

func TestWrapRefusesToRunWhenCollectorIsUnavailable(t *testing.T) {
	res := collectorEnv(t, "http://127.0.0.1:9").Run("wrap", "--", "sh", "-c", "printf 'should not run\\n'").Failure(t, 2)
	if res.Stdout != "" {
		t.Fatalf("stdout = %q", res.Stdout)
	}
	assertContains(t, res.Stderr, "telemetry collector isn't running")
}

func TestWrapExitsWhenStdoutConsumerClosesPipe(t *testing.T) {
	collector := newOTLPServer(t, 0)
	cmd := collectorEnv(t, collector.URL).Command("wrap", "--", "sh", "-c",
		"i=0; while [ $i -lt 200000 ]; do echo y; i=$((i + 1)); done")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	if _, err := bufio.NewReader(stdout).ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	_ = stdout.Close()

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("wrap should report the closed output pipe")
		}
	case <-time.After(3 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("wrap should exit after stdout pipe closes")
	}
	assertNotContains(t, stderr.String(), "stdout forwarding", "broken pipe", "Broken pipe")
}

func TestSlowCollectorDoesNotThrottleWrappedOutput(t *testing.T) {
	collector := newOTLPServer(t, 300*time.Millisecond)
	cmd := collectorEnv(t, collector.URL).Command("wrap", "--", "sh", "-c",
		"i=0; while [ $i -lt 2000 ]; do echo line-$i; i=$((i + 1)); done")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("wrapped command failed: %v", err)
		}
	case <-time.After(3 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("wrap waited for collector queue space while reading output")
	}
}

func TestWrapHelpDescribesCommandCapture(t *testing.T) {
	out := NewEnv(t).Run("wrap", "--help").Success(t).Stdout
	assertContains(t, out, "<COMMAND>", "capture its output as local logs")
}
