// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zaptest"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metrics"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/sqltemplates"
)

func TestLocalTelemetryTablesMaterializeRowBytes(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	cfg := withCloudTableNamesConfig()

	require.NoError(t, createLogsTable(ctx, cfg, db, zaptest.NewLogger(t)))
	require.NoError(t, migrateLogsTable(ctx, cfg, db))
	require.NoError(t, migrateRowBytesColumn(
		ctx,
		db,
		cfg.database(),
		cfg.LogsTableName,
		cfg.clusterString(),
		sqltemplates.LogsRowBytesExpression,
	))
	require.NoError(t, createTraceTables(ctx, cfg, db))
	require.NoError(t, metrics.NewMetricsTable(
		ctx,
		generateMetricTablesConfigMapper(cfg),
		cfg.database(),
		cfg.clusterString(),
		cfg.tableEngineString(),
		internal.GenerateTTLExpr(cfg.TTL, "toDateTime(TimeUnix)"),
		db,
	))

	tests := []struct {
		name       string
		table      string
		insert     string
		expression string
	}{
		{
			name:       "logs",
			table:      cfg.LogsTableName,
			insert:     `INSERT INTO "default"."logs" (Timestamp, ServiceName, Body) VALUES (now64(9), 'row-bytes-test', 'local row')`,
			expression: sqltemplates.LogsRowBytesExpression,
		},
		{
			name:       "traces",
			table:      cfg.TracesTableName,
			insert:     `INSERT INTO "default"."traces" (Timestamp, ServiceName, SpanName) VALUES (now64(9), 'row-bytes-test', 'local span')`,
			expression: sqltemplates.TracesRowBytesExpression,
		},
		{
			name:       "gauge metrics",
			table:      cfg.MetricsTables.Gauge.Name,
			insert:     `INSERT INTO "default"."metrics_gauge" (TimeUnix, ServiceName, MetricName) VALUES (now64(9), 'row-bytes-test', 'local.gauge')`,
			expression: sqltemplates.MetricsGaugeRowBytesExpression,
		},
		{
			name:       "sum metrics",
			table:      cfg.MetricsTables.Sum.Name,
			insert:     `INSERT INTO "default"."metrics_sum" (TimeUnix, ServiceName, MetricName) VALUES (now64(9), 'row-bytes-test', 'local.sum')`,
			expression: sqltemplates.MetricsSumRowBytesExpression,
		},
		{
			name:       "histogram metrics",
			table:      cfg.MetricsTables.Histogram.Name,
			insert:     `INSERT INTO "default"."metrics_histogram" (TimeUnix, ServiceName, MetricName) VALUES (now64(9), 'row-bytes-test', 'local.histogram')`,
			expression: sqltemplates.MetricsHistogramRowBytesExpression,
		},
		{
			name:       "exponential histogram metrics",
			table:      cfg.MetricsTables.ExponentialHistogram.Name,
			insert:     `INSERT INTO "default"."metrics_exponential_histogram" (TimeUnix, ServiceName, MetricName) VALUES (now64(9), 'row-bytes-test', 'local.exp_histogram')`,
			expression: sqltemplates.MetricsExpHistogramRowBytesExpression,
		},
		{
			name:       "summary metrics",
			table:      cfg.MetricsTables.Summary.Name,
			insert:     `INSERT INTO "default"."metrics_summary" (TimeUnix, ServiceName, MetricName) VALUES (now64(9), 'row-bytes-test', 'local.summary')`,
			expression: sqltemplates.MetricsSummaryRowBytesExpression,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mustExec(t, ctx, db, test.insert)

			row := db.QueryRow(ctx, fmt.Sprintf(
				`SELECT toString(RowBytes) AS name, toString(%s) AS type FROM "default".%q LIMIT 1`,
				test.expression,
				test.table,
			))
			var rowBytes, expectedRowBytes string
			require.NoError(t, row.Scan(&rowBytes, &expectedRowBytes))
			require.NotEqual(t, "0", rowBytes)
			require.Equal(t, expectedRowBytes, rowBytes)
		})
	}
}

func TestMigrateRowBytesColumnCoversExistingRows(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	const expression = "byteSize(Timestamp, Body)"

	mustExec(t, ctx, db, `CREATE TABLE "default"."legacy_logs" (
		Timestamp DateTime64(9),
		Body String
	) ENGINE = MergeTree ORDER BY Timestamp`)
	mustExec(t, ctx, db, `INSERT INTO "default"."legacy_logs" VALUES (now64(9), 'before migration')`)

	require.NoError(t, migrateRowBytesColumn(ctx, db, "default", "legacy_logs", "", expression))
	mustExec(t, ctx, db, `INSERT INTO "default"."legacy_logs" (Timestamp, Body) VALUES (now64(9), 'after migration')`)

	row := db.QueryRow(ctx, `SELECT toString(count()) AS name, toString(countIf(RowBytes = byteSize(Timestamp, Body))) AS type FROM "default"."legacy_logs"`)
	var count, matching string
	require.NoError(t, row.Scan(&count, &matching))
	require.Equal(t, "2", count)
	require.Equal(t, count, matching)
}
