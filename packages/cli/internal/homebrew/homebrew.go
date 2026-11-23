// Package homebrew detects a CLI installed by the everr Homebrew formula.
// Homebrew owns that binary, so self-update and manual removal would leave
// its records out of sync with the file on disk.
package homebrew

import (
	"os"
	"path/filepath"
	"strings"
)

const (
	UpgradeCommand   = "brew upgrade everr"
	UninstallCommand = "brew uninstall everr"
)

// Installed reports whether the running binary lives in Homebrew's Cellar.
func Installed() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	return InCellar(exe)
}

// InCellar reports whether exe, after resolving the bin symlink Homebrew
// links into its prefix, is the everr formula's keg.
func InCellar(exe string) bool {
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return strings.Contains(filepath.ToSlash(exe), "/Cellar/everr/")
}
