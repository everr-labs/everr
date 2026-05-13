package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestParseOptionsUsesLocalDefaults(t *testing.T) {
	opts, err := parseOptions([]string{
		"--otlp-http-endpoint", "http://127.0.0.1:54318",
		"--health-http-endpoint", "http://127.0.0.1:54319",
		"--sql-http-endpoint", "http://127.0.0.1:54320",
		"--chdb-path", "/tmp/everr/chdb",
	})

	require.NoError(t, err)
	require.Equal(t, "127.0.0.1:54318", opts.OTLP.ListenAddress)
	require.Equal(t, "127.0.0.1:54319", opts.Health.ListenAddress)
	require.Equal(t, "127.0.0.1:54320", opts.SQL.ListenAddress)
	require.Equal(t, "/tmp/everr/chdb", opts.ChDBPath)
	require.Equal(t, 7*24*time.Hour, opts.TTL)
}

func TestParseOptionsRejectsNonLocalEndpoints(t *testing.T) {
	_, err := parseOptions([]string{
		"--otlp-http-endpoint", "http://example.com:54318",
		"--health-http-endpoint", "http://127.0.0.1:54319",
		"--sql-http-endpoint", "http://127.0.0.1:54320",
		"--chdb-path", "/tmp/everr/chdb",
	})

	require.ErrorContains(t, err, "localhost or loopback")
}
