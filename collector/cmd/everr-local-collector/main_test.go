package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestParseOptionsAcceptsDayTTL(t *testing.T) {
	opts, err := parseOptions([]string{"--ttl", "7d"})

	require.NoError(t, err)
	require.Equal(t, 7*24*time.Hour, opts.TTL)
}
