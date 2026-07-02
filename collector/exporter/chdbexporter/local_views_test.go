// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/stretchr/testify/require"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

func newRealChDBConn(t *testing.T) driver.Conn {
	t.Cleanup(chdb.ResetForTesting)
	handle, err := chdb.Open(filepath.Join(t.TempDir(), "chdb"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = handle.Close() })

	db, err := internal.NewChDBConn(handle)
	require.NoError(t, err)
	return db
}

func createSourceTable(t *testing.T, ctx context.Context, db driver.Conn) {
	require.NoError(t, db.Exec(ctx,
		`CREATE TABLE "default"."view_test_src" (Timestamp DateTime64(9), Body String) ENGINE = MergeTree ORDER BY Timestamp`))
}

func queryViewColumn(ctx context.Context, db driver.Conn, column string) error {
	rows, err := db.Query(ctx, `SELECT `+column+` FROM "default"."view_test" LIMIT 1`)
	if err != nil {
		return err
	}
	return rows.Close()
}

func TestCreateLocalQueryViewCreatesMissingView(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	createSourceTable(t, ctx, db)

	require.NoError(t, createLocalQueryView(ctx, db, "default", "view_test", "view_test_src"))

	require.NoError(t, queryViewColumn(ctx, db, "Body"))
}

func TestCreateLocalQueryViewHealsStaleView(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	createSourceTable(t, ctx, db)

	// Freeze the view before the column migration, as installs older than the
	// TimestampTime fix did.
	require.NoError(t, createLocalQueryView(ctx, db, "default", "view_test", "view_test_src"))
	require.NoError(t, db.Exec(ctx,
		`ALTER TABLE "default"."view_test_src" ADD COLUMN IF NOT EXISTS TimestampTime DateTime DEFAULT toDateTime(Timestamp)`))
	require.Error(t, queryViewColumn(ctx, db, "TimestampTime"), "stale view should reject the migrated column")

	require.NoError(t, createLocalQueryView(ctx, db, "default", "view_test", "view_test_src"))

	require.NoError(t, queryViewColumn(ctx, db, "TimestampTime"))
}

func TestCreateLocalQueryViewIgnoresMaterializedColumns(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	require.NoError(t, db.Exec(ctx,
		`CREATE TABLE "default"."view_test_src" (
			Timestamp DateTime64(9),
			Body String,
			BodyLength UInt64 MATERIALIZED length(Body)
		) ENGINE = MergeTree ORDER BY Timestamp`))

	require.NoError(t, createLocalQueryView(ctx, db, "default", "view_test", "view_test_src"))

	// A SELECT * view never exposes MATERIALIZED columns; that must not read as
	// staleness, or every startup would drop and recreate a healthy view.
	stale, err := viewColumnsDiffer(ctx, db, "default", "view_test", "view_test_src")
	require.NoError(t, err)
	require.False(t, stale)
}

func TestCreateLocalQueryViewLeavesNonViewAlone(t *testing.T) {
	db := newRealChDBConn(t)
	ctx := t.Context()
	createSourceTable(t, ctx, db)
	require.NoError(t, db.Exec(ctx,
		`CREATE TABLE "default"."view_test" (Other String) ENGINE = MergeTree ORDER BY Other`))

	// A pre-existing real table under the view's name (e.g. on a shared
	// ClickHouse server) must not fail startup or be dropped.
	require.NoError(t, createLocalQueryView(ctx, db, "default", "view_test", "view_test_src"))

	require.NoError(t, queryViewColumn(ctx, db, "Other"))
}
