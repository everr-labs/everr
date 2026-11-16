package e2e

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestUninstallWipesTheSessionAndChDBCacheAndExplainsHowToRemoveTheBinary(t *testing.T) {
	env := NewEnv(t)
	env.WriteSession("https://app.example", "token")
	cacheDir := filepath.Join(env.HomeDir, ".cache")
	if runtime.GOOS == "darwin" {
		cacheDir = filepath.Join(env.HomeDir, "Library", "Caches")
	}
	library := filepath.Join(cacheDir, "everr", "chdb-library", "digest", "libchdb.so")
	if err := os.MkdirAll(filepath.Dir(library), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(library, []byte("lib"), 0o644); err != nil {
		t.Fatal(err)
	}
	// What the Rust CLI extracted before.
	legacy := filepath.Join(cacheDir, "everr", "collector-assets", "digest", "libchdb.so")
	if err := os.MkdirAll(filepath.Dir(legacy), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte("lib"), 0o644); err != nil {
		t.Fatal(err)
	}
	cmd := env.Command("uninstall")
	cmd.Stdin = strings.NewReader("\n")
	res := RunCmd(t, cmd).Success(t)
	assertContains(t, res.Stdout, "Press Enter to continue", "To remove the CLI binary, run:", "rm \"")
	if _, err := os.Stat(env.SessionPath()); !os.IsNotExist(err) {
		t.Fatalf("session file still exists: %v", err)
	}
	for _, path := range []string{library, legacy} {
		if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
			t.Fatalf("extracted chDB library %s still exists: %v", path, err)
		}
	}
}
