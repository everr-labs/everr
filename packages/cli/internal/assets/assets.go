// Package assets embeds files staged into this directory by
// scripts/stage-go-assets.ts: the local UI build, the bundled skills, and the
// zstd-compressed libchdb for this platform. go:embed cannot reach outside the
// module, so the sources are copied here first. Unstaged builds still compile
// and report the missing asset at the point of use.
package assets

import (
	"embed"
	"io/fs"
	"strings"
)

//go:embed all:localui
var localUI embed.FS

//go:embed all:skills
var skills embed.FS

//go:embed all:chdb
var chdb embed.FS

// LocalUI is the built local UI (packages/local-app/dist), rooted at its
// index.html. ok is false when the UI was not staged.
func LocalUI() (ui fs.FS, ok bool) {
	return subWith(localUI, "localui", "index.html")
}

// Skills is the repository's skills/ directory. ok is false when skills were
// not staged.
func Skills() (skillsFS fs.FS, ok bool) {
	sub, err := fs.Sub(skills, "skills")
	if err != nil {
		return nil, false
	}
	entries, err := fs.ReadDir(sub, ".")
	if err != nil {
		return nil, false
	}
	for _, entry := range entries {
		if entry.IsDir() {
			return sub, true
		}
	}
	return nil, false
}

// ChDBLibraryZst is the zstd-compressed libchdb for this platform and the
// sha256 of those compressed bytes, or ok false when it was not staged.
func ChDBLibraryZst() (zst []byte, sha256 string, ok bool) {
	zst, err := chdb.ReadFile("chdb/libchdb.so.zst")
	if err != nil {
		return nil, "", false
	}
	sum, err := chdb.ReadFile("chdb/libchdb.so.zst.sha256")
	if err != nil {
		return nil, "", false
	}
	return zst, strings.TrimSpace(string(sum)), true
}

func subWith(fsys embed.FS, dir, required string) (fs.FS, bool) {
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		return nil, false
	}
	if _, err := fs.Stat(sub, required); err != nil {
		return nil, false
	}
	return sub, true
}
