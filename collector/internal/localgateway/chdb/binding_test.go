package chdb

import (
	"context"
	"os"
	"os/exec"
	"testing"
	"time"
)

// The fault runs in a child process so that a frozen process fails the test
// instead of hanging the package.
func TestNilDereferencePanicsAfterOpen(t *testing.T) {
	if os.Getenv(LibraryPathEnv) == "" {
		t.Skip(LibraryPathEnv + " not set")
	}
	if dir := os.Getenv("CHDB_FAULT_TEST_DIR"); dir != "" {
		handle, err := Open(dir)
		if err != nil {
			t.Fatal(err)
		}
		defer handle.Close()
		defer func() {
			if recover() == nil {
				t.Error("nil dereference did not panic")
			}
		}()
		var p *int
		_ = *p
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestNilDereferencePanicsAfterOpen$")
	child.Env = append(os.Environ(), "CHDB_FAULT_TEST_DIR="+t.TempDir())
	if out, err := child.CombinedOutput(); err != nil {
		t.Fatalf("child: %v\n%s", err, out)
	}
}
