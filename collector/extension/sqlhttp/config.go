package sqlhttp

import (
	"errors"
	"time"

	"github.com/everr-labs/chdbexporter/chdbhandle"
)

const (
	defaultEndpoint       = "127.0.0.1:54320"
	defaultQueryTimeout   = 5 * time.Second
	defaultEnqueueTimeout = 2 * time.Second
	defaultMaxResultBytes = 16 << 20
)

type Config struct {
	Endpoint string `mapstructure:"endpoint"`
	Path     string `mapstructure:"path"`

	QueryTimeout   time.Duration `mapstructure:"query_timeout"`
	EnqueueTimeout time.Duration `mapstructure:"enqueue_timeout"`
	MaxResultBytes int64         `mapstructure:"max_result_bytes"`
}

func (c *Config) Validate() error {
	if c.Endpoint == "" {
		return errors.New("endpoint must be set")
	}
	if c.Path == "" {
		return errors.New("path must be set")
	}
	return nil
}

func (c *Config) applied() Config {
	out := *c
	if out.QueryTimeout == 0 {
		out.QueryTimeout = defaultQueryTimeout
	}
	if out.EnqueueTimeout == 0 {
		out.EnqueueTimeout = defaultEnqueueTimeout
	}
	if out.MaxResultBytes == 0 {
		out.MaxResultBytes = defaultMaxResultBytes
	}
	return out
}

type Session = chdbhandle.Session
