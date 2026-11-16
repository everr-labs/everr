package local

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const crashHelperEnv = "EVERR_TEST_CRASH_AFTER_LOG_CAPTURE"

func TestAPanicInTheCapturedProcessReachesTheLog(t *testing.T) {
	if os.Getenv(crashHelperEnv) != "" {
		if _, _, err := StartLogCapture(); err != nil {
			os.Exit(1)
		}
		panic("supervisor crashed")
	}
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPanicInTheCapturedProcessReachesTheLog$")
	cmd.Env = append(os.Environ(),
		crashHelperEnv+"=1",
		backgroundInstanceIDEnv+"=test",
		"EVERR_LOCAL_LOG_DIR="+dir,
	)
	var exit *exec.ExitError
	if err := cmd.Run(); !errors.As(err, &exit) || exit.ExitCode() != 2 {
		t.Fatalf("crashing process: %v", err)
	}
	log, err := os.ReadFile(filepath.Join(dir, "local.log"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(log), "panic: supervisor crashed") {
		t.Fatalf("local.log = %q", log)
	}
}
