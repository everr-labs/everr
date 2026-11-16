//go:build unix

package e2e

import (
	"bytes"
	"io"
	"syscall"
	"testing"
	"time"

	"github.com/creack/pty"
)

// A terminal that never answers must not stall startup or receive escape
// queries: agent tools and `docker run -t` give everr exactly this.
func TestStartupSendsNoTerminalQueryToSilentPty(t *testing.T) {
	master, slave, err := pty.Open()
	if err != nil {
		t.Skipf("no pty: %v", err)
	}
	defer master.Close()

	cmd := NewEnv(t).Command("--version")
	cmd.Env = append(cmd.Env, "TERM=xterm-256color")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = slave, slave, slave
	started := time.Now()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	slave.Close()

	var out bytes.Buffer
	copied := make(chan struct{})
	go func() {
		_, _ = io.Copy(&out, master)
		close(copied)
	}()

	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	select {
	case <-exited:
	case <-time.After(2 * time.Second):
		_ = cmd.Process.Kill()
		<-exited
		t.Fatalf("everr --version did not exit within 2s (output %q)", out.String())
	}
	t.Logf("exited after %s", time.Since(started))
	select {
	case <-copied:
	case <-time.After(time.Second):
	}
	if bytes.IndexByte(out.Bytes(), 0x1b) >= 0 {
		t.Fatalf("output contains an escape byte: %q", out.String())
	}
}
