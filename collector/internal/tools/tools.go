//go:build tools
// +build tools

package tools // import "github.com/get-citric/citric/collector/internal/tools"

// This file exists to ensure consistent versioning and tooling installs based on
// https://go.dev/wiki/Modules#how-can-i-track-tool-dependencies-for-a-module

import (
	_ "github.com/golangci/golangci-lint/cmd/golangci-lint"
	_ "github.com/securego/gosec/v2/cmd/gosec"
	_ "go.opentelemetry.io/build-tools/crosslink"
	_ "go.opentelemetry.io/collector/cmd/builder"
	_ "go.opentelemetry.io/collector/cmd/mdatagen"
	_ "honnef.co/go/tools/cmd/staticcheck"
)
