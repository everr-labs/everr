// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package metrics // import "github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metrics"

import (
	"fmt"

	"go.opentelemetry.io/collector/pdata/pmetric"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/landing"
)

func appendExponentialHistogram(batch *landing.Batch, metadata MetricsMetaData, metric pmetric.Metric) error {
	resAttr := AttributesToMap(metadata.ResAttr)
	scopeAttr := AttributesToMap(metadata.ScopeInstr.Attributes())
	serviceName := internal.GetServiceName(metadata.ResAttr)
	expHistogram := metric.ExponentialHistogram()

	for i := 0; i < expHistogram.DataPoints().Len(); i++ {
		dp := expHistogram.DataPoints().At(i)
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
			dp.Count(),
			dp.Sum(),
			dp.Scale(),
			dp.ZeroCount(),
			dp.Positive().Offset(),
			dp.Positive().BucketCounts().AsRaw(),
			dp.Negative().Offset(),
			dp.Negative().BucketCounts().AsRaw(),
			attrs,
			times,
			values,
			spanIDs,
			traceIDs,
			uint32(dp.Flags()),
			dp.Min(),
			dp.Max(),
			int32(expHistogram.AggregationTemporality()),
		)
		if appendErr != nil {
			return fmt.Errorf("failed to append exponential histogram metric: %w", appendErr)
		}
	}
	return nil
}
