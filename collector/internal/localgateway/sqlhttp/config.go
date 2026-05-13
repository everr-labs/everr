package sqlhttp

import "time"

const (
	DefaultQueryTimeout   = 5 * time.Second
	DefaultEnqueueTimeout = 2 * time.Second
	DefaultMaxResultBytes = 16 << 20
)

type Config struct {
	Endpoint       string
	QueryTimeout   time.Duration
	EnqueueTimeout time.Duration
	MaxResultBytes int64
}

func (c Config) Applied() Config {
	out := c
	if out.QueryTimeout == 0 {
		out.QueryTimeout = DefaultQueryTimeout
	}
	if out.EnqueueTimeout == 0 {
		out.EnqueueTimeout = DefaultEnqueueTimeout
	}
	if out.MaxResultBytes == 0 {
		out.MaxResultBytes = DefaultMaxResultBytes
	}
	return out
}
