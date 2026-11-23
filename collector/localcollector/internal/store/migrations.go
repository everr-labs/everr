package store

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"regexp"
	"slices"
	"strings"
	"unicode"
)

type migration struct {
	name string
	sql  string
	sum  string
}

// A comment ends at any line terminator the web app's splitter knows, and a
// statement is trimmed of the same characters, so the two splitters agree on
// every file. The hash below and the parity test with the hosted files then
// mean the same thing by "the same statements".
var lineComment = regexp.MustCompile(`--[^\n\r\x{2028}\x{2029}]*`)

func isSpace(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' }

func localMigrations(fsys fs.FS) ([]migration, error) {
	names, err := fs.Glob(fsys, "*.sql")
	if err != nil {
		return nil, err
	}
	slices.Sort(names)
	var local []migration
	for _, name := range names {
		text, err := fs.ReadFile(fsys, name)
		if err != nil {
			return nil, fmt.Errorf("read migration %s: %w", name, err)
		}
		// The hash covers what runs. A changed hash deletes the store's data,
		// and a reworded comment must not do that.
		sum := sha256.Sum256([]byte(strings.Join(statements(string(text)), ";")))
		local = append(local, migration{name: name, sql: string(text), sum: hex.EncodeToString(sum[:])})
	}
	return local, nil
}

func statements(sql string) []string {
	var out []string
	for _, part := range strings.Split(lineComment.ReplaceAllString(sql, ""), ";") {
		if part = strings.TrimFunc(part, isSpace); part != "" {
			out = append(out, part)
		}
	}
	return out
}
