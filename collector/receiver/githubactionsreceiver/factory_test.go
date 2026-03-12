// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package githubactionsreceiver

import (
	"context"
	"testing"

	"github.com/everr-labs/everr/collector/receiver/githubactionsreceiver/internal/metadata"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/consumer/consumertest"
	"go.opentelemetry.io/collector/receiver/receivertest"
)

func TestFactoryCreate(t *testing.T) {
	factory := NewFactory()
	require.EqualValues(t, "githubactions", factory.Type().String())
}

func TestDefaultConfig(t *testing.T) {
	cfg := createDefaultConfig()
	require.NotNil(t, cfg, "Failed to create default configuration")
}

func TestCreateTracesReceiver(t *testing.T) {
	tests := []struct {
		desc string
		run  func(t *testing.T)
	}{
		{
			desc: "Defaults with valid inputs",
			run: func(t *testing.T) {
				t.Parallel()

				cfg := createDefaultConfig().(*Config)
				cfg.ServerConfig.NetAddr.Endpoint = "localhost:8080"
				cfg.GitHubAPIConfig.Auth.AppID = 1
				cfg.GitHubAPIConfig.Auth.PrivateKeyPath = "/path/to/key.pem"
				require.NoError(t, cfg.Validate(), "error validating default config")

				rcvr, err := newTracesReceiver(
					context.Background(),
					receivertest.NewNopSettings(metadata.Type),
					cfg,
					consumertest.NewNop(),
				)
				require.NoError(t, err, "failed to create trace receiver")
				require.NoError(t, rcvr.Shutdown(context.Background()))
			},
		},
	}

	for _, test := range tests {
		t.Run(test.desc, test.run)
	}
}

func TestCreateMetricsReceiver(t *testing.T) {
	cfg := createDefaultConfig().(*Config)
	cfg.ServerConfig.NetAddr.Endpoint = "localhost:8081"
	cfg.GitHubAPIConfig.Auth.AppID = 1
	cfg.GitHubAPIConfig.Auth.PrivateKeyPath = "/path/to/key.pem"
	require.NoError(t, cfg.Validate(), "error validating default config")

	rcvr, err := newMetricsReceiver(
		context.Background(),
		receivertest.NewNopSettings(metadata.Type),
		cfg,
		consumertest.NewNop(),
	)
	require.NoError(t, err, "failed to create metrics receiver")
	require.NoError(t, rcvr.Shutdown(context.Background()))
}
