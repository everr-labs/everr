// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestRenderInsertTracesJSONSQLMatchesColumnsAndPlaceholders(t *testing.T) {
	tests := map[string]bool{
		"without attribute keys": false,
		"with attribute keys":    true,
	}

	for name, attributeKeys := range tests {
		t.Run(name, func(t *testing.T) {
			cfg := withDefaultConfig(func(c *Config) {
				c.Database = "test_db"
				c.TracesTableName = "otel_traces_json"
			})
			exporter := newTracesJSONExporter(zap.NewNop(), cfg)
			exporter.schemaFeatures.AttributeKeys = attributeKeys

			exporter.renderInsertTracesJSONSQL()

			require.Equal(t, countInsertColumns(t, exporter.insertSQL), strings.Count(exporter.insertSQL, "?"))
		})
	}
}

func countInsertColumns(t *testing.T, insertSQL string) int {
	t.Helper()

	start := strings.Index(insertSQL, "(\n")
	require.NotEqual(t, -1, start)

	end := strings.Index(insertSQL, ") VALUES")
	require.NotEqual(t, -1, end)
	require.Greater(t, end, start)

	var columns []string
	for _, column := range strings.Split(insertSQL[start+2:end], ",") {
		column = strings.TrimSpace(column)
		if column != "" {
			columns = append(columns, column)
		}
	}

	return len(columns)
}
