package store

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/require"
)

func TestLocalMigrationsKeepsUntaggedFilesInNameOrder(t *testing.T) {
	fsys := fstest.MapFS{
		"0003-create-tables.sql":                {Data: []byte("SELECT 3;")},
		"0001-setup.sql":                        {Data: []byte("SELECT 1;")},
		"0002-cloud-grants.sql":                 {Data: []byte("GRANT 2;")},
		"0004-self-hosted-user.sql":             {Data: []byte("CREATE USER 4;")},
		"0005-cloudy-name.sql":                  {Data: []byte("SELECT 5;")},
		"0006-create-views.seed.ts":             {Data: []byte("export default () => {}")},
		"README.md":                             {Data: []byte("not sql")},
		"nested/0007-anything.sql":              {Data: []byte("SELECT 7;")},
		"0012-create-the-last-one-in-order.sql": {Data: []byte("SELECT 12;")},
	}

	local, err := localMigrations(fsys)

	require.NoError(t, err)
	var names []string
	for _, m := range local {
		names = append(names, m.name)
	}
	require.Equal(t, []string{
		"0001-setup.sql",
		"0003-create-tables.sql",
		"0005-cloudy-name.sql",
		"0012-create-the-last-one-in-order.sql",
	}, names)
}

func TestLocalMigrationsHashTheFileTextAsWritten(t *testing.T) {
	text := "-- a comment\nSELECT 1;\n"
	local, err := localMigrations(fstest.MapFS{"0001-setup.sql": {Data: []byte(text)}})

	require.NoError(t, err)
	sum := sha256.Sum256([]byte(text))
	require.Equal(t, []migration{{name: "0001-setup.sql", sql: text, sum: hex.EncodeToString(sum[:])}}, local)
}

// The cases mirror the TypeScript rule in
// packages/app/src/db/clickhouse-statements.ts and its test.
func TestStatementsSplitLikeTheWebApp(t *testing.T) {
	for name, tc := range map[string]struct {
		sql  string
		want []string
	}{
		"drops comments that hold semicolons": {
			sql:  "-- one; two\nCREATE ROLE a;\n\nGRANT b TO a; -- done;\n",
			want: []string{"CREATE ROLE a", "GRANT b TO a"},
		},
		"drops a trailing comment on a statement line": {
			sql:  "SELECT 1 -- why; because\n;",
			want: []string{"SELECT 1"},
		},
		"keeps a multi-line statement whole": {
			sql:  "CREATE TABLE t (\n  a UInt8, -- the key\n  b UInt8\n) ENGINE = Null;",
			want: []string{"CREATE TABLE t (\n  a UInt8, \n  b UInt8\n) ENGINE = Null"},
		},
		"drops empty statements":                        {sql: ";;\n;  ;SELECT 1;;", want: []string{"SELECT 1"}},
		"reads a file that does not end in a semicolon": {sql: "SELECT 1;\nSELECT 2", want: []string{"SELECT 1", "SELECT 2"}},
		"gives nothing for a file of comments":          {sql: "-- nothing here\n", want: nil},
	} {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, tc.want, statements(tc.sql))
		})
	}
}
