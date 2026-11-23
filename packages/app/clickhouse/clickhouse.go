// Package clickhouse embeds the ClickHouse migrations so Go code can apply
// the same files the web app does.
package clickhouse

import "embed"

// Files holds every top-level migration file, tagged ones included. The
// reader decides which apply to it.
//
//go:embed *.sql
var Files embed.FS
