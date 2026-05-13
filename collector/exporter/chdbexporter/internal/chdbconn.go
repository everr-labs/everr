// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package internal

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/column"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/ClickHouse/clickhouse-go/v2/lib/proto"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

var ErrNoChDBHandle = errors.New("chdb handle is required")

type ChDBConn struct {
	handle *chdb.Handle
}

func NewChDBConn(handle *chdb.Handle) (*ChDBConn, error) {
	if handle == nil {
		return nil, ErrNoChDBHandle
	}
	return &ChDBConn{handle: handle}, nil
}

func (c *ChDBConn) Contributors() []string { return nil }

func (c *ChDBConn) ServerVersion() (*driver.ServerVersion, error) {
	return &driver.ServerVersion{Version: proto.Version{Major: 25, Minor: 8}}, nil
}

func (c *ChDBConn) Select(context.Context, any, string, ...any) error {
	return errors.New("chdb select into destination is not supported")
}

func (c *ChDBConn) Query(ctx context.Context, query string, args ...any) (driver.Rows, error) {
	if len(args) > 0 {
		return nil, errors.New("chdb query arguments are not supported")
	}

	var buf []byte
	err := c.handle.Do(ctx, func(_ context.Context, session chdb.Session) error {
		result, err := session.Query(query, "JSONEachRow")
		if err != nil {
			return err
		}
		if result == nil {
			return nil
		}
		defer result.Free()
		buf = append(buf, result.Buf()...)
		return nil
	})
	if err != nil {
		return nil, err
	}

	return newChDBRows(buf), nil
}

func (c *ChDBConn) QueryRow(ctx context.Context, query string, args ...any) driver.Row {
	rows, err := c.Query(ctx, query, args...)
	return &chDBRow{rows: rows, err: err}
}

func (c *ChDBConn) PrepareBatch(ctx context.Context, query string, _ ...driver.PrepareBatchOption) (driver.Batch, error) {
	table, columns, err := parseInsertQuery(query)
	if err != nil {
		return nil, err
	}

	return &chDBBatch{
		ctx:     ctx,
		handle:  c.handle,
		table:   table,
		columns: columns,
	}, nil
}

func (c *ChDBConn) Exec(ctx context.Context, query string, args ...any) error {
	if len(args) > 0 {
		return errors.New("chdb exec arguments are not supported")
	}

	return c.handle.Do(ctx, func(_ context.Context, session chdb.Session) error {
		result, err := session.Query(query, "")
		if err != nil {
			return err
		}
		if result != nil {
			result.Free()
		}
		return nil
	})
}

func (c *ChDBConn) AsyncInsert(ctx context.Context, query string, _ bool, args ...any) error {
	return c.Exec(ctx, query, args...)
}

func (c *ChDBConn) Ping(context.Context) error { return nil }
func (c *ChDBConn) Stats() driver.Stats        { return driver.Stats{} }
func (c *ChDBConn) Close() error               { return nil }

type chDBBatch struct {
	ctx     context.Context
	handle  *chdb.Handle
	table   string
	columns []string
	rows    []map[string]any
	sent    bool
}

func (b *chDBBatch) Abort() error {
	b.sent = true
	b.rows = nil
	return nil
}

func (b *chDBBatch) Append(values ...any) error {
	if b.sent {
		return errors.New("chdb batch is already sent")
	}
	if len(values) != len(b.columns) {
		return fmt.Errorf("chdb batch column count mismatch: have %d values for %d columns", len(values), len(b.columns))
	}

	row := make(map[string]any, len(values))
	for i, value := range values {
		row[b.columns[i]] = normalizeJSONValue(value)
	}
	b.rows = append(b.rows, row)
	return nil
}

func (b *chDBBatch) AppendStruct(any) error {
	return errors.New("chdb append struct is not supported")
}

func (b *chDBBatch) Column(int) driver.BatchColumn { return nil }
func (b *chDBBatch) Flush() error                  { return nil }

func (b *chDBBatch) Send() error {
	if b.sent {
		return nil
	}
	b.sent = true

	if len(b.rows) == 0 {
		return nil
	}

	var body strings.Builder
	body.WriteString("INSERT INTO ")
	body.WriteString(b.table)
	body.WriteString(" FORMAT JSONEachRow\n")
	encoder := json.NewEncoder(&body)
	for _, row := range b.rows {
		if err := encoder.Encode(row); err != nil {
			return err
		}
	}

	if err := b.handle.Do(b.ctx, func(_ context.Context, session chdb.Session) error {
		result, err := session.Query(body.String(), "")
		if err != nil {
			return err
		}
		if result != nil {
			result.Free()
		}
		return nil
	}); err != nil {
		return err
	}

	return touchSentinel(b.handle.Metrics().Path)
}

func (b *chDBBatch) IsSent() bool                { return b.sent }
func (b *chDBBatch) Rows() int                   { return len(b.rows) }
func (b *chDBBatch) Columns() []column.Interface { return nil }
func (b *chDBBatch) Close() error                { return nil }

func parseInsertQuery(query string) (string, []string, error) {
	upperQuery := strings.ToUpper(query)
	insertIdx := strings.Index(upperQuery, "INSERT INTO")
	if insertIdx < 0 {
		return "", nil, fmt.Errorf("unsupported insert query: %s", query)
	}

	rest := strings.TrimSpace(query[insertIdx+len("INSERT INTO"):])
	openParen := strings.Index(rest, "(")
	if openParen < 0 {
		return "", nil, fmt.Errorf("insert query has no column list: %s", query)
	}

	table := strings.TrimSpace(rest[:openParen])
	if table == "" {
		return "", nil, fmt.Errorf("insert query has no table name: %s", query)
	}

	columnPart := rest[openParen+1:]
	closeParen := strings.Index(columnPart, ")")
	if closeParen < 0 {
		return "", nil, fmt.Errorf("insert query has unterminated column list: %s", query)
	}

	rawColumns := strings.Split(columnPart[:closeParen], ",")
	columns := make([]string, 0, len(rawColumns))
	for _, rawColumn := range rawColumns {
		columnName := cleanColumnName(rawColumn)
		if columnName != "" {
			columns = append(columns, columnName)
		}
	}
	if len(columns) == 0 {
		return "", nil, fmt.Errorf("insert query has no columns: %s", query)
	}

	return table, columns, nil
}

func cleanColumnName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.Trim(name, "`\"")
	return name
}

func normalizeJSONValue(value any) any {
	switch value := value.(type) {
	case time.Time:
		return formatTimestamp(value)
	case []time.Time:
		out := make([]int64, 0, len(value))
		for _, item := range value {
			out = append(out, formatTimestamp(item))
		}
		return out
	case json.RawMessage:
		return append(json.RawMessage(nil), value...)
	case []byte:
		raw := append(json.RawMessage(nil), value...)
		if json.Valid(raw) {
			return raw
		}
		return string(value)
	case column.IterableOrderedMap:
		out := map[string]any{}
		iter := value.Iterator()
		for iter.Next() {
			out[fmt.Sprint(iter.Key())] = normalizeJSONValue(iter.Value())
		}
		return out
	case []column.IterableOrderedMap:
		out := make([]map[string]any, 0, len(value))
		for _, item := range value {
			normalized, ok := normalizeJSONValue(item).(map[string]any)
			if ok {
				out = append(out, normalized)
			}
		}
		return out
	case clickhouse.ArraySet:
		out := make([]any, 0, len(value))
		for _, item := range value {
			out = append(out, normalizeJSONValue(item))
		}
		return out
	}

	reflected := reflect.ValueOf(value)
	if reflected.IsValid() && reflected.Kind() == reflect.Slice {
		out := make([]any, 0, reflected.Len())
		for i := 0; i < reflected.Len(); i++ {
			out = append(out, normalizeJSONValue(reflected.Index(i).Interface()))
		}
		return out
	}

	return value
}

func formatTimestamp(t time.Time) int64 {
	return t.UTC().UnixNano()
}

func touchSentinel(path string) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		return err
	}
	sentinel := filepath.Join(path, ".last_flush")
	if err := os.WriteFile(sentinel, nil, 0o644); err != nil {
		return err
	}
	now := time.Now()
	return os.Chtimes(sentinel, now, now)
}

type chDBRows struct {
	columns []string
	rows    []map[string]any
	index   int
	err     error
}

func newChDBRows(buf []byte) *chDBRows {
	rows := &chDBRows{
		columns: []string{"name", "type", "default_type", "default_expression", "comment", "codec_expression", "ttl_expression"},
		index:   -1,
	}

	scanner := bufio.NewScanner(strings.NewReader(string(buf)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var row map[string]any
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			rows.err = err
			return rows
		}
		rows.rows = append(rows.rows, row)
	}
	rows.err = scanner.Err()
	return rows
}

func (r *chDBRows) Next() bool {
	if r.index+1 >= len(r.rows) {
		return false
	}
	r.index++
	return true
}

func (r *chDBRows) Scan(dest ...any) error {
	if r.index < 0 || r.index >= len(r.rows) {
		return errors.New("chdb rows scan called without current row")
	}
	row := r.rows[r.index]
	for i, target := range dest {
		if i >= len(r.columns) {
			break
		}
		assignScanValue(target, row[r.columns[i]])
	}
	return nil
}

func (r *chDBRows) ScanStruct(any) error             { return errors.New("chdb scan struct is not supported") }
func (r *chDBRows) ColumnTypes() []driver.ColumnType { return nil }
func (r *chDBRows) Totals(...any) error              { return nil }
func (r *chDBRows) Columns() []string                { return r.columns }
func (r *chDBRows) Close() error                     { return nil }
func (r *chDBRows) Err() error                       { return r.err }
func (r *chDBRows) HasData() bool                    { return len(r.rows) > 0 }

func assignScanValue(target any, value any) {
	switch target := target.(type) {
	case *string:
		*target = fmt.Sprint(value)
	case *any:
		*target = value
	}
}

type chDBRow struct {
	rows driver.Rows
	err  error
}

func (r *chDBRow) Err() error {
	return r.err
}

func (r *chDBRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if r.rows == nil || !r.rows.Next() {
		return errors.New("chdb row not found")
	}
	return r.rows.Scan(dest...)
}

func (r *chDBRow) ScanStruct(any) error {
	return errors.New("chdb scan struct is not supported")
}
