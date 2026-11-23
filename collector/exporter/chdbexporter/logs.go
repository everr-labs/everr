// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"context"
	"encoding/json"
	"fmt"

	"go.opentelemetry.io/collector/pdata/plog"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/landing"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

type logsExporter struct {
	handle        *chdb.Handle
	retentionDays string
}

func (e *logsExporter) pushLogsData(ctx context.Context, ld plog.Logs) error {
	batch := landing.NewBatch(landing.Logs)

	rsLogs := ld.ResourceLogs()
	rsLen := rsLogs.Len()
	for i := range rsLen {
		logs := rsLogs.At(i)
		res := logs.Resource()
		resURL := logs.SchemaUrl()
		resAttr := res.Attributes()
		resAttr.PutStr(retentionAttribute, e.retentionDays)
		serviceName := internal.GetServiceName(resAttr)
		resAttrBytes, resAttrErr := json.Marshal(resAttr.AsRaw())
		if resAttrErr != nil {
			return fmt.Errorf("failed to marshal json log resource attributes: %w", resAttrErr)
		}

		resAttrKeys := internal.UniqueFlattenedAttributes(resAttr)

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

			scopeAttrKeys := internal.UniqueFlattenedAttributes(scopeAttr)

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
					json.RawMessage(resAttrBytes),
					scopeURL,
					scopeName,
					scopeVersion,
					json.RawMessage(scopeAttrBytes),
					json.RawMessage(logAttrBytes),
					resAttrKeys,
					scopeAttrKeys,
					internal.UniqueFlattenedAttributes(logAttr),
					r.EventName(),
				)
				if appendErr != nil {
					return fmt.Errorf("failed to append json log row: %w", appendErr)
				}
			}
		}
	}

	if sendErr := batch.Send(ctx, e.handle); sendErr != nil {
		return fmt.Errorf("logs json insert failed: %w", sendErr)
	}

	return nil
}
