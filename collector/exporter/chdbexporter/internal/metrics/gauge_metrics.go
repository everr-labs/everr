// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package metrics // import "github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metrics"

import (
	"fmt"

	"go.opentelemetry.io/collector/pdata/pmetric"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/landing"
)

func appendGauge(batch *landing.Batch, metadata MetricsMetaData, metric pmetric.Metric) error {
	resAttr := AttributesToMap(metadata.ResAttr)
	scopeAttr := AttributesToMap(metadata.ScopeInstr.Attributes())
	serviceName := internal.GetServiceName(metadata.ResAttr)
	gauge := metric.Gauge()

	for i := 0; i < gauge.DataPoints().Len(); i++ {
		dp := gauge.DataPoints().At(i)
		attrs, times, values, traceIDs, spanIDs := convertExemplars(dp.Exemplars())
		appendErr := batch.Append(
			resAttr,
			metadata.ResURL,
			metadata.ScopeInstr.Name(),
			metadata.ScopeInstr.Version(),
			scopeAttr,
			metadata.ScopeInstr.DroppedAttributesCount(),
			metadata.ScopeURL,
			serviceName,
			metric.Name(),
			metric.Description(),
			metric.Unit(),
			AttributesToMap(dp.Attributes()),
			dp.StartTimestamp().AsTime(),
			dp.Timestamp().AsTime(),
			getValue(dp.IntValue(), dp.DoubleValue(), dp.ValueType()),
			uint32(dp.Flags()),
			attrs,
			times,
			values,
			spanIDs,
			traceIDs,
		)
		if appendErr != nil {
			return fmt.Errorf("failed to append gauge metric: %w", appendErr)
		}
	}
	return nil
}
