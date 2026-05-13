package sqlhttp

import (
	"errors"
	"testing"
)

func TestValidateReadOnly(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		sql  string
		want error
	}{
		{name: "select", sql: "SELECT 1"},
		{name: "leading spaces", sql: "   SELECT 1"},
		{name: "lowercase", sql: "select 1"},
		{name: "with cte", sql: "WITH x AS (SELECT 1) SELECT * FROM x"},
		{name: "parenthesized union", sql: "(SELECT 1) UNION (SELECT 2)"},
		{name: "explain", sql: "EXPLAIN SELECT 1"},
		{name: "describe", sql: "DESCRIBE otel_logs"},
		{name: "desc", sql: "DESC otel_logs"},
		{name: "show", sql: "SHOW TABLES"},
		{name: "leading line comment", sql: "-- hi\nSELECT 1"},
		{name: "leading block comment", sql: "/* hi */ SELECT 1"},
		{name: "trailing semicolon", sql: "SELECT 1;"},
		{name: "trailing semicolon after comment", sql: "SELECT 1; -- bye"},
		{name: "semicolon in string", sql: "SELECT 'a;b'"},
		{name: "semicolon in line comment", sql: "SELECT 1 -- ; stuff\n"},
		{name: "semicolon in block comment", sql: "SELECT 1 /* ; stuff */"},
		{name: "escaped quote", sql: `SELECT 'it\'s fine'`},
		{name: "double quoted identifier", sql: `SELECT "col;name" FROM t`},
		{name: "multiline block comment", sql: "/* hi\n; still comment */\nSELECT 1"},
		{name: "comments after trailing semicolon", sql: "SELECT 1; /* trailing */ -- and more"},

		{name: "insert", sql: "INSERT INTO t VALUES (1)", want: ErrNotReadOnly},
		{name: "create", sql: "CREATE TABLE t (x Int32) ENGINE=MergeTree() ORDER BY x", want: ErrNotReadOnly},
		{name: "drop", sql: "DROP TABLE t", want: ErrNotReadOnly},
		{name: "truncate", sql: "TRUNCATE TABLE t", want: ErrNotReadOnly},
		{name: "alter", sql: "ALTER TABLE t ADD COLUMN y Int32", want: ErrNotReadOnly},
		{name: "rename", sql: "RENAME TABLE t TO u", want: ErrNotReadOnly},
		{name: "optimize", sql: "OPTIMIZE TABLE t", want: ErrNotReadOnly},
		{name: "grant", sql: "GRANT SELECT ON *.* TO u", want: ErrNotReadOnly},

		{name: "select then insert", sql: "SELECT 1; INSERT INTO t VALUES (1)", want: ErrMultiStatement},
		{name: "select then select", sql: "SELECT 1 ; SELECT 2", want: ErrMultiStatement},
		{name: "double semicolon", sql: "SELECT 1;;", want: ErrMultiStatement},

		{name: "empty", sql: "", want: ErrEmpty},
		{name: "whitespace only", sql: "   \n\t", want: ErrEmpty},
		{name: "comments only", sql: "-- hi\n/* yo */", want: ErrEmpty},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			err := ValidateReadOnly(tc.sql)
			if !errors.Is(err, tc.want) {
				t.Fatalf("ValidateReadOnly(%q) error = %v, want %v", tc.sql, err, tc.want)
			}
		})
	}
}
