package metadata

import (
	"go.opentelemetry.io/collector/component"
)

var (
	Type      = component.MustNewType("testlogstotraces")
	ScopeName = "github.com/everr-dev/everr/collector/connector/testlogstotraces"
)

const (
	LogsToTracesStability = component.StabilityLevelAlpha
)
