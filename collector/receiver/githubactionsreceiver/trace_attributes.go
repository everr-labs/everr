// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package githubactionsreceiver

import (
	"sort"
	"strings"
	"time"

	"github.com/google/go-github/v61/github"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.uber.org/zap"
)

func createResourceAttributes(resource pcommon.Resource, event interface{}, config *Config, logger *zap.Logger) {
	attrs := resource.Attributes()

	switch e := event.(type) {
	case *github.WorkflowJobEvent:
		serviceName := generateServiceName(config, e.GetRepo().GetFullName())
		attrs.PutStr("service.name", serviceName)

		attrs.PutStr("ci.github.workflow.name", e.GetWorkflowJob().GetWorkflowName())

		attrs.PutStr("ci.github.workflow.job.created_at", e.GetWorkflowJob().GetCreatedAt().Format(time.RFC3339))
		attrs.PutStr("ci.github.workflow.job.completed_at", e.GetWorkflowJob().GetCompletedAt().Format(time.RFC3339))
		attrs.PutStr("ci.github.workflow.job.conclusion", e.GetWorkflowJob().GetConclusion())
		attrs.PutStr("ci.github.workflow.job.head_branch", e.GetWorkflowJob().GetHeadBranch())
		attrs.PutStr("ci.github.workflow.job.head_sha", e.GetWorkflowJob().GetHeadSHA())
		attrs.PutStr("ci.github.workflow.job.html_url", e.GetWorkflowJob().GetHTMLURL())
		attrs.PutInt("ci.github.workflow.job.id", e.GetWorkflowJob().GetID())

		if len(e.WorkflowJob.Labels) > 0 {
			labels := e.GetWorkflowJob().Labels
			for i, label := range labels {
				labels[i] = strings.ToLower(label)
			}
			sort.Strings(labels)
			joinedLabels := strings.Join(labels, ",")
			attrs.PutStr("ci.github.workflow.job.labels", joinedLabels)
		} else {
			attrs.PutStr("ci.github.workflow.job.labels", "no labels")
		}

		attrs.PutStr("ci.github.workflow.job.name", e.GetWorkflowJob().GetName())
		attrs.PutInt("ci.github.workflow.job.run_attempt", e.GetWorkflowJob().GetRunAttempt())
		attrs.PutInt("ci.github.workflow.job.run_id", e.GetWorkflowJob().GetRunID())
		attrs.PutStr("ci.github.workflow.job.runner.group_name", e.GetWorkflowJob().GetRunnerGroupName())
		attrs.PutStr("ci.github.workflow.job.runner.name", e.GetWorkflowJob().GetRunnerName())
		attrs.PutStr("ci.github.workflow.job.sender.login", e.GetSender().GetLogin())
		attrs.PutStr("ci.github.workflow.job.started_at", e.GetWorkflowJob().GetStartedAt().Format(time.RFC3339))
		attrs.PutStr("ci.github.workflow.job.status", e.GetWorkflowJob().GetStatus())

		attrs.PutStr("ci.system", "github")

		attrs.PutStr("scm.git.repo.owner.login", e.GetRepo().GetOwner().GetLogin())
		attrs.PutStr("scm.git.repo", e.GetRepo().GetFullName())

	case *github.WorkflowRunEvent:
		setWorkflowRunEventAttributes(attrs, e, config)

	default:
		logger.Error("unknown event type")
	}
}
