package githubactionsreceiver

import (
	"context"
	"net/http"

	"github.com/google/go-github/v67/github"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/receiver/githubactionsreceiver/internal/metadata"
)

func eventToMetrics(
	ctx context.Context,
	event interface{},
	config *Config,
	ghClient *github.Client,
	logger *zap.Logger,
) (*pmetric.Metrics, error) {
	e, ok := event.(*github.WorkflowRunEvent)
	if !ok {
		return nil, nil
	}

	if e.GetWorkflowRun().GetStatus() != "completed" {
		logger.Debug("Run not completed, skipping")
		return nil, nil
	}

	metrics := pmetric.NewMetrics()
	resourceMetrics := metrics.ResourceMetrics().AppendEmpty()
	setWorkflowRunEventAttributes(resourceMetrics.Resource().Attributes(), e, config)

	scopeMetrics := resourceMetrics.ScopeMetrics().AppendEmpty()
	scopeMetrics.Scope().SetName(metadata.ScopeName)

	if !appendResourceUsageMetrics(
		ctx,
		e,
		ghClient.Actions,
		http.DefaultClient,
		logger.Named("resourceUsage"),
		scopeMetrics,
	) {
		return nil, nil
	}

	return &metrics, nil
}
