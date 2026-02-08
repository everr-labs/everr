package metadata

import (
	"go.opentelemetry.io/collector/component"
)

var (
	Type      = component.MustNewType("testlogstotraces")
	ScopeName = "github.com/get-citric/citric/collector/connector/testlogstotraces"
)

const (
	LogsToTracesStability = component.StabilityLevelAlpha
)
