// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package githubactionsreceiver

import (
	"strings"
	"time"

	"github.com/google/go-github/v67/github"
	"go.opentelemetry.io/collector/pdata/pcommon"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"

	"github.com/get-citric/citric/collector/semconv"
)

func setWorkflowRunEventAttributes(attrs pcommon.Map, e *github.WorkflowRunEvent, config *Config) {
	serviceName := generateServiceName(config, e.GetRepo().GetFullName())
	attrs.PutStr("service.name", serviceName)

	attrs.PutInt(semconv.CitricGitHubWorkflowID, e.GetWorkflowRun().GetWorkflowID())
	attrs.PutStr(semconv.CitricGitHubWorkflowRunActorLogin, e.GetWorkflowRun().GetActor().GetLogin())

	attrs.PutStr(string(conventions.CICDPipelineResultKey), mapConclusion(e.GetWorkflowRun().GetConclusion()))
	attrs.PutStr(semconv.CitricGitHubWorkflowRunCreatedAt, e.GetWorkflowRun().GetCreatedAt().Format(time.RFC3339))
	attrs.PutStr(semconv.CitricGitHubWorkflowRunDisplayTitle, e.GetWorkflowRun().GetDisplayTitle())
	attrs.PutStr(semconv.CitricGitHubWorkflowRunEvent, e.GetWorkflowRun().GetEvent())
	attrs.PutStr(string(conventions.CICDPipelineRunURLFullKey), e.GetWorkflowRun().GetHTMLURL())
	attrs.PutInt(string(conventions.CICDPipelineRunIDKey), e.GetWorkflowRun().GetID())
	attrs.PutStr(string(conventions.CICDPipelineNameKey), e.GetWorkflowRun().GetName())
	attrs.PutStr(semconv.CitricGitHubWorkflowPath, e.GetWorkflow().GetPath())

	if e.GetWorkflowRun().GetPreviousAttemptURL() != "" {
		htmlURL := transformGitHubAPIURL(e.GetWorkflowRun().GetPreviousAttemptURL())
		attrs.PutStr(semconv.CICDPipelineRunPreviousAttemptURL, htmlURL)
	}

	if len(e.GetWorkflowRun().ReferencedWorkflows) > 0 {
		var referencedWorkflows []string
		for _, workflow := range e.GetWorkflowRun().ReferencedWorkflows {
			referencedWorkflows = append(referencedWorkflows, workflow.GetPath())
		}
		attrs.PutStr(semconv.CitricGitHubWorkflowRunReferencedWorkflows, strings.Join(referencedWorkflows, ";"))
	}

	attrs.PutInt(semconv.CitricGitHubWorkflowRunRunAttempt, int64(e.GetWorkflowRun().GetRunAttempt()))
	attrs.PutStr(semconv.CitricGitHubWorkflowRunStartedAt, e.GetWorkflowRun().RunStartedAt.Format(time.RFC3339))
	attrs.PutStr(semconv.CitricGitHubWorkflowRunStatus, e.GetWorkflowRun().GetStatus())
	attrs.PutStr(semconv.CICDPipelineRunSenderLogin, e.GetSender().GetLogin())
	attrs.PutStr(semconv.CitricGitHubWorkflowRunTriggeringActorLogin, e.GetWorkflowRun().GetTriggeringActor().GetLogin())
	attrs.PutStr(semconv.CitricGitHubWorkflowRunUpdatedAt, e.GetWorkflowRun().GetUpdatedAt().Format(time.RFC3339))

	attrs.PutStr(string(conventions.VCSProviderNameKey), "github")

	attrs.PutStr(string(conventions.VCSRefHeadNameKey), e.GetWorkflowRun().GetHeadBranch())
	attrs.PutStr(string(conventions.VCSRefHeadTypeKey), "branch")
	attrs.PutStr(string(conventions.VCSRefHeadRevisionKey), e.GetWorkflowRun().GetHeadSHA())
	attrs.PutStr(semconv.VCSRefHeadRevisionAuthorEmail, e.GetWorkflowRun().GetHeadCommit().GetAuthor().GetEmail())
	attrs.PutStr(semconv.VCSRefHeadRevisionAuthorName, e.GetWorkflowRun().GetHeadCommit().GetAuthor().GetName())
	attrs.PutStr(semconv.CitricGitHeadCommitCommitterEmail, e.GetWorkflowRun().GetHeadCommit().GetCommitter().GetEmail())
	attrs.PutStr(semconv.CitricGitHeadCommitCommitterName, e.GetWorkflowRun().GetHeadCommit().GetCommitter().GetName())
	attrs.PutStr(semconv.CitricGitHeadCommitMessage, e.GetWorkflowRun().GetHeadCommit().GetMessage())
	attrs.PutStr(semconv.CitricGitHeadCommitTimestamp, e.GetWorkflowRun().GetHeadCommit().GetTimestamp().Format(time.RFC3339))

	if len(e.GetWorkflowRun().PullRequests) > 0 {
		var prUrls []string
		for _, pr := range e.GetWorkflowRun().PullRequests {
			prUrls = append(prUrls, convertPRURL(pr.GetURL()))
		}
		attrs.PutStr(semconv.CitricGitPullRequestsURL, strings.Join(prUrls, ";"))
	}

	attrs.PutStr(string(conventions.VCSRepositoryNameKey), e.GetRepo().GetFullName())
}
