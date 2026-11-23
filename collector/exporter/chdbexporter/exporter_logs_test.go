// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRenderCreateLogsJSONTableSQL(t *testing.T) {
	cfg := withDefaultConfig(func(c *Config) {
		c.LogsTableName = "otel_logs_json"
		c.TTL = 72 * time.Hour
	})

	sql, err := renderCreateLogsJSONTableSQL(cfg)
	require.NoError(t, err)

	require.Contains(t, sql, "`ResourceAttributes` JSON")
	require.Contains(t, sql, "`ScopeAttributes` JSON")
	require.Contains(t, sql, "`LogAttributes` JSON")
	require.NotContains(t, sql, "TimestampTime")

	require.Contains(t, sql, "ORDER BY (ServiceName, Timestamp)")
	require.NotContains(t, sql, "toStartOfFiveMinutes")
	require.Contains(t, sql, "`default`.`otel_logs_json`")

	require.Contains(t, sql, "TYPE bloom_filter")
	require.NotContains(t, sql, "TYPE text(")
}
