package e2e

import (
	"fmt"
	"net"
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
	conn, err := net.Dial("tcp", strings.TrimPrefix(i.otlp, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	request := "POST /v1/logs HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n" + `{"resourceLogs":`
	if _, err := fmt.Fprint(conn, request); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
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
}

func TestSIGTERMStopsTheSupervisorWhileAnOTLPClientIsStalled(t *testing.T) {
	i := newInstance(t)
	foreground := i.Command("local", "start", "--no-open")
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
}
