// Package migrations holds the SQL files that build the local store. Each is
// a copy of the file with the same name in packages/app/clickhouse, without
// the statements chDB cannot run: users, roles, grants, row policies,
// settings profiles and quotas. A hosted file that holds only such statements
// has no copy here.
package migrations

import "embed"

//go:embed *.sql
var Files embed.FS
