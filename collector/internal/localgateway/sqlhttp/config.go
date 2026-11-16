package sqlhttp

import "time"

const (
	DefaultQueryTimeout   = 5 * time.Second
	DefaultEnqueueTimeout = 2 * time.Second
	DefaultMaxResultBytes = 16 << 20
)
