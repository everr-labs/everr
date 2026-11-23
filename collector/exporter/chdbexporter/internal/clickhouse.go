// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package internal // import "github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"

import (
	"context"
	"fmt"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/sqltemplates"
)

const DefaultDatabase = "default"

// The templates take an ON CLUSTER clause and an engine as parameters. The
// local store is one node on the default engine.
const (
	NoCluster   = ""
	TableEngine = "MergeTree()"
)

// CreateErrorFingerprintFunction registers the errorFingerprint UDF (idempotent)
// so `everr local query` and the local browser UI group Errors the same way the cloud
// does. Route it through Query, not Exec: chDB only persists CREATE FUNCTION when
// the statement runs with a real output format, and Exec uses an empty one. The
// DDL must match the latest packages/app/clickhouse migration that defines errorFingerprint.
func CreateErrorFingerprintFunction(ctx context.Context, db driver.Conn) error {
	rows, err := db.Query(ctx, sqltemplates.CreateErrorFingerprintFunction)
	if err != nil {
		return fmt.Errorf("create errorFingerprint function: %w", err)
	}
	if rows != nil {
		_ = rows.Close()
	}
	return nil
}

// GenerateTTLExpr generates a TTL expression for a ClickHouse table.
func GenerateTTLExpr(ttl time.Duration, timeField string) string {
	if ttl > 0 {
		switch {
		case ttl%(24*time.Hour) == 0:
			return fmt.Sprintf(`TTL %s + toIntervalDay(%d)`, timeField, ttl/(24*time.Hour))
		case ttl%time.Hour == 0:
			return fmt.Sprintf(`TTL %s + toIntervalHour(%d)`, timeField, ttl/time.Hour)
		case ttl%time.Minute == 0:
			return fmt.Sprintf(`TTL %s + toIntervalMinute(%d)`, timeField, ttl/time.Minute)
		default:
			return fmt.Sprintf(`TTL %s + toIntervalSecond(%d)`, timeField, ttl/time.Second)
		}
	}

	return ""
}

// GetTableColumns returns the column names on a table for schema detection
func GetTableColumns(ctx context.Context, db driver.Conn, database, table string) ([]string, error) {
	descTable := fmt.Sprintf("DESC TABLE %q.%q", database, table)
	rows, err := db.Query(ctx, descTable)
	if err != nil {
		return nil, fmt.Errorf("get table columns: %w", err)
	}

	var columnNames []string
	for rows.Next() {
		var columnName, skip string
		scanErr := rows.Scan(&columnName, &skip, &skip, &skip, &skip, &skip, &skip)
		if scanErr != nil {
			return nil, fmt.Errorf("scan table column: %w", scanErr)
		}

		columnNames = append(columnNames, columnName)
	}

	err = rows.Close()
	if err != nil {
		return nil, fmt.Errorf("get table columns rows close: %w", err)
	}

	return columnNames, nil
}
