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

// migration is one file of packages/app/clickhouse, with the hash the web
// app's journal records for it.
type migration struct {
	name string
	sql  string
	sum  string
}

// A file tagged for one product is left out. Same rule as
// clickHouseMigrationTarget in packages/app/src/db/clickhouse-sql.ts.
var taggedFile = regexp.MustCompile(`^\d+-(cloud|self-hosted)-`)

var lineComment = regexp.MustCompile(`(?m)--.*$`)

// localMigrations lists the untagged .sql files of fsys in file-name order.
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

// statements splits a file as sqlStatements in
// packages/app/src/db/clickhouse-statements.ts does: drop `--` line comments,
// split on `;`, trim, drop empties. It does not read quotes.
func statements(sql string) []string {
	var out []string
	for _, part := range strings.Split(lineComment.ReplaceAllString(sql, ""), ";") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
