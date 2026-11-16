package e2e

import (
	"bytes"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

const shutdownBound = 5 * time.Second

// stallOTLPRequest opens a POST that promises 1000 body bytes, sends 16 and
// holds the connection open.
func (i *instance) stallOTLPRequest(t *testing.T) {
	t.Helper()
	i.stallOTLPRequests(t, 1)
}

// stallOTLPRequests opens n such requests, each in its own connection.
func (i *instance) stallOTLPRequests(t *testing.T, n int) {
	t.Helper()
	request := "POST /v1/logs HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n" + `{"resourceLogs":`
	for range n {
		conn, err := net.Dial("tcp", strings.TrimPrefix(i.otlp, "http://"))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.Close() })
		if _, err := fmt.Fprint(conn, request); err != nil {
			t.Fatal(err)
		}
	}
	time.Sleep(300 * time.Millisecond)
}

// assertPipelineDrained fails when shutdown gave up waiting for the
// collector pipeline, which exits without closing chDB.
func assertPipelineDrained(t *testing.T, output string) {
	t.Helper()
	if strings.Contains(output, "did not stop in time") {
		t.Fatalf("shutdown abandoned the collector pipeline:\n%s", output)
	}
}

func TestStopFinishesWhileAnOTLPClientIsStalled(t *testing.T) {
	i := newInstance(t)
	i.Run("local", "start", "-d", "--no-open").Success(t)
	i.waitReady(t)
	i.stallOTLPRequest(t)

	began := time.Now()
	i.Run("local", "stop").Success(t)
	if took := time.Since(began); took > shutdownBound {
		t.Fatalf("stop took %s, want under %s", took, shutdownBound)
	}
	i.assertStopped(t)
	log, err := os.ReadFile(filepath.Join(i.data, "logs", "local.log"))
	if err != nil {
		t.Fatal(err)
	}
	assertPipelineDrained(t, string(log))
}

func TestSIGTERMStopsTheSupervisorWhileAnOTLPClientIsStalled(t *testing.T) {
	i := newInstance(t)
	foreground := i.Command("local", "start", "--no-open")
	var stderr bytes.Buffer
	foreground.Stderr = &stderr
	if err := foreground.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- foreground.Wait() }()
	t.Cleanup(func() { _ = foreground.Process.Kill() })
	i.waitReady(t)
	i.stallOTLPRequest(t)

	if err := foreground.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case <-exited:
	case <-time.After(shutdownBound):
		t.Fatalf("supervisor still running %s after SIGTERM", shutdownBound)
	}
	i.assertStopped(t)
	assertPipelineDrained(t, stderr.String())
}

// A fault in Go code must crash the supervisor. If chDB's fault handlers
// replace Go's, the process freezes instead.
func TestSIGSEGVCrashesTheSupervisorOnceChDBRuns(t *testing.T) {
	i := newInstance(t)
	foreground := i.Command("local", "start", "--no-open")
	if err := foreground.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- foreground.Wait() }()
	t.Cleanup(func() { _ = foreground.Process.Kill() })
	i.waitReady(t)

	if err := foreground.Process.Signal(syscall.SIGSEGV); err != nil {
		t.Fatal(err)
	}
	select {
	case <-exited:
	case <-time.After(shutdownBound):
		t.Fatalf("supervisor still running %s after SIGSEGV", shutdownBound)
	}
	i.assertStopped(t)
}
