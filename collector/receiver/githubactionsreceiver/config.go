// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package githubactionsreceiver // import "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/githubactionsreceiver"

import (
	"errors"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/confighttp"
	"go.uber.org/multierr"
)

var errMissingEndpointFromConfig = errors.New("missing receiver server endpoint from config")
var errAuthMethod = errors.New("only one authentication method can be used at a time")
var errMissingAppID = errors.New("missing app_id")
var errMissingInstallationID = errors.New("missing installation_id")
var errMissingPrivateKeyPath = errors.New("missing private_key_path")
var errBaseURLAndUploadURL = errors.New("both base_url and upload_url must be set if one is set")

// GitHubAPIAuthConfig defines authentication configuration for GitHub API
type GitHubAPIAuthConfig struct {
	Token          string `mapstructure:"token"`            // github token for API access. Default is empty
	AppID          int64  `mapstructure:"app_id"`           // github app id for API access. Default is 0
	InstallationID int64  `mapstructure:"installation_id"`  // github app installation id for API access. Default is 0
	PrivateKeyPath string `mapstructure:"private_key_path"` // github app private key path for API access. Default is empty
}

// GitHubAPIConfig defines configuration for GitHub API
type GitHubAPIConfig struct {
	Auth      GitHubAPIAuthConfig `mapstructure:"auth"`       // github api authentication configuration
	BaseURL   string              `mapstructure:"base_url"`   // github enterprise download url. Default is empty
	UploadURL string              `mapstructure:"upload_url"` // github enterprise upload url. Default is empty
}

// Config defines configuration for GitHub Actions receiver
type Config struct {
	confighttp.ServerConfig `mapstructure:",squash"` // squash ensures fields are correctly decoded in embedded struct
	Path                    string                   `mapstructure:"path"`                // path for data collection. Default is <host>:<port>/events
	Secret                  string                   `mapstructure:"secret"`              // github webhook hash signature. Default is empty
	CustomServiceName       string                   `mapstructure:"custom_service_name"` // custom service name. Default is empty
	ServiceNamePrefix       string                   `mapstructure:"service_name_prefix"` // service name prefix. Default is empty
	ServiceNameSuffix       string                   `mapstructure:"service_name_suffix"` // service name suffix. Default is empty
	GitHubAPIConfig         GitHubAPIConfig          `mapstructure:"gh_api"`              // github api configuration
}

var _ component.Config = (*Config)(nil)

// Validate checks the receiver configuration is valid
func (cfg *Config) Validate() error {
	var errs error

	if cfg.Endpoint == "" {
		errs = multierr.Append(errs, errMissingEndpointFromConfig)
	}

	if (cfg.GitHubAPIConfig.Auth.AppID != 0 || cfg.GitHubAPIConfig.Auth.InstallationID != 0 || cfg.GitHubAPIConfig.Auth.PrivateKeyPath != "") && cfg.GitHubAPIConfig.Auth.Token != "" {
		errs = multierr.Append(errs, errAuthMethod)
	} else if cfg.GitHubAPIConfig.Auth.AppID != 0 || cfg.GitHubAPIConfig.Auth.InstallationID != 0 || cfg.GitHubAPIConfig.Auth.PrivateKeyPath != "" {
		if cfg.GitHubAPIConfig.Auth.AppID == 0 {
			errs = multierr.Append(errs, errMissingAppID)
		}
		if cfg.GitHubAPIConfig.Auth.InstallationID == 0 {
			errs = multierr.Append(errs, errMissingInstallationID)
		}
		if cfg.GitHubAPIConfig.Auth.PrivateKeyPath == "" {
			errs = multierr.Append(errs, errMissingPrivateKeyPath)
		}
	}

	if cfg.GitHubAPIConfig.BaseURL != "" && cfg.GitHubAPIConfig.UploadURL == "" || cfg.GitHubAPIConfig.BaseURL == "" && cfg.GitHubAPIConfig.UploadURL != "" {
		errs = multierr.Append(errs, errBaseURLAndUploadURL)
	}

	return errs
}
