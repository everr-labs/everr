// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"context"
	"fmt"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/sqltemplates"
)

func migrateRowBytesColumn(
	ctx context.Context,
	db driver.Conn,
	database string,
	table string,
	cluster string,
	expression string,
) error {
	query := sqltemplates.AddRowBytesColumnSQL(database, table, cluster, expression)
	if err := db.Exec(ctx, query); err != nil {
		return fmt.Errorf("add RowBytes column to %s.%s: %w", database, table, err)
	}

	return nil
}
