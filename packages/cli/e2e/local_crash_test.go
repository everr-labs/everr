package e2e

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// supervisorPIDs lists the processes holding the instance's log lock, which
// only a running supervisor does.
func (i *instance) supervisorPIDs(t *testing.T) []int {
	t.Helper()
	out, err := exec.Command("lsof", "-t", "--", filepath.Join(i.data, "logs", "local.log.lock")).Output()
	var exit *exec.ExitError
	if err != nil && !(errors.As(err, &exit) && exit.ExitCode() == 1) {
		t.Fatalf("lsof: %v", err)
	}
	var pids []int
	for _, field := range strings.Fields(string(out)) {
		pid, err := strconv.Atoi(field)
		if err != nil {
			t.Fatalf("lsof printed %q", field)
		}
		pids = append(pids, pid)
	}
	return pids
}

func TestSIGQUITStopsTheDetachedSupervisorAndLeavesTheGoroutineDumpInTheLog(t *testing.T) {
	if _, err := exec.LookPath("lsof"); err != nil {
		t.Skip("lsof not installed")
	}
	i := newInstance(t)
	i.Run("local", "start", "-d", "--no-open").Success(t)
	i.waitReady(t)
	// Open requests add goroutines, which makes the dump large.
	i.stallOTLPRequests(t, 50)
	pids := i.supervisorPIDs(t)
	if len(pids) != 1 {
		t.Fatalf("supervisor pids = %v", pids)
	}
	t.Cleanup(func() { _ = syscall.Kill(pids[0], syscall.SIGKILL) })

	if err := syscall.Kill(pids[0], syscall.SIGQUIT); err != nil {
		t.Fatal(err)
	}
	logPath := filepath.Join(i.data, "logs", "local.log")
	deadline := time.Now().Add(shutdownBound)
	for len(i.supervisorPIDs(t)) > 0 {
		if time.Now().After(deadline) {
			log, _ := os.ReadFile(logPath)
			t.Fatalf("supervisor still running %s after SIGQUIT; local.log has %d bytes", shutdownBound, len(log))
		}
		time.Sleep(50 * time.Millisecond)
	}
	log, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	assertContains(t, string(log), "SIGQUIT", "goroutine ")
	i.assertStopped(t)
}
