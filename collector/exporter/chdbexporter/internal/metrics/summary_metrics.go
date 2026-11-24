// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package metrics // import "github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metrics"

import (
	"fmt"

	"go.opentelemetry.io/collector/pdata/pmetric"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/landing"
)

func appendSummary(batch *landing.Batch, metadata MetricsMetaData, metric pmetric.Metric) error {
	resAttr := AttributesToMap(metadata.ResAttr)
	scopeAttr := AttributesToMap(metadata.ScopeInstr.Attributes())
	serviceName := internal.GetServiceName(metadata.ResAttr)
	summary := metric.Summary()

	for i := 0; i < summary.DataPoints().Len(); i++ {
		dp := summary.DataPoints().At(i)
		quantiles, values := convertValueAtQuantile(dp.QuantileValues())
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
			quantiles,
			values,
			uint32(dp.Flags()),
		)
		if appendErr != nil {
			return fmt.Errorf("failed to append summary metric: %w", appendErr)
		}
	}
	return nil
}
