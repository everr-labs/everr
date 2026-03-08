// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package githubactionsreceiver

import (
	"sort"
	"strings"
	"time"

	"github.com/google/go-github/v67/github"
	"go.opentelemetry.io/collector/pdata/pcommon"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
	"go.uber.org/zap"

	"github.com/everr-dev/everr/collector/semconv"
)

func createResourceAttributes(resource pcommon.Resource, event interface{}, config *Config, logger *zap.Logger) {
	attrs := resource.Attributes()

	switch e := event.(type) {
	case *github.WorkflowJobEvent:
		serviceName := generateServiceName(config, e.GetRepo().GetFullName())
		attrs.PutStr("service.name", serviceName)

		attrs.PutStr(string(conventions.CICDPipelineNameKey), e.GetWorkflowJob().GetWorkflowName())

		attrs.PutStr(semconv.EverrGitHubWorkflowJobCreatedAt, e.GetWorkflowJob().GetCreatedAt().Format(time.RFC3339))
		attrs.PutStr(semconv.EverrGitHubWorkflowJobCompletedAt, e.GetWorkflowJob().GetCompletedAt().Format(time.RFC3339))
		attrs.PutStr(string(conventions.CICDPipelineTaskRunResultKey), mapConclusion(e.GetWorkflowJob().GetConclusion()))
		attrs.PutStr(string(conventions.VCSRefHeadNameKey), e.GetWorkflowJob().GetHeadBranch())
		attrs.PutStr(string(conventions.VCSRefHeadTypeKey), "branch")
		attrs.PutStr(string(conventions.VCSRefHeadRevisionKey), e.GetWorkflowJob().GetHeadSHA())
		attrs.PutStr(string(conventions.CICDPipelineTaskRunURLFullKey), e.GetWorkflowJob().GetHTMLURL())
		attrs.PutInt(string(conventions.CICDPipelineTaskRunIDKey), e.GetWorkflowJob().GetID())

		if len(e.WorkflowJob.Labels) > 0 {
			labels := e.GetWorkflowJob().Labels
			for i, label := range labels {
				labels[i] = strings.ToLower(label)
			}
			sort.Strings(labels)
			joinedLabels := strings.Join(labels, ",")
			attrs.PutStr(semconv.CICDPipelineWorkerLabels, joinedLabels)
		} else {
			attrs.PutStr(semconv.CICDPipelineWorkerLabels, "no labels")
		}

		attrs.PutStr(string(conventions.CICDPipelineTaskNameKey), e.GetWorkflowJob().GetName())
		attrs.PutInt(semconv.EverrGitHubWorkflowJobRunAttempt, e.GetWorkflowJob().GetRunAttempt())
		attrs.PutInt(string(conventions.CICDPipelineRunIDKey), e.GetWorkflowJob().GetRunID())
		attrs.PutStr(semconv.CICDPipelineWorkerGroupName, e.GetWorkflowJob().GetRunnerGroupName())
		attrs.PutStr(string(conventions.CICDWorkerNameKey), e.GetWorkflowJob().GetRunnerName())
		attrs.PutStr(semconv.CICDPipelineTaskRunSenderLogin, e.GetSender().GetLogin())
		attrs.PutStr(semconv.EverrGitHubWorkflowJobStartedAt, e.GetWorkflowJob().GetStartedAt().Format(time.RFC3339))
		attrs.PutStr(semconv.EverrGitHubWorkflowJobStatus, e.GetWorkflowJob().GetStatus())

		attrs.PutStr(string(conventions.VCSProviderNameKey), "github")

		attrs.PutStr(string(conventions.VCSOwnerNameKey), e.GetRepo().GetOwner().GetLogin())
		attrs.PutStr(string(conventions.VCSRepositoryNameKey), e.GetRepo().GetFullName())

	case *github.WorkflowRunEvent:
		setWorkflowRunEventAttributes(attrs, e, config)

	default:
		logger.Error("unknown event type")
	}
}
