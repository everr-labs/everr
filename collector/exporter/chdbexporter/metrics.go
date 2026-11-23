// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"context"

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
		resAttr.PutStr(retentionAttribute, e.retentionDays)
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

	return rows.Send(ctx, e.handle)
}
