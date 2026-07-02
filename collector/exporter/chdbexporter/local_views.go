// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"context"
	"fmt"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

const (
	localLogsViewName                = "logs"
	localTracesViewName              = "traces"
	localMetricsGaugeViewName        = "metrics_gauge"
	localMetricsSumViewName          = "metrics_sum"
	localMetricsHistogramViewName    = "metrics_histogram"
	localMetricsExpHistogramViewName = "metrics_exponential_histogram"
	localMetricsSummaryViewName      = "metrics_summary"
)

func createLocalLogsView(ctx context.Context, cfg *Config, db driver.Conn) error {
	return createLocalQueryView(ctx, db, cfg.database(), localLogsViewName, cfg.LogsTableName)
}

func createLocalTracesView(ctx context.Context, cfg *Config, db driver.Conn) error {
	return createLocalQueryView(ctx, db, cfg.database(), localTracesViewName, cfg.TracesTableName)
}

func createLocalMetricsViews(ctx context.Context, cfg *Config, db driver.Conn) error {
	views := []struct {
		viewName string
		rawName  string
	}{
		{localMetricsGaugeViewName, cfg.MetricsTables.Gauge.Name},
		{localMetricsSumViewName, cfg.MetricsTables.Sum.Name},
		{localMetricsHistogramViewName, cfg.MetricsTables.Histogram.Name},
		{localMetricsExpHistogramViewName, cfg.MetricsTables.ExponentialHistogram.Name},
		{localMetricsSummaryViewName, cfg.MetricsTables.Summary.Name},
	}

	for _, view := range views {
		if err := createLocalQueryView(ctx, db, cfg.database(), view.viewName, view.rawName); err != nil {
			return err
		}
	}

	return nil
}

func createLocalQueryView(ctx context.Context, db driver.Conn, database, viewName, rawName string) error {
	if viewName == rawName {
		return nil
	}

	// A view freezes the source table's column set at creation time, so a view
	// created before a column migration keeps rejecting the new columns with
	// UNKNOWN_IDENTIFIER even after the underlying table is migrated. Views are
	// metadata-only, so drop and recreate on every startup to pick up the
	// current column set.
	drop := fmt.Sprintf(`DROP VIEW IF EXISTS %q.%q`, database, viewName)
	if err := db.Exec(ctx, drop); err != nil {
		return fmt.Errorf("drop local query view %q: %w", viewName, err)
	}

	create := fmt.Sprintf(
		`CREATE VIEW %q.%q AS SELECT * FROM %q.%q`,
		database,
		viewName,
		database,
		rawName,
	)
	if err := db.Exec(ctx, create); err != nil {
		return fmt.Errorf("create local query view %q: %w", viewName, err)
	}

	return nil
}
