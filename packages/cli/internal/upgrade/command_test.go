package upgrade

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVerifySHA256AcceptsShasumOutput(t *testing.T) {
	binary := []byte("binary")
	sum := sha256.Sum256(binary)
	digest := hex.EncodeToString(sum[:])
	if err := verifySHA256(binary, []byte(strings.ToUpper(digest)+"  everr\n")); err != nil {
		t.Fatal(err)
	}
	if err := verifySHA256([]byte("tampered"), []byte(digest+"  everr\n")); err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("tampered binary: %v", err)
	}
	if err := verifySHA256(binary, []byte("  \n")); err == nil {
		t.Fatal("empty checksum file accepted")
	}
}

func TestReplaceFileSwapsContentsAndMakesThemExecutable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "everr")
	if err := os.WriteFile(path, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := replaceFile(path, []byte("new")); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "new" {
		t.Fatalf("contents = %q, %v", got, err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm()&0o111 == 0 {
		t.Fatalf("mode = %v, %v", info.Mode(), err)
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Fatalf("staged file left behind: %v", entries)
	}
}
