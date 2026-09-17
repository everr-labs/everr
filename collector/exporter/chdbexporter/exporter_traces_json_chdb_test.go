// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.uber.org/zap"
)

func TestTracesJSONChDBSpanEventsAndLinks(t *testing.T) {
	for _, kind := range []string{"none", "empty event", "attributed event", "empty link", "attributed link"} {
		t.Run(kind, func(t *testing.T) {
			handle := openRealChDB(t)
			cfg := withDefaultConfig(func(c *Config) {
				c.JSON = true
				c.TracesTableName = "traces"
			})
			exporter := newTracesJSONExporter(zap.NewNop(), cfg, handle)
			require.NoError(t, exporter.start(t.Context(), nil))
			t.Cleanup(func() { _ = exporter.shutdown(context.Background()) })
			db := exporter.db

			td := ptrace.NewTraces()
			resource := td.ResourceSpans().AppendEmpty()
			resource.Resource().Attributes().PutStr("service.name", "span-event-regression")
			spans := resource.ScopeSpans().AppendEmpty().Spans()
			now := pcommon.NewTimestampFromTime(time.Now())
			for i, name := range []string{"control", "worker"} {
				span := spans.AppendEmpty()
				span.SetTraceID(pcommon.TraceID{1})
				span.SetSpanID(pcommon.SpanID{byte(i + 1)})
				span.SetName(name)
				span.SetStartTimestamp(now)
				span.SetEndTimestamp(now + 1000000)
			}
			expectedEvents, expectedLinks := `[]`, `[]`
			switch kind {
			case "empty event", "attributed event":
				event := spans.At(1).Events().AppendEmpty()
				event.SetName("job completed")
				event.SetTimestamp(now)
				expectedEvents = `[{}]`
				if kind == "attributed event" {
					event.Attributes().PutStr("bullmq.job.id", "test-job")
					event.Attributes().PutInt("everr.test.attempt", 42)
					event.Attributes().PutBool("everr.test.completed", true)
					event.Attributes().PutDouble("everr.test.progress", 0.5)
					event.Attributes().PutStr("everr.test.result", `{"ok":true}`)
					event.Attributes().PutEmptySlice("everr.test.tags").AppendEmpty().SetStr("done")
					empty := spans.At(1).Events().AppendEmpty()
					empty.SetName("empty event")
					empty.SetTimestamp(now)
					expectedEvents = `[{"bullmq":{"job":{"id":"test-job"}},"everr":{"test":{"attempt":42,"completed":true,"progress":0.5,"result":"{\"ok\":true}","tags":["done"]}}},{}]`
				}
			case "empty link", "attributed link":
				link := spans.At(1).Links().AppendEmpty()
				link.SetTraceID(pcommon.TraceID{2})
				link.SetSpanID(pcommon.SpanID{3})
				expectedLinks = `[{}]`
				if kind == "attributed link" {
					link.Attributes().PutStr("everr.test.id", "test-link")
					link.Attributes().PutInt("everr.test.attempt", 42)
					empty := spans.At(1).Links().AppendEmpty()
					empty.SetTraceID(pcommon.TraceID{4})
					empty.SetSpanID(pcommon.SpanID{5})
					expectedLinks = `[{"everr":{"test":{"id":"test-link","attempt":42}}},{}]`
				}
			}
			require.NoError(t, exporter.pushTraceData(t.Context(), td))
			var count string
			require.NoError(t, db.QueryRow(t.Context(), `SELECT toString(count()) AS name FROM traces`).Scan(&count))
			require.Equal(t, "2", count, "an event must not discard other spans in the batch")
			for column, expected := range map[string]string{
				"Events.Attributes": expectedEvents,
				"Links.Attributes":  expectedLinks,
			} {
				var actual string
				require.NoError(t, db.QueryRow(t.Context(), "SELECT toJSONString(`"+column+"`) AS name FROM traces WHERE SpanName = 'worker'").Scan(&actual))
				require.JSONEq(t, expected, actual, column)
			}
		})
	}
}
