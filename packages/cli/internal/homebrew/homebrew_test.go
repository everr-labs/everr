package homebrew

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInCellarFollowsTheLinkedBinary(t *testing.T) {
	prefix := t.TempDir()
	keg := filepath.Join(prefix, "Cellar", "everr", "0.12.0", "bin", "everr")
	if err := os.MkdirAll(filepath.Dir(keg), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keg, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	linked := filepath.Join(prefix, "bin", "everr")
	if err := os.MkdirAll(filepath.Dir(linked), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(keg, linked); err != nil {
		t.Fatal(err)
	}

	if !InCellar(linked) {
		t.Errorf("InCellar(%q) = false for a binary linked from the Cellar", linked)
	}
	if InCellar(filepath.Join(t.TempDir(), ".local", "bin", "everr")) {
		t.Error("InCellar reported a script install as Homebrew")
	}
}
