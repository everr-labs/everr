// Copyright The OpenTelemetry Authors
// Copyright 2026 Giordano Ricci (operating as "Everr Labs")
// SPDX-License-Identifier: Apache-2.0
//
// This file has been modified from its original version.

package githubactionsreceiver // import "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/githubactionsreceiver"

import (
	"errors"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/config/confighttp"
	"go.uber.org/multierr"
)

var errMissingEndpointFromConfig = errors.New("missing receiver server endpoint from config")
var errMissingAppID = errors.New("missing app_id")
var errMissingPrivateKey = errors.New("missing one of private_key or private_key_path")
var errMultiplePrivateKeySources = errors.New("only one of private_key or private_key_path may be set")
var errBaseURLAndUploadURL = errors.New("both base_url and upload_url must be set if one is set")

// GitHubAPIAuthConfig defines authentication configuration for GitHub API
type GitHubAPIAuthConfig struct {
	AppID          int64  `mapstructure:"app_id"`           // github app id for API access. Default is 0
	PrivateKey     string `mapstructure:"private_key"`      // github app private key PEM content for API access. Default is empty
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

	if cfg.NetAddr.Endpoint == "" {
		errs = multierr.Append(errs, errMissingEndpointFromConfig)
	}

	if cfg.GitHubAPIConfig.Auth.AppID == 0 {
		errs = multierr.Append(errs, errMissingAppID)
	}

	privateKeyConfigured := cfg.GitHubAPIConfig.Auth.PrivateKey != ""
	privateKeyPathConfigured := cfg.GitHubAPIConfig.Auth.PrivateKeyPath != ""

	if !privateKeyConfigured && !privateKeyPathConfigured {
		errs = multierr.Append(errs, errMissingPrivateKey)
	}

	if privateKeyConfigured && privateKeyPathConfigured {
		errs = multierr.Append(errs, errMultiplePrivateKeySources)
	}
	if cfg.GitHubAPIConfig.BaseURL != "" && cfg.GitHubAPIConfig.UploadURL == "" || cfg.GitHubAPIConfig.BaseURL == "" && cfg.GitHubAPIConfig.UploadURL != "" {
		errs = multierr.Append(errs, errBaseURLAndUploadURL)
	}

	return errs
}
