// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/sqltemplates"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

// The local collector has no routing connector. Recording Segments are logs
// with this event name, and the JSON exporter writes them to their own table.
const (
	recordingsTableName       = "recordings"
	recordingSegmentEventName = "everr.browser.recording.segment"
)

// anyLogsExporter is an interface that satisfies both the default map logsExporter and the logsJSONExporter
type anyLogsExporter interface {
	start(context.Context, component.Host) error
	shutdown(context.Context) error
	pushLogsData(context.Context, plog.Logs) error
}

type logsJSONExporter struct {
	cfg                 *Config
	logger              *zap.Logger
	db                  driver.Conn
	handle              *chdb.Handle
	insertSQL           string
	recordingsInsertSQL string
	schemaFeatures      struct {
		AttributeKeys bool
		EventName     bool
	}
}

func newLogsJSONExporter(logger *zap.Logger, cfg *Config, handles ...*chdb.Handle) *logsJSONExporter {
	var handle *chdb.Handle
	if len(handles) > 0 {
		handle = handles[0]
	}
	return &logsJSONExporter{
		cfg:    cfg,
		logger: logger,
		handle: handle,
	}
}

func (e *logsJSONExporter) start(ctx context.Context, _ component.Host) error {
	db, err := internal.NewChDBConn(e.handle)
	if err != nil {
		return err
	}
	e.db = db

	if e.cfg.shouldCreateSchema() {
		if createDBErr := internal.CreateDatabase(ctx, e.db, e.cfg.database(), e.cfg.clusterString()); createDBErr != nil {
			return createDBErr
		}

		if fnErr := internal.CreateErrorFingerprintFunction(ctx, e.db); fnErr != nil {
			return fnErr
		}

		if schemaErr := ensureLocalSchema(ctx, e.db, e.cfg, e.logger); schemaErr != nil {
			return schemaErr
		}
		if createTableErr := createLogsJSONTable(ctx, e.cfg, e.db); createTableErr != nil {
			return createTableErr
		}
		if createTableErr := createRecordingsTable(ctx, e.cfg, e.db); createTableErr != nil {
			return createTableErr
		}
	}

	err = e.detectSchemaFeatures(ctx)
	if err != nil {
		e.logger.Error("schema detection failed", zap.Error(err))
	}

	if err := e.renderInsertLogsJSONSQL(); err != nil {
		return fmt.Errorf("render logs json insert sql: %w", err)
	}
	if err := e.renderInsertRecordingsSQL(); err != nil {
		return fmt.Errorf("render recordings insert sql: %w", err)
	}

	return nil
}

const (
	logsJSONColumnResourceAttributesKeys = "ResourceAttributesKeys"
	logsJSONColumnScopeAttributesKeys    = "ScopeAttributesKeys"
	logsJSONColumnLogAttributesKeys      = "LogAttributesKeys"
	logsJSONColumnEventName              = "EventName"
)

func (e *logsJSONExporter) detectSchemaFeatures(ctx context.Context) error {
	columnNames, err := internal.GetTableColumns(ctx, e.db, e.cfg.database(), e.cfg.LogsTableName)
	if err != nil {
		return err
	}

	for _, name := range columnNames {
		switch name {
		case logsJSONColumnResourceAttributesKeys:
			e.schemaFeatures.AttributeKeys = true
		case logsJSONColumnScopeAttributesKeys:
			e.schemaFeatures.AttributeKeys = true
		case logsJSONColumnLogAttributesKeys:
			e.schemaFeatures.AttributeKeys = true
		case logsJSONColumnEventName:
			e.schemaFeatures.EventName = true
		}
	}

	return nil
}

func (e *logsJSONExporter) shutdown(_ context.Context) error {
	if e.db != nil {
		if err := e.db.Close(); err != nil {
			e.logger.Warn("failed to close json logs db connection", zap.Error(err))
			return err
		}
	}

	return nil
}

func (e *logsJSONExporter) pushLogsData(ctx context.Context, ld plog.Logs) error {
	rest, segments := splitRecordingSegments(ld)
	// A batch with no Segments keeps the previous logs insert, including an
	// empty batch. A batch that is only Segments does not open a logs insert.
	if segments.LogRecordCount() == 0 {
		return e.insertLogsJSON(ctx, ld)
	}
	if rest.LogRecordCount() > 0 {
		if err := e.insertLogsJSON(ctx, rest); err != nil {
			return err
		}
	}
	return e.insertRecordings(ctx, segments)
}

func (e *logsJSONExporter) insertLogsJSON(ctx context.Context, ld plog.Logs) error {
	batch, err := e.db.PrepareBatch(ctx, e.insertSQL)
	if err != nil {
		return err
	}
	defer func(batch driver.Batch) {
		closeErr := batch.Close()
		if closeErr != nil {
			e.logger.Warn("failed to close json logs batch", zap.Error(closeErr))
		}
	}(batch)

	processStart := time.Now()

	var logCount int
	rsLogs := ld.ResourceLogs()
	rsLen := rsLogs.Len()
	for i := range rsLen {
		logs := rsLogs.At(i)
		res := logs.Resource()
		resURL := logs.SchemaUrl()
		resAttr := res.Attributes()
		serviceName := internal.GetServiceName(resAttr)
		resAttrBytes, resAttrErr := json.Marshal(resAttr.AsRaw())
		if resAttrErr != nil {
			return fmt.Errorf("failed to marshal json log resource attributes: %w", resAttrErr)
		}

		var resAttrKeys []string
		if e.schemaFeatures.AttributeKeys {
			resAttrKeys = internal.UniqueFlattenedAttributes(resAttr)
		}

		slLen := logs.ScopeLogs().Len()
		for j := range slLen {
			scopeLog := logs.ScopeLogs().At(j)
			scopeURL := scopeLog.SchemaUrl()
			scopeLogScope := scopeLog.Scope()
			scopeName := scopeLogScope.Name()
			scopeVersion := scopeLogScope.Version()
			scopeLogRecords := scopeLog.LogRecords()
			scopeAttr := scopeLogScope.Attributes()
			scopeAttrBytes, scopeAttrErr := json.Marshal(scopeAttr.AsRaw())
			if scopeAttrErr != nil {
				return fmt.Errorf("failed to marshal json log scope attributes: %w", scopeAttrErr)
			}

			var scopeAttrKeys []string
			if e.schemaFeatures.AttributeKeys {
				scopeAttrKeys = internal.UniqueFlattenedAttributes(scopeAttr)
			}

			slrLen := scopeLogRecords.Len()
			for k := range slrLen {
				r := scopeLogRecords.At(k)
				logAttr := r.Attributes()
				logAttrBytes, logAttrErr := json.Marshal(logAttr.AsRaw())
				if logAttrErr != nil {
					return fmt.Errorf("failed to marshal json log attributes: %w", logAttrErr)
				}

				timestamp := r.Timestamp()
				if timestamp == 0 {
					timestamp = r.ObservedTimestamp()
				}

				columnValues := make([]any, 0, 19)
				columnValues = append(columnValues,
					timestamp.AsTime(),
					r.TraceID().String(),
					r.SpanID().String(),
					uint8(r.Flags()),
					r.SeverityText(),
					uint8(r.SeverityNumber()),
					serviceName,
					r.Body().AsString(),
					resURL,
					resAttrBytes,
					scopeURL,
					scopeName,
					scopeVersion,
					scopeAttrBytes,
					logAttrBytes,
				)

				if e.schemaFeatures.AttributeKeys {
					logAttrKeys := internal.UniqueFlattenedAttributes(logAttr)
					columnValues = append(columnValues, resAttrKeys, scopeAttrKeys, logAttrKeys)
				}

				if e.schemaFeatures.EventName {
					columnValues = append(columnValues, r.EventName())
				}

				appendErr := batch.Append(columnValues...)
				if appendErr != nil {
					return fmt.Errorf("failed to append json log row: %w", appendErr)
				}

				logCount++
			}
		}
	}

	processDuration := time.Since(processStart)
	networkStart := time.Now()
	if sendErr := batch.Send(); sendErr != nil {
		return fmt.Errorf("logs json insert failed: %w", sendErr)
	}

	networkDuration := time.Since(networkStart)
	totalDuration := time.Since(processStart)
	e.logger.Debug("insert json logs",
		zap.Int("records", logCount),
		zap.String("process_cost", processDuration.String()),
		zap.String("network_cost", networkDuration.String()),
		zap.String("total_cost", totalDuration.String()))

	return nil
}

func (e *logsJSONExporter) renderInsertLogsJSONSQL() error {
	var featureColumnNames strings.Builder
	var featureColumnPositions strings.Builder

	if e.schemaFeatures.AttributeKeys {
		featureColumnNames.WriteString(", ")
		featureColumnNames.WriteString(logsJSONColumnResourceAttributesKeys)
		featureColumnNames.WriteString(", ")
		featureColumnNames.WriteString(logsJSONColumnScopeAttributesKeys)
		featureColumnNames.WriteString(", ")
		featureColumnNames.WriteString(logsJSONColumnLogAttributesKeys)

		featureColumnPositions.WriteString(", ?, ?, ?")
	}

	if e.schemaFeatures.EventName {
		featureColumnNames.WriteString(", ")
		featureColumnNames.WriteString(logsJSONColumnEventName)

		featureColumnPositions.WriteString(", ?")
	}

	data := sqltemplates.InsertData{
		Database:               e.cfg.database(),
		TableName:              e.cfg.LogsTableName,
		FeatureColumnNames:     featureColumnNames.String(),
		FeatureColumnPositions: featureColumnPositions.String(),
	}

	var buf bytes.Buffer
	if err := sqltemplates.LogsJSONInsertTmpl.Execute(&buf, data); err != nil {
		return fmt.Errorf("execute logs json insert template: %w", err)
	}

	e.insertSQL = buf.String()
	return nil
}

func (e *logsJSONExporter) renderInsertRecordingsSQL() error {
	data := sqltemplates.InsertData{
		Database:  e.cfg.database(),
		TableName: recordingsTableName,
	}

	var buf bytes.Buffer
	if err := sqltemplates.RecordingsJSONInsertTmpl.Execute(&buf, data); err != nil {
		return fmt.Errorf("execute recordings insert template: %w", err)
	}

	e.recordingsInsertSQL = buf.String()
	return nil
}

func (e *logsJSONExporter) insertRecordings(ctx context.Context, ld plog.Logs) error {
	batch, err := e.db.PrepareBatch(ctx, e.recordingsInsertSQL)
	if err != nil {
		return err
	}
	defer func(batch driver.Batch) {
		closeErr := batch.Close()
		if closeErr != nil {
			e.logger.Warn("failed to close recordings batch", zap.Error(closeErr))
		}
	}(batch)

	rsLogs := ld.ResourceLogs()
	for i := range rsLogs.Len() {
		logs := rsLogs.At(i)
		res := logs.Resource()
		resURL := logs.SchemaUrl()
		resAttr := res.Attributes()
		serviceName := internal.GetServiceName(resAttr)
		resAttrBytes, resAttrErr := json.Marshal(resAttr.AsRaw())
		if resAttrErr != nil {
			return fmt.Errorf("failed to marshal recording resource attributes: %w", resAttrErr)
		}
		resAttrKeys := internal.UniqueFlattenedAttributes(resAttr)

		for j := range logs.ScopeLogs().Len() {
			scopeLog := logs.ScopeLogs().At(j)
			scopeURL := scopeLog.SchemaUrl()
			scopeLogScope := scopeLog.Scope()
			scopeName := scopeLogScope.Name()
			scopeVersion := scopeLogScope.Version()
			scopeAttr := scopeLogScope.Attributes()
			scopeAttrBytes, scopeAttrErr := json.Marshal(scopeAttr.AsRaw())
			if scopeAttrErr != nil {
				return fmt.Errorf("failed to marshal recording scope attributes: %w", scopeAttrErr)
			}
			scopeAttrKeys := internal.UniqueFlattenedAttributes(scopeAttr)

			records := scopeLog.LogRecords()
			for k := range records.Len() {
				r := records.At(k)
				logAttr := r.Attributes()
				logAttrBytes, logAttrErr := json.Marshal(logAttr.AsRaw())
				if logAttrErr != nil {
					return fmt.Errorf("failed to marshal recording log attributes: %w", logAttrErr)
				}

				timestamp := r.Timestamp()
				if timestamp == 0 {
					timestamp = r.ObservedTimestamp()
				}

				appendErr := batch.Append(
					timestamp.AsTime(),
					r.TraceID().String(),
					r.SpanID().String(),
					uint8(r.Flags()),
					r.SeverityText(),
					uint8(r.SeverityNumber()),
					serviceName,
					r.Body().AsString(),
					resURL,
					resAttrBytes,
					scopeURL,
					scopeName,
					scopeVersion,
					scopeAttrBytes,
					logAttrBytes,
					resAttrKeys,
					scopeAttrKeys,
					internal.UniqueFlattenedAttributes(logAttr),
					r.EventName(),
					attrString(logAttr, "session.id"),
					attrString(logAttr, "everr.recording.stream.id"),
					attrString(logAttr, "everr.recording.clip.id"),
				)
				if appendErr != nil {
					return fmt.Errorf("failed to append recording row: %w", appendErr)
				}
			}
		}
	}

	if sendErr := batch.Send(); sendErr != nil {
		return fmt.Errorf("recordings insert failed: %w", sendErr)
	}

	return nil
}

// splitRecordingSegments copies each log into one of the two results. The
// source is left unchanged. An empty scope is not copied.
func splitRecordingSegments(src plog.Logs) (rest, segments plog.Logs) {
	rest = plog.NewLogs()
	segments = plog.NewLogs()
	for i := range src.ResourceLogs().Len() {
		rl := src.ResourceLogs().At(i)
		var restRL, segRL plog.ResourceLogs
		restReady, segReady := false, false
		ensure := func(segment bool) plog.ResourceLogs {
			if segment {
				if !segReady {
					segRL = segments.ResourceLogs().AppendEmpty()
					rl.Resource().CopyTo(segRL.Resource())
					segRL.SetSchemaUrl(rl.SchemaUrl())
					segReady = true
				}
				return segRL
			}
			if !restReady {
				restRL = rest.ResourceLogs().AppendEmpty()
				rl.Resource().CopyTo(restRL.Resource())
				restRL.SetSchemaUrl(rl.SchemaUrl())
				restReady = true
			}
			return restRL
		}
		for j := range rl.ScopeLogs().Len() {
			sl := rl.ScopeLogs().At(j)
			var restSL, segSL plog.ScopeLogs
			restScope, segScope := false, false
			ensureScope := func(segment bool) plog.ScopeLogs {
				parent := ensure(segment)
				if segment {
					if !segScope {
						segSL = parent.ScopeLogs().AppendEmpty()
						sl.Scope().CopyTo(segSL.Scope())
						segSL.SetSchemaUrl(sl.SchemaUrl())
						segScope = true
					}
					return segSL
				}
				if !restScope {
					restSL = parent.ScopeLogs().AppendEmpty()
					sl.Scope().CopyTo(restSL.Scope())
					restSL.SetSchemaUrl(sl.SchemaUrl())
					restScope = true
				}
				return restSL
			}
			records := sl.LogRecords()
			for k := range records.Len() {
				rec := records.At(k)
				segment := rec.EventName() == recordingSegmentEventName
				rec.CopyTo(ensureScope(segment).LogRecords().AppendEmpty())
			}
		}
	}
	return rest, segments
}

func attrString(attrs pcommon.Map, key string) string {
	value, ok := attrs.Get(key)
	if !ok {
		return ""
	}
	return value.AsString()
}

func renderCreateLogsJSONTableSQL(cfg *Config) (string, error) {
	ttlExpr := internal.GenerateTTLExpr(cfg.TTL, "toDateTime(Timestamp)")
	data := sqltemplates.CreateTableData{
		Database:      cfg.database(),
		TableName:     cfg.LogsTableName,
		ClusterString: cfg.clusterString(),
		Engine:        cfg.tableEngineString(),
		TTL:           ttlExpr,
	}

	var buf bytes.Buffer
	if err := sqltemplates.LogsJSONCreateTableTmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute logs json create table template: %w", err)
	}

	return buf.String(), nil
}

func createLogsJSONTable(ctx context.Context, cfg *Config, db driver.Conn) error {
	sql, err := renderCreateLogsJSONTableSQL(cfg)
	if err != nil {
		return fmt.Errorf("render create logs json table sql: %w", err)
	}

	if err := db.Exec(ctx, sql); err != nil {
		return fmt.Errorf("exec create logs json table sql: %w", err)
	}

	return nil
}

func renderCreateRecordingsTableSQL(cfg *Config) (string, error) {
	ttlExpr := internal.GenerateTTLExpr(cfg.TTL, "toDateTime(Timestamp)")
	data := sqltemplates.CreateTableData{
		Database:      cfg.database(),
		TableName:     recordingsTableName,
		ClusterString: cfg.clusterString(),
		Engine:        cfg.tableEngineString(),
		TTL:           ttlExpr,
	}

	var buf bytes.Buffer
	if err := sqltemplates.RecordingsJSONCreateTableTmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute recordings create table template: %w", err)
	}

	return buf.String(), nil
}

func createRecordingsTable(ctx context.Context, cfg *Config, db driver.Conn) error {
	sql, err := renderCreateRecordingsTableSQL(cfg)
	if err != nil {
		return fmt.Errorf("render create recordings table sql: %w", err)
	}

	if err := db.Exec(ctx, sql); err != nil {
		return fmt.Errorf("exec create recordings table sql: %w", err)
	}

	return nil
}
