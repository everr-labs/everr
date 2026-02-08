// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package testlogstotraces

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/connector"
	"go.opentelemetry.io/collector/consumer"

	"github.com/get-citric/citric/collector/connector/testlogstotraces/internal/metadata"
)

// NewFactory creates a new testlogstotraces connector factory.
func NewFactory() connector.Factory {
	return connector.NewFactory(
		metadata.Type,
		createDefaultConfig,
		connector.WithLogsToTraces(createLogsToTraces, metadata.LogsToTracesStability),
	)
}

func createDefaultConfig() component.Config {
	return &Config{}
}

func createLogsToTraces(
	_ context.Context,
	set connector.Settings,
	cfg component.Config,
	traces consumer.Traces,
) (connector.Logs, error) {
	return newConnector(set, cfg, traces)
}
