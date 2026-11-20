// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package chdbexporter // import "github.com/everr-labs/everr/collector/exporter/chdbexporter"

import (
	"context"
	"errors"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal"
	"github.com/everr-labs/everr/collector/exporter/chdbexporter/internal/metrics"
)

type metricsExporter struct {
	db    driver.Conn
	store *store

	logger       *zap.Logger
	cfg          *Config
	tablesConfig metrics.MetricTablesConfigMapper
}

func newMetricsExporter(logger *zap.Logger, cfg *Config, stores ...*store) *metricsExporter {
	tablesConfig := generateMetricTablesConfigMapper(cfg)
	st := storeOf(stores)
	st.register(cfg)

	return &metricsExporter{
		logger:       logger,
		cfg:          cfg,
		store:        st,
		tablesConfig: tablesConfig,
	}
}

func (e *metricsExporter) start(ctx context.Context, _ component.Host) error {
	metrics.SetLogger(e.logger)

	db, err := internal.NewChDBConn(e.store.handle)
	if err != nil {
		return err
	}
	e.db = db

	if e.cfg.shouldCreateSchema() {
		database := e.cfg.database()
		if err := internal.CreateDatabase(ctx, e.db, database, e.cfg.clusterString(), e.cfg.databaseEngineString()); err != nil {
			return err
		}

		if err := e.store.ensureLocalSchema(ctx, e.db, e.cfg, e.logger); err != nil {
			return err
		}

		ttlExpr := internal.GenerateTTLExpr(e.cfg.TTL, "toDateTime(TimeUnix)")
		err := metrics.NewMetricsTable(ctx, e.tablesConfig, database, e.cfg.tableClusterString(), e.cfg.tableEngineString(), ttlExpr, e.db)
		if err != nil {
			return err
		}
	}

	return nil
}

func generateMetricTablesConfigMapper(cfg *Config) metrics.MetricTablesConfigMapper {
	return metrics.MetricTablesConfigMapper{
		pmetric.MetricTypeGauge:                cfg.MetricsTables.Gauge,
		pmetric.MetricTypeSum:                  cfg.MetricsTables.Sum,
		pmetric.MetricTypeSummary:              cfg.MetricsTables.Summary,
		pmetric.MetricTypeHistogram:            cfg.MetricsTables.Histogram,
		pmetric.MetricTypeExponentialHistogram: cfg.MetricsTables.ExponentialHistogram,
	}
}

// shutdown will shut down the exporter.
func (e *metricsExporter) shutdown(_ context.Context) error {
	if e.db != nil {
		return e.db.Close()
	}

	return nil
}

func (e *metricsExporter) pushMetricsData(ctx context.Context, md pmetric.Metrics) error {
	metricsMap := metrics.NewMetricsModel(e.tablesConfig, e.cfg.database())
	for i := 0; i < md.ResourceMetrics().Len(); i++ {
		metrics := md.ResourceMetrics().At(i)
		resAttr := metrics.Resource().Attributes()
		for j := 0; j < metrics.ScopeMetrics().Len(); j++ {
			rs := metrics.ScopeMetrics().At(j).Metrics()
			scopeInstr := metrics.ScopeMetrics().At(j).Scope()
			scopeURL := metrics.ScopeMetrics().At(j).SchemaUrl()
			for k := 0; k < rs.Len(); k++ {
				r := rs.At(k)
				if r.Type() == pmetric.MetricTypeEmpty {
					return errors.New("metrics type is unset")
				}
				m, ok := metricsMap[r.Type()]
				if !ok {
					return errors.New("unsupported metrics type")
				}
				m.Add(resAttr, metrics.SchemaUrl(), scopeInstr, scopeURL, r)
			}
		}
	}

	return metrics.InsertMetrics(ctx, e.db, metricsMap)
}
