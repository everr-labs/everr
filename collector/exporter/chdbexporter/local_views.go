// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"context"
	"fmt"
	"slices"
	"strings"

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

	engine, err := lookupTableEngine(ctx, db, database, viewName)
	if err != nil {
		return fmt.Errorf("inspect local query view %q: %w", viewName, err)
	}

	switch engine {
	case "":
		// Nothing occupies the name yet; create the view below.
	case "View":
		stale, staleErr := viewColumnsDiffer(ctx, db, database, viewName, rawName)
		if staleErr != nil {
			return fmt.Errorf("compare local query view %q columns: %w", viewName, staleErr)
		}
		if !stale {
			return nil
		}
		// A view freezes the source table's column set at creation time, so a
		// view created before a column migration keeps rejecting the migrated
		// columns with UNKNOWN_IDENTIFIER even after the underlying table
		// gained them. Views are metadata-only, so recreating is cheap.
		drop := fmt.Sprintf(`DROP VIEW IF EXISTS %q.%q`, database, viewName)
		if dropErr := db.Exec(ctx, drop); dropErr != nil {
			return fmt.Errorf("drop stale local query view %q: %w", viewName, dropErr)
		}
	default:
		// The name is taken by something that isn't our view — e.g. a real table
		// on a shared ClickHouse server, or one left behind by an older
		// table-name config. Failing here would keep the collector from
		// starting, so leave the object alone.
		return nil
	}

	create := fmt.Sprintf(
		`CREATE VIEW IF NOT EXISTS %q.%q AS SELECT * FROM %q.%q`,
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

// lookupTableEngine returns the engine of the named table or view, or "" when
// no such object exists. The result column is aliased to `name` because the
// chdb rows shim scans by the fixed DESC TABLE column list, whose first entry
// is `name` — and the WHERE columns are qualified with `t.` because ClickHouse
// resolves unqualified WHERE identifiers against SELECT aliases first, which
// would capture `name`.
func lookupTableEngine(ctx context.Context, db driver.Conn, database, tableName string) (string, error) {
	query := fmt.Sprintf(
		`SELECT t.engine AS name FROM system.tables AS t WHERE t.database = '%s' AND t.name = '%s'`,
		escapeStringLiteral(database),
		escapeStringLiteral(tableName),
	)
	rows, err := db.Query(ctx, query)
	if err != nil {
		return "", err
	}
	defer func() { _ = rows.Close() }()

	if !rows.Next() {
		return "", rows.Err()
	}

	var engine string
	if err := rows.Scan(&engine); err != nil {
		return "", err
	}

	return engine, rows.Err()
}

func viewColumnsDiffer(ctx context.Context, db driver.Conn, database, viewName, rawName string) (bool, error) {
	viewColumns, err := getQueryableColumns(ctx, db, database, viewName)
	if err != nil {
		return false, err
	}

	rawColumns, err := getQueryableColumns(ctx, db, database, rawName)
	if err != nil {
		return false, err
	}

	return !slices.Equal(viewColumns, rawColumns), nil
}

// getQueryableColumns returns the column names a `SELECT *` over the table
// exposes, i.e. excluding MATERIALIZED and ALIAS columns, which a plain view
// over `SELECT *` never contains.
func getQueryableColumns(ctx context.Context, db driver.Conn, database, table string) ([]string, error) {
	descTable := fmt.Sprintf("DESC TABLE %q.%q", database, table)
	rows, err := db.Query(ctx, descTable)
	if err != nil {
		return nil, fmt.Errorf("desc table %q: %w", table, err)
	}
	defer func() { _ = rows.Close() }()

	var columnNames []string
	for rows.Next() {
		var columnName, columnType, defaultType, skip string
		if scanErr := rows.Scan(&columnName, &columnType, &defaultType, &skip, &skip, &skip, &skip); scanErr != nil {
			return nil, fmt.Errorf("scan column of %q: %w", table, scanErr)
		}
		if defaultType == "MATERIALIZED" || defaultType == "ALIAS" {
			continue
		}
		columnNames = append(columnNames, columnName)
	}

	return columnNames, rows.Err()
}

func escapeStringLiteral(s string) string {
	return strings.NewReplacer(`\`, `\\`, `'`, `''`).Replace(s)
}
