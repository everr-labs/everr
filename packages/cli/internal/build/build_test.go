package build

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestDirsFallBackToThePasswdHomeWithoutHOME(t *testing.T) {
	out, err := exec.Command("sh", "-c", `eval echo ~"$(id -un)"`).Output()
	if err != nil {
		t.Fatal(err)
	}
	passwdHome := strings.TrimSpace(string(out))
	t.Setenv("HOME", "")
	os.Unsetenv("HOME")
	t.Setenv("XDG_CONFIG_HOME", "")
	t.Setenv("XDG_CACHE_HOME", "")

	config, err := PlatformDir("XDG_CONFIG_HOME", ".config")
	if err != nil {
		t.Fatalf("config dir: %v", err)
	}
	cache, err := CacheDir()
	if err != nil {
		t.Fatalf("cache dir: %v", err)
	}
	for _, dir := range []string{config, cache} {
		if !strings.HasPrefix(dir, passwdHome+string(filepath.Separator)) {
			t.Errorf("%s is not under the passwd home %s", dir, passwdHome)
		}
	}
}
