package clickhouseexporter

import (
	"context"
	"fmt"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.uber.org/zap"

	"github.com/everr-labs/chdbexporter/internal"
	"github.com/everr-labs/chdbexporter/internal/sqltemplates"
	"github.com/everr-labs/chdbexporter/internal/traceutil"
)

type logsExporter struct {
	chdbRunner
}

func newLogsExporter(logger *zap.Logger, cfg *Config) *logsExporter {
	return &logsExporter{
		chdbRunner: chdbRunner{cfg: cfg, logger: logger},
	}
}

func (e *logsExporter) start(ctx context.Context, _ component.Host) error {
	return e.exec(ctx, renderCreateLogsTableSQL(e.cfg))
}

func (e *logsExporter) shutdown(context.Context) error {
	return nil
}

func (e *logsExporter) pushLogsData(ctx context.Context, ld plog.Logs) error {
	var rows []map[string]any

	resourceLogs := ld.ResourceLogs()
	for i := 0; i < resourceLogs.Len(); i++ {
		rl := resourceLogs.At(i)
		resourceAttrs := internal.AttributesToMap(rl.Resource().Attributes())
		serviceName := internal.GetServiceName(rl.Resource().Attributes())

		scopeLogs := rl.ScopeLogs()
		for j := 0; j < scopeLogs.Len(); j++ {
			scopeLog := scopeLogs.At(j)
			scope := scopeLog.Scope()
			scopeAttrs := internal.AttributesToMap(scope.Attributes())
			logRecords := scopeLog.LogRecords()

			for k := 0; k < logRecords.Len(); k++ {
				record := logRecords.At(k)
				timestamp := record.Timestamp()
				if timestamp == 0 {
					timestamp = record.ObservedTimestamp()
				}

				rows = append(rows, map[string]any{
					"Timestamp":          formatTimestamp(timestamp.AsTime()),
					"TraceId":            traceutil.TraceIDToHexOrEmptyString(record.TraceID()),
					"SpanId":             traceutil.SpanIDToHexOrEmptyString(record.SpanID()),
					"TraceFlags":         uint8(record.Flags()),
					"SeverityText":       record.SeverityText(),
					"SeverityNumber":     uint8(record.SeverityNumber()),
					"ServiceName":        serviceName,
					"Body":               record.Body().AsString(),
					"ResourceSchemaUrl":  rl.SchemaUrl(),
					"ResourceAttributes": resourceAttrs,
					"ScopeSchemaUrl":     scopeLog.SchemaUrl(),
					"ScopeName":          scope.Name(),
					"ScopeVersion":       scope.Version(),
					"ScopeAttributes":    scopeAttrs,
					"LogAttributes":      internal.AttributesToMap(record.Attributes()),
					"EventName":          record.EventName(),
				})
			}
		}
	}

	return e.insertRows(ctx, e.cfg.logsTableName(), rows)
}

func renderCreateLogsTableSQL(cfg *Config) string {
	ttlExpr := internal.GenerateTTLExpr(cfg.TTL, "TimestampTime")
	return fmt.Sprintf(
		sqltemplates.LogsCreateTable,
		cfg.database(),
		cfg.logsTableName(),
		"",
		"MergeTree()",
		ttlExpr,
	)
}
