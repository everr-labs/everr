// Package landing owns what the exporter writes: the seven otel.* landing
// tables and the rows sent to them.
//
// The tables come from packages/app/clickhouse (ENGINE = Null, with
// materialized views that copy each row into app.*). This package never
// creates, alters or describes a table. A test in collector/localcollector
// compares every column list here with the migrated table.
package landing

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

// Table is one landing table. Columns are in the order the converters append
// values. A dotted name such as Events.Name is a Nested sub-column.
type Table struct {
	// Name is qualified, so a write never depends on the session's database.
	Name    string
	Columns []string
}

var (
	Logs = Table{Name: "otel.otel_logs", Columns: []string{
		"Timestamp",
		"TraceId",
		"SpanId",
		"TraceFlags",
		"SeverityText",
		"SeverityNumber",
		"ServiceName",
		"Body",
		"ResourceSchemaUrl",
		"ResourceAttributes",
		"ScopeSchemaUrl",
		"ScopeName",
		"ScopeVersion",
		"ScopeAttributes",
		"LogAttributes",
		"ResourceAttributesKeys",
		"ScopeAttributesKeys",
		"LogAttributesKeys",
		"EventName",
	}}

	Traces = Table{Name: "otel.otel_traces", Columns: []string{
		"Timestamp",
		"TraceId",
		"SpanId",
		"ParentSpanId",
		"TraceState",
		"SpanName",
		"SpanKind",
		"ServiceName",
		"ResourceAttributes",
		"ScopeName",
		"ScopeVersion",
		"SpanAttributes",
		"Duration",
		"StatusCode",
		"StatusMessage",
		"Events.Timestamp",
		"Events.Name",
		"Events.Attributes",
		"Links.TraceId",
		"Links.SpanId",
		"Links.TraceState",
		"Links.Attributes",
		"ResourceAttributesKeys",
		"SpanAttributesKeys",
	}}

	MetricsGauge = Table{Name: "otel.otel_metrics_gauge", Columns: metricColumns(
		"Value",
		"Flags",
		"Exemplars.FilteredAttributes",
		"Exemplars.TimeUnix",
		"Exemplars.Value",
		"Exemplars.SpanId",
		"Exemplars.TraceId",
	)}

	MetricsSum = Table{Name: "otel.otel_metrics_sum", Columns: metricColumns(
		"Value",
		"Flags",
		"Exemplars.FilteredAttributes",
		"Exemplars.TimeUnix",
		"Exemplars.Value",
		"Exemplars.SpanId",
		"Exemplars.TraceId",
		"AggregationTemporality",
		"IsMonotonic",
	)}

	MetricsHistogram = Table{Name: "otel.otel_metrics_histogram", Columns: metricColumns(
		"Count",
		"Sum",
		"BucketCounts",
		"ExplicitBounds",
		"Exemplars.FilteredAttributes",
		"Exemplars.TimeUnix",
		"Exemplars.Value",
		"Exemplars.SpanId",
		"Exemplars.TraceId",
		"Flags",
		"Min",
		"Max",
		"AggregationTemporality",
	)}

	MetricsExponentialHistogram = Table{Name: "otel.otel_metrics_exponential_histogram", Columns: metricColumns(
		"Count",
		"Sum",
		"Scale",
		"ZeroCount",
		"PositiveOffset",
		"PositiveBucketCounts",
		"NegativeOffset",
		"NegativeBucketCounts",
		"Exemplars.FilteredAttributes",
		"Exemplars.TimeUnix",
		"Exemplars.Value",
		"Exemplars.SpanId",
		"Exemplars.TraceId",
		"Flags",
		"Min",
		"Max",
		"AggregationTemporality",
	)}

	MetricsSummary = Table{Name: "otel.otel_metrics_summary", Columns: metricColumns(
		"Count",
		"Sum",
		"ValueAtQuantiles.Quantile",
		"ValueAtQuantiles.Value",
		"Flags",
	)}
)

// Tables lists every landing table.
func Tables() []Table {
	return []Table{Logs, Traces, MetricsGauge, MetricsSum, MetricsHistogram, MetricsExponentialHistogram, MetricsSummary}
}

// metricColumns prefixes the columns every metric kind starts with.
func metricColumns(kind ...string) []string {
	return append([]string{
		"ResourceAttributes",
		"ResourceSchemaUrl",
		"ScopeName",
		"ScopeVersion",
		"ScopeAttributes",
		"ScopeDroppedAttrCount",
		"ScopeSchemaUrl",
		"ServiceName",
		"MetricName",
		"MetricDescription",
		"MetricUnit",
		"Attributes",
		"StartTimeUnix",
		"TimeUnix",
	}, kind...)
}

// Batch collects the rows of one push for one table.
type Batch struct {
	table Table
	rows  bytes.Buffer
}

func NewBatch(table Table) *Batch {
	return &Batch{table: table}
}

// Append adds one row. The values are in the order of the table's columns,
// and the Go type of a value decides how it is written, not the column:
//
//   - time.Time is an RFC 3339 string in UTC with nanoseconds, which parses
//     into DateTime and DateTime64 at the precision each column has. A bare
//     number would be read as the column's own ticks.
//   - json.RawMessage is written as it is. A JSON column needs one: a string
//     would be stored as text.
//   - Anything else goes through encoding/json. A nil slice is written as
//     null, which ClickHouse reads as an empty array.
func (b *Batch) Append(values ...any) error {
	if len(values) != len(b.table.Columns) {
		return fmt.Errorf("%s: %d values for %d columns", b.table.Name, len(values), len(b.table.Columns))
	}
	start := b.rows.Len()
	for i, value := range values {
		encoded, err := encode(value)
		if err != nil {
			b.rows.Truncate(start)
			return fmt.Errorf("%s: column %s: %w", b.table.Name, b.table.Columns[i], err)
		}
		if i == 0 {
			b.rows.WriteByte('{')
		} else {
			b.rows.WriteByte(',')
		}
		b.rows.WriteByte('"')
		b.rows.WriteString(b.table.Columns[i])
		b.rows.WriteString(`":`)
		b.rows.Write(encoded)
	}
	b.rows.WriteString("}\n")
	return nil
}

func encode(value any) ([]byte, error) {
	switch value := value.(type) {
	case time.Time:
		return json.Marshal(value.UTC().Format(time.RFC3339Nano))
	case json.RawMessage:
		return value, nil
	}
	return json.Marshal(value)
}

// Send writes the rows in one INSERT. A batch without rows sends nothing.
func (b *Batch) Send(ctx context.Context, handle *chdb.Handle) error {
	if b.rows.Len() == 0 {
		return nil
	}
	statement := "INSERT INTO " + b.table.Name + " FORMAT JSONEachRow\n" + b.rows.String()
	return handle.Do(ctx, func(_ context.Context, session chdb.Session) error {
		result, err := session.Query(statement, "")
		if result != nil {
			result.Free()
		}
		return err
	})
}
