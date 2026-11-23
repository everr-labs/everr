package store

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"regexp"
	"slices"
	"strings"
)

type migration struct {
	name string
	sql  string
	sum  string
}

var taggedFile = regexp.MustCompile(`^\d+-(cloud|self-hosted)-`)

var lineComment = regexp.MustCompile(`(?m)--.*$`)

func localMigrations(fsys fs.FS) ([]migration, error) {
	names, err := fs.Glob(fsys, "*.sql")
	if err != nil {
		return nil, err
	}
	slices.Sort(names)
	var local []migration
	for _, name := range names {
		if taggedFile.MatchString(name) {
			continue
		}
		text, err := fs.ReadFile(fsys, name)
		if err != nil {
			return nil, fmt.Errorf("read migration %s: %w", name, err)
		}
		sum := sha256.Sum256(text)
		local = append(local, migration{name: name, sql: string(text), sum: hex.EncodeToString(sum[:])})
	}
	return local, nil
}

func statements(sql string) []string {
	var out []string
	for _, part := range strings.Split(lineComment.ReplaceAllString(sql, ""), ";") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
