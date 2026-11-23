// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"context"
	"slices"

	"go.opentelemetry.io/collector/consumer/consumererror"
	"go.opentelemetry.io/collector/pdata/pmetric"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metrics"
	"github.com/everr-labs/everr/collector/internal/localgateway/chdb"
)

type metricsExporter struct {
	handle        *chdb.Handle
	retentionDays string
}

func (e *metricsExporter) pushMetricsData(ctx context.Context, md pmetric.Metrics) error {
	rows := metrics.NewRows()
	for i := 0; i < md.ResourceMetrics().Len(); i++ {
		resourceMetrics := md.ResourceMetrics().At(i)
		resAttr := resourceMetrics.Resource().Attributes()
		stampRetention(resAttr, e.retentionDays)
		for j := 0; j < resourceMetrics.ScopeMetrics().Len(); j++ {
			scopeMetrics := resourceMetrics.ScopeMetrics().At(j)
			metadata := metrics.MetricsMetaData{
				ResAttr:    resAttr,
				ResURL:     resourceMetrics.SchemaUrl(),
				ScopeURL:   scopeMetrics.SchemaUrl(),
				ScopeInstr: scopeMetrics.Scope(),
			}
			rs := scopeMetrics.Metrics()
			for k := 0; k < rs.Len(); k++ {
				if err := rows.Add(metadata, rs.At(k)); err != nil {
					return err
				}
			}
		}
	}

	failed, err := rows.Send(ctx, e.handle)
	if err != nil {
		return consumererror.NewMetrics(err, keepKinds(md, failed))
	}
	return nil
}

// keepKinds removes from md every metric of a kind that landed. Each kind is
// one insert, so the retry that resends what is left inserts no row twice.
func keepKinds(md pmetric.Metrics, kinds []pmetric.MetricType) pmetric.Metrics {
	md.ResourceMetrics().RemoveIf(func(resource pmetric.ResourceMetrics) bool {
		resource.ScopeMetrics().RemoveIf(func(scope pmetric.ScopeMetrics) bool {
			scope.Metrics().RemoveIf(func(metric pmetric.Metric) bool {
				return !slices.Contains(kinds, metric.Type())
			})
			return scope.Metrics().Len() == 0
		})
		return resource.ScopeMetrics().Len() == 0
	})
	return md
}
