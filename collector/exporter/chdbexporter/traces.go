// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"go.opentelemetry.io/collector/pdata/ptrace"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/landing"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

type tracesExporter struct {
	handle        *chdb.Handle
	retentionDays string
}

func (e *tracesExporter) pushTraceData(ctx context.Context, td ptrace.Traces) error {
	batch := landing.NewBatch(landing.Traces)

	rsSpans := td.ResourceSpans()
	rsLen := rsSpans.Len()
	for i := range rsLen {
		spans := rsSpans.At(i)
		res := spans.Resource()
		resAttr := res.Attributes()
		resAttr.PutStr(retentionAttribute, e.retentionDays)
		serviceName := internal.GetServiceName(resAttr)
		resAttrBytes, resAttrErr := internal.AttributesJSON(resAttr)
		if resAttrErr != nil {
			return fmt.Errorf("failed to marshal json trace resource attributes: %w", resAttrErr)
		}

		resAttrKeys := internal.UniqueFlattenedAttributes(resAttr)

		ssRootLen := spans.ScopeSpans().Len()
		for j := range ssRootLen {
			scopeSpanRoot := spans.ScopeSpans().At(j)
			scopeSpanScope := scopeSpanRoot.Scope()
			scopeName := scopeSpanScope.Name()
			scopeVersion := scopeSpanScope.Version()
			scopeSpans := scopeSpanRoot.Spans()

			ssLen := scopeSpans.Len()
			for k := range ssLen {
				span := scopeSpans.At(k)
				spanStatus := span.Status()
				spanDurationNanos := span.EndTimestamp() - span.StartTimestamp()
				spanAttr := span.Attributes()
				spanAttrBytes, spanAttrErr := internal.AttributesJSON(spanAttr)
				if spanAttrErr != nil {
					return fmt.Errorf("failed to marshal json trace span attributes: %w", spanAttrErr)
				}

				eventTimes, eventNames, eventAttrs, eventsErr := convertEventsJSON(span.Events())
				if eventsErr != nil {
					return fmt.Errorf("failed to convert json trace events: %w", eventsErr)
				}
				linksTraceIDs, linksSpanIDs, linksTraceStates, linksAttrs, linksErr := convertLinksJSON(span.Links())
				if linksErr != nil {
					return fmt.Errorf("failed to convert json trace links: %w", linksErr)
				}

				appendErr := batch.Append(
					span.StartTimestamp().AsTime(),
					span.TraceID().String(),
					span.SpanID().String(),
					span.ParentSpanID().String(),
					span.TraceState().AsRaw(),
					span.Name(),
					span.Kind().String(),
					serviceName,
					resAttrBytes,
					scopeName,
					scopeVersion,
					spanAttrBytes,
					spanDurationNanos,
					spanStatus.Code().String(),
					spanStatus.Message(),
					eventTimes,
					eventNames,
					eventAttrs,
					linksTraceIDs,
					linksSpanIDs,
					linksTraceStates,
					linksAttrs,
					resAttrKeys,
					internal.UniqueFlattenedAttributes(spanAttr),
				)
				if appendErr != nil {
					return fmt.Errorf("failed to append json trace row: %w", appendErr)
				}
			}
		}
	}

	if sendErr := batch.Send(ctx, e.handle); sendErr != nil {
		return fmt.Errorf("traces json insert failed: %w", sendErr)
	}

	return nil
}

func convertEventsJSON(events ptrace.SpanEventSlice) (times []time.Time, names []string, attrs []json.RawMessage, err error) {
	n := events.Len()
	if n == 0 {
		return nil, nil, nil, nil
	}
	times = make([]time.Time, 0, n)
	names = make([]string, 0, n)
	attrs = make([]json.RawMessage, 0, n)
	for i := range n {
		event := events.At(i)
		times = append(times, event.Timestamp().AsTime())
		names = append(names, event.Name())

		eventAttrBytes, eventAttrErr := internal.AttributesJSON(event.Attributes())
		if eventAttrErr != nil {
			return nil, nil, nil, fmt.Errorf("failed to marshal json trace event attributes: %w", eventAttrErr)
		}
		attrs = append(attrs, eventAttrBytes)
	}

	return times, names, attrs, nil
}

func convertLinksJSON(links ptrace.SpanLinkSlice) (traceIDs, spanIDs, states []string, attrs []json.RawMessage, err error) {
	n := links.Len()
	if n == 0 {
		return nil, nil, nil, nil, nil
	}
	traceIDs = make([]string, 0, n)
	spanIDs = make([]string, 0, n)
	states = make([]string, 0, n)
	attrs = make([]json.RawMessage, 0, n)
	for i := range n {
		link := links.At(i)
		traceIDs = append(traceIDs, link.TraceID().String())
		spanIDs = append(spanIDs, link.SpanID().String())
		states = append(states, link.TraceState().AsRaw())

		linkAttrBytes, linkAttrErr := internal.AttributesJSON(link.Attributes())
		if linkAttrErr != nil {
			return nil, nil, nil, nil, fmt.Errorf("failed to marshal json trace link attributes: %w", linkAttrErr)
		}
		attrs = append(attrs, linkAttrBytes)
	}

	return traceIDs, spanIDs, states, attrs, nil
}
