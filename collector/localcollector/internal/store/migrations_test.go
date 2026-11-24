package store

import (
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/require"
)

func TestLocalMigrationsReadsTheSQLFilesInNameOrder(t *testing.T) {
	fsys := fstest.MapFS{
		"0003-create-tables.sql":                {Data: []byte("SELECT 3;")},
		"0001-setup.sql":                        {Data: []byte("SELECT 1;")},
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
		"0012-create-the-last-one-in-order.sql",
	}, names)
}

func TestLocalMigrationsHashTheStatementsAndNotTheComments(t *testing.T) {
	sum := func(text string) string {
		local, err := localMigrations(fstest.MapFS{"0001-setup.sql": {Data: []byte(text)}})
		require.NoError(t, err)
		require.Len(t, local, 1)
		return local[0].sum
	}

	written := sum("-- a comment\nSELECT 1;\nSELECT 2;\n")

	require.Equal(t, written, sum("-- another comment\n\nSELECT 1; -- inline\nSELECT 2;"))
	require.NotEqual(t, written, sum("SELECT 1;\nSELECT 3;\n"))
	require.NotEqual(t, written, sum("SELECT 2;\nSELECT 1;\n"))
	require.NotEqual(t, written, sum("SELECT 1;\n"))
}

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
		"reads Windows line endings":                    {sql: "SELECT 1; -- c\r\nSELECT 2;\r\n", want: []string{"SELECT 1", "SELECT 2"}},
		"keeps a carriage return inside a statement":    {sql: "SELECT 1 -- c\r\n+ 2;\r\n", want: []string{"SELECT 1 \r\n+ 2"}},
		"ends a comment at a bare carriage return":      {sql: "-- comment\rSELECT 1;", want: []string{"SELECT 1"}},
		"drops a byte order mark":                       {sql: "\uFEFFSELECT 1;", want: []string{"SELECT 1"}},
		"keeps a next-line character":                   {sql: "SELECT 1\u0085;", want: []string{"SELECT 1\u0085"}},
	} {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, tc.want, statements(tc.sql))
		})
	}
}
