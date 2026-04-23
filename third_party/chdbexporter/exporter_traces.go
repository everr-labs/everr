package clickhouseexporter

import (
	"context"
	"fmt"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.uber.org/zap"

	"github.com/everr-labs/chdbexporter/internal"
	"github.com/everr-labs/chdbexporter/internal/sqltemplates"
	"github.com/everr-labs/chdbexporter/internal/traceutil"
)

type tracesExporter struct {
	chdbRunner
}

func newTracesExporter(logger *zap.Logger, cfg *Config) *tracesExporter {
	return &tracesExporter{
		chdbRunner: chdbRunner{cfg: cfg, logger: logger},
	}
}

func (e *tracesExporter) start(ctx context.Context, _ component.Host) error {
	return e.execAll(
		ctx,
		renderCreateTracesTableSQL(e.cfg),
		renderCreateTraceIDTsTableSQL(e.cfg),
		renderTraceIDTsMaterializedViewSQL(e.cfg),
	)
}

func (e *tracesExporter) shutdown(context.Context) error {
	return nil
}

func (e *tracesExporter) pushTraceData(ctx context.Context, td ptrace.Traces) error {
	var rows []map[string]any

	resourceSpans := td.ResourceSpans()
	for i := 0; i < resourceSpans.Len(); i++ {
		rs := resourceSpans.At(i)
		resourceAttrs := internal.AttributesToMap(rs.Resource().Attributes())
		serviceName := internal.GetServiceName(rs.Resource().Attributes())

		scopeSpans := rs.ScopeSpans()
		for j := 0; j < scopeSpans.Len(); j++ {
			scopeSpansItem := scopeSpans.At(j)
			scope := scopeSpansItem.Scope()
			spans := scopeSpansItem.Spans()

			for k := 0; k < spans.Len(); k++ {
				span := spans.At(k)
				duration := uint64(0)
				if span.EndTimestamp() >= span.StartTimestamp() {
					duration = uint64(span.EndTimestamp() - span.StartTimestamp())
				}

				eventTimes, eventNames, eventAttrs := convertEvents(span.Events())
				linkTraceIDs, linkSpanIDs, linkTraceStates, linkAttrs := convertLinks(span.Links())

				rows = append(rows, map[string]any{
					"Timestamp":         formatTimestamp(span.StartTimestamp().AsTime()),
					"TraceId":           traceutil.TraceIDToHexOrEmptyString(span.TraceID()),
					"SpanId":            traceutil.SpanIDToHexOrEmptyString(span.SpanID()),
					"ParentSpanId":      traceutil.SpanIDToHexOrEmptyString(span.ParentSpanID()),
					"TraceState":        span.TraceState().AsRaw(),
					"SpanName":          span.Name(),
					"SpanKind":          traceutil.SpanKindStr(span.Kind()),
					"ServiceName":       serviceName,
					"ResourceAttributes": resourceAttrs,
					"ScopeName":         scope.Name(),
					"ScopeVersion":      scope.Version(),
					"SpanAttributes":    internal.AttributesToMap(span.Attributes()),
					"Duration":          duration,
					"StatusCode":        traceutil.StatusCodeStr(span.Status().Code()),
					"StatusMessage":     span.Status().Message(),
					"Events.Timestamp":  eventTimes,
					"Events.Name":       eventNames,
					"Events.Attributes": eventAttrs,
					"Links.TraceId":     linkTraceIDs,
					"Links.SpanId":      linkSpanIDs,
					"Links.TraceState":  linkTraceStates,
					"Links.Attributes":  linkAttrs,
				})
			}
		}
	}

	return e.insertRows(ctx, e.cfg.tracesTableName(), rows)
}

func convertEvents(events ptrace.SpanEventSlice) ([]string, []string, []map[string]string) {
	times := make([]string, 0, events.Len())
	names := make([]string, 0, events.Len())
	attrs := make([]map[string]string, 0, events.Len())
	for i := 0; i < events.Len(); i++ {
		event := events.At(i)
		times = append(times, formatTimestamp(event.Timestamp().AsTime()))
		names = append(names, event.Name())
		attrs = append(attrs, internal.AttributesToMap(event.Attributes()))
	}
	return times, names, attrs
}

func convertLinks(links ptrace.SpanLinkSlice) ([]string, []string, []string, []map[string]string) {
	traceIDs := make([]string, 0, links.Len())
	spanIDs := make([]string, 0, links.Len())
	traceStates := make([]string, 0, links.Len())
	attrs := make([]map[string]string, 0, links.Len())
	for i := 0; i < links.Len(); i++ {
		link := links.At(i)
		traceIDs = append(traceIDs, traceutil.TraceIDToHexOrEmptyString(link.TraceID()))
		spanIDs = append(spanIDs, traceutil.SpanIDToHexOrEmptyString(link.SpanID()))
		traceStates = append(traceStates, link.TraceState().AsRaw())
		attrs = append(attrs, internal.AttributesToMap(link.Attributes()))
	}
	return traceIDs, spanIDs, traceStates, attrs
}

func renderCreateTracesTableSQL(cfg *Config) string {
	ttlExpr := internal.GenerateTTLExpr(cfg.TTL, "toDateTime(Timestamp)")
	return fmt.Sprintf(
		sqltemplates.TracesCreateTable,
		cfg.database(),
		cfg.tracesTableName(),
		"",
		"MergeTree()",
		ttlExpr,
	)
}

func renderCreateTraceIDTsTableSQL(cfg *Config) string {
	ttlExpr := internal.GenerateTTLExpr(cfg.TTL, "toDateTime(Start)")
	return fmt.Sprintf(
		sqltemplates.TracesCreateTsTable,
		cfg.database(),
		cfg.tracesTableName(),
		"",
		"MergeTree()",
		ttlExpr,
	)
}

func renderTraceIDTsMaterializedViewSQL(cfg *Config) string {
	database := cfg.database()
	table := cfg.tracesTableName()
	return fmt.Sprintf(sqltemplates.TracesCreateTsView, database, table, "", database, table, database, table)
}
