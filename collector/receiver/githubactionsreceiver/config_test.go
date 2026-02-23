// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package githubactionsreceiver

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/get-citric/citric/collector/receiver/githubactionsreceiver/internal/metadata"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/confighttp"
	"go.opentelemetry.io/collector/config/confignet"
	"go.opentelemetry.io/collector/confmap/confmaptest"
	"go.opentelemetry.io/collector/confmap/xconfmap"
)

type testNode struct {
	desc     string
	expect   error
	conf     *Config
	children []testNode
}

func TestValidateConfig(t *testing.T) {
	t.Parallel()

	tests := []testNode{
		{
			desc:   "Missing valid endpoint",
			expect: errMissingEndpointFromConfig,
			conf: &Config{
				ServerConfig: confighttp.ServerConfig{
					NetAddr: confignet.AddrConfig{
						Endpoint: "",
					},
				},
				GitHubAPIConfig: GitHubAPIConfig{
					Auth: GitHubAPIAuthConfig{
						AppID:          1,
						PrivateKeyPath: "path",
					},
				},
				TenantResolution: TenantResolutionConfig{
					PostgresDSN: "postgres://user:pass@localhost:5432/citric?sslmode=disable",
				},
			},
		},
		{
			desc:   "Valid Secret and auth",
			expect: nil,
			conf: &Config{
				ServerConfig: confighttp.ServerConfig{
					NetAddr: confignet.AddrConfig{
						Endpoint: "localhost:8080",
					},
				},
				Secret: "mysecret",
				GitHubAPIConfig: GitHubAPIConfig{
					Auth: GitHubAPIAuthConfig{
						AppID:          1,
						PrivateKeyPath: "path",
					},
				},
				TenantResolution: TenantResolutionConfig{
					PostgresDSN: "postgres://user:pass@localhost:5432/citric?sslmode=disable",
				},
			},
		},
		{
			desc:   "Missing tenant postgres dsn",
			expect: errMissingTenantPostgresDSN,
			conf: &Config{
				ServerConfig: confighttp.ServerConfig{
					NetAddr: confignet.AddrConfig{
						Endpoint: "localhost:8080",
					},
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
			desc: "Auth validation",
			children: []testNode{
				{
					desc:   "Missing App ID",
					expect: errMissingAppID,
					conf: &Config{
						ServerConfig: confighttp.ServerConfig{
							NetAddr: confignet.AddrConfig{
								Endpoint: "localhost:8080",
							},
						},
						GitHubAPIConfig: GitHubAPIConfig{
							Auth: GitHubAPIAuthConfig{
								PrivateKeyPath: "path",
							},
						},
						TenantResolution: TenantResolutionConfig{
							PostgresDSN: "postgres://user:pass@localhost:5432/citric?sslmode=disable",
						},
					},
				},
				{
					desc:   "Missing Private Key Path",
					expect: errMissingPrivateKeyPath,
					conf: &Config{
						ServerConfig: confighttp.ServerConfig{
							NetAddr: confignet.AddrConfig{
								Endpoint: "localhost:8080",
							},
						},
						GitHubAPIConfig: GitHubAPIConfig{
							Auth: GitHubAPIAuthConfig{
								AppID: 1,
							},
						},
						TenantResolution: TenantResolutionConfig{
							PostgresDSN: "postgres://user:pass@localhost:5432/citric?sslmode=disable",
						},
					},
				},
				{
					desc: "Both BaseURL and UploadURL must be set if one is set",
					children: []testNode{
						{
							desc:   "Missing BaseURL",
							expect: errBaseURLAndUploadURL,
							conf: &Config{
								ServerConfig: confighttp.ServerConfig{
									NetAddr: confignet.AddrConfig{
										Endpoint: "localhost:8080",
									},
								},
								GitHubAPIConfig: GitHubAPIConfig{
									UploadURL: "upload",
									Auth: GitHubAPIAuthConfig{
										AppID:          1,
										PrivateKeyPath: "path",
									},
								},
								TenantResolution: TenantResolutionConfig{
									PostgresDSN: "postgres://user:pass@localhost:5432/citric?sslmode=disable",
								},
							},
						},
						{
							desc:   "Missing UploadURL",
							expect: errBaseURLAndUploadURL,
							conf: &Config{
								ServerConfig: confighttp.ServerConfig{
									NetAddr: confignet.AddrConfig{
										Endpoint: "localhost:8080",
									},
								},
								GitHubAPIConfig: GitHubAPIConfig{
									BaseURL: "base",
									Auth: GitHubAPIAuthConfig{
										AppID:          1,
										PrivateKeyPath: "path",
									},
								},
								TenantResolution: TenantResolutionConfig{
									PostgresDSN: "postgres://user:pass@localhost:5432/citric?sslmode=disable",
								},
							},
						},
					},
				},
			},
		},
	}

	var runTests func(t *testing.T, nodes []testNode)
	runTests = func(t *testing.T, nodes []testNode) {
		t.Helper()
		for _, node := range nodes {
			t.Run(node.desc, func(t *testing.T) {
				if node.conf != nil {
					err := node.conf.Validate()
					if node.expect == nil {
						require.NoError(t, err)
					} else {
						require.Error(t, err)
						require.Contains(t, err.Error(), node.expect.Error())
					}
				} else {
					runTests(t, node.children)
				}
			})
		}
	}

	runTests(t, tests)
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
			NetAddr: confignet.AddrConfig{
				Endpoint:  "localhost:8080",
				Transport: "tcp",
			},
		},
		Path:   "/ghaevents",
		Secret: "mysecret",
		GitHubAPIConfig: GitHubAPIConfig{
			Auth: GitHubAPIAuthConfig{
				AppID:          1,
				PrivateKeyPath: "/path/to/key.pem",
			},
		},
		TenantResolution: TenantResolutionConfig{
			PostgresDSN: "postgres://user:pass@localhost:5432/citric?sslmode=disable",
			CacheTTL:    time.Minute,
		},
		EventForwarding: EventForwardingConfig{
			Timeout: 5 * time.Second,
		},
	}

	// create expected config
	factory := NewFactory()
	conf := factory.CreateDefaultConfig()
	require.NoError(t, cmNoStr.Unmarshal(conf))
	require.NoError(t, xconfmap.Validate(conf))

	require.Equal(t, expect, conf)
}
