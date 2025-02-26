// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package githubactionsreceiver

import (
	"path/filepath"
	"testing"

	"github.com/Elfo404/cicdo11y/collector/receiver/githubactionsreceiver/internal/metadata"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/confighttp"
	"go.opentelemetry.io/collector/confmap/confmaptest"
	"go.opentelemetry.io/collector/confmap/xconfmap"
)

// only one validate check so far
func TestValidateConfig(t *testing.T) {
	t.Parallel()

	tests := []struct {
		desc   string
		expect error
		conf   Config
	}{
		{
			desc:   "Missing valid endpoint",
			expect: errMissingEndpointFromConfig,
			conf: Config{
				ServerConfig: confighttp.ServerConfig{
					Endpoint: "",
				},
			},
		},
		{
			desc:   "Valid Secret",
			expect: nil,
			conf: Config{
				ServerConfig: confighttp.ServerConfig{
					Endpoint: "localhost:8080",
				},
				Secret: "mysecret",
			},
		},
		{
			desc:   "Auth method",
			expect: errAuthMethod,
			conf: Config{
				ServerConfig: confighttp.ServerConfig{
					Endpoint: "localhost:8080",
				},
				GitHubAPIConfig: GitHubAPIConfig{
					Auth: GitHubAPIAuthConfig{
						AppID:          1,
						InstallationID: 1,
						PrivateKeyPath: "path",
						Token:          "token",
					},
				},
			},
		},
		{
			desc:   "GH App Auth > Missing App ID",
			expect: errMissingAppID,
			conf: Config{
				ServerConfig: confighttp.ServerConfig{
					Endpoint: "localhost:8080",
				},
				GitHubAPIConfig: GitHubAPIConfig{
					Auth: GitHubAPIAuthConfig{
						InstallationID: 1,
						PrivateKeyPath: "path",
					},
				},
			},
		},
		{
			desc:   "GH App Auth > Missing Installation ID",
			expect: errMissingInstallationID,
			conf: Config{
				ServerConfig: confighttp.ServerConfig{
					Endpoint: "localhost:8080",
				},
				GitHubAPIConfig: GitHubAPIConfig{
					Auth: GitHubAPIAuthConfig{
						AppID:          1,
						PrivateKeyPath: "path",
					},
				},
			},
		},
		{
			desc:   "GH App Auth > Missing Private Key Path",
			expect: errMissingPrivateKeyPath,
			conf: Config{
				ServerConfig: confighttp.ServerConfig{
					Endpoint: "localhost:8080",
				},
				GitHubAPIConfig: GitHubAPIConfig{
					Auth: GitHubAPIAuthConfig{
						AppID:          1,
						InstallationID: 1,
					},
				},
			},
		},
		{
			desc:   "GH App Auth > Both BaseURL and UploadURL must be set if one is set > Missing BaseURL",
			expect: errBaseURLAndUploadURL,
			conf: Config{
				ServerConfig: confighttp.ServerConfig{
					Endpoint: "localhost:8080",
				},
				GitHubAPIConfig: GitHubAPIConfig{
					UploadURL: "upload",
				},
			},
		},
		{
			desc:   "GH App Auth > Both BaseURL and UploadURL must be set if one is set > Missing UploadURL",
			expect: errBaseURLAndUploadURL,
			conf: Config{
				ServerConfig: confighttp.ServerConfig{
					Endpoint: "localhost:8080",
				},
				GitHubAPIConfig: GitHubAPIConfig{
					BaseURL: "base",
				},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			err := test.conf.Validate()
			if test.expect == nil {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
				require.Contains(t, err.Error(), test.expect.Error())
			}
		})
	}
}

func TestLoadConfig(t *testing.T) {
	t.Parallel()

	cm, err := confmaptest.LoadConf(filepath.Join("testdata", "config.yaml"))
	require.NoError(t, err)
	// LoadConf includes the TypeStr which NewFactory does not set
	id := component.NewIDWithName(metadata.Type, "valid_config")
	cmNoStr, err := cm.Sub(id.String())
	require.NoError(t, err)

	expect := &Config{
		ServerConfig: confighttp.ServerConfig{
			Endpoint: "localhost:8080",
		},
		Path:   "/ghaevents",
		Secret: "mysecret",
	}

	// create expected config
	factory := NewFactory()
	conf := factory.CreateDefaultConfig()
	require.NoError(t, cmNoStr.Unmarshal(conf))
	require.NoError(t, xconfmap.Validate(conf))

	require.Equal(t, expect, conf)
}
