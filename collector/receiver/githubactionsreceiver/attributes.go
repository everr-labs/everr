// Copyright The OpenTelemetry Authors
// Copyright 2026 Giordano Ricci (operating as "Everr Labs")
// SPDX-License-Identifier: Apache-2.0
//
// This file has been modified from its original version.

package githubactionsreceiver

import (
	"strings"
	"time"

	"github.com/google/go-github/v67/github"
	"go.opentelemetry.io/collector/pdata/pcommon"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"

	"github.com/everr-labs/everr/collector/semconv"
)

func setWorkflowRunEventAttributes(attrs pcommon.Map, e *github.WorkflowRunEvent, config *Config) {
	serviceName := generateServiceName(config, e.GetRepo().GetFullName())
	attrs.PutStr("service.name", serviceName)

	attrs.PutInt(semconv.EverrGitHubWorkflowID, e.GetWorkflowRun().GetWorkflowID())
	attrs.PutStr(semconv.EverrGitHubWorkflowRunActorLogin, e.GetWorkflowRun().GetActor().GetLogin())

	attrs.PutStr(string(conventions.CICDPipelineResultKey), mapConclusion(e.GetWorkflowRun().GetConclusion()))
	attrs.PutStr(semconv.EverrGitHubWorkflowRunCreatedAt, e.GetWorkflowRun().GetCreatedAt().Format(time.RFC3339))
	attrs.PutStr(semconv.EverrGitHubWorkflowRunDisplayTitle, e.GetWorkflowRun().GetDisplayTitle())
	attrs.PutStr(semconv.EverrGitHubWorkflowRunEvent, e.GetWorkflowRun().GetEvent())
	attrs.PutStr(string(conventions.CICDPipelineRunURLFullKey), e.GetWorkflowRun().GetHTMLURL())
	attrs.PutInt(string(conventions.CICDPipelineRunIDKey), e.GetWorkflowRun().GetID())
	attrs.PutStr(string(conventions.CICDPipelineNameKey), e.GetWorkflowRun().GetName())
	attrs.PutStr(semconv.EverrGitHubWorkflowPath, e.GetWorkflow().GetPath())

	if e.GetWorkflowRun().GetPreviousAttemptURL() != "" {
		htmlURL := transformGitHubAPIURL(e.GetWorkflowRun().GetPreviousAttemptURL())
		attrs.PutStr(semconv.CICDPipelineRunPreviousAttemptURL, htmlURL)
	}

	if len(e.GetWorkflowRun().ReferencedWorkflows) > 0 {
		var referencedWorkflows []string
		for _, workflow := range e.GetWorkflowRun().ReferencedWorkflows {
			referencedWorkflows = append(referencedWorkflows, workflow.GetPath())
		}
		attrs.PutStr(semconv.EverrGitHubWorkflowRunReferencedWorkflows, strings.Join(referencedWorkflows, ";"))
	}

	attrs.PutInt(semconv.EverrGitHubWorkflowRunRunAttempt, int64(e.GetWorkflowRun().GetRunAttempt()))
	attrs.PutStr(semconv.EverrGitHubWorkflowRunStartedAt, e.GetWorkflowRun().RunStartedAt.Format(time.RFC3339))
	attrs.PutStr(semconv.EverrGitHubWorkflowRunStatus, e.GetWorkflowRun().GetStatus())
	attrs.PutStr(semconv.CICDPipelineRunSenderLogin, e.GetSender().GetLogin())
	attrs.PutStr(semconv.EverrGitHubWorkflowRunTriggeringActorLogin, e.GetWorkflowRun().GetTriggeringActor().GetLogin())
	attrs.PutStr(semconv.EverrGitHubWorkflowRunUpdatedAt, e.GetWorkflowRun().GetUpdatedAt().Format(time.RFC3339))

	attrs.PutStr(string(conventions.VCSProviderNameKey), "github")

	attrs.PutStr(string(conventions.VCSRefHeadNameKey), e.GetWorkflowRun().GetHeadBranch())
	attrs.PutStr(string(conventions.VCSRefHeadTypeKey), "branch")
	attrs.PutStr(string(conventions.VCSRefHeadRevisionKey), e.GetWorkflowRun().GetHeadSHA())
	attrs.PutStr(semconv.VCSRefHeadRevisionAuthorEmail, e.GetWorkflowRun().GetHeadCommit().GetAuthor().GetEmail())
	attrs.PutStr(semconv.VCSRefHeadRevisionAuthorName, e.GetWorkflowRun().GetHeadCommit().GetAuthor().GetName())
	attrs.PutStr(semconv.EverrGitHeadCommitCommitterEmail, e.GetWorkflowRun().GetHeadCommit().GetCommitter().GetEmail())
	attrs.PutStr(semconv.EverrGitHeadCommitCommitterName, e.GetWorkflowRun().GetHeadCommit().GetCommitter().GetName())
	attrs.PutStr(semconv.EverrGitHeadCommitMessage, e.GetWorkflowRun().GetHeadCommit().GetMessage())
	attrs.PutStr(semconv.EverrGitHeadCommitTimestamp, e.GetWorkflowRun().GetHeadCommit().GetTimestamp().Format(time.RFC3339))

	if len(e.GetWorkflowRun().PullRequests) > 0 {
		var prUrls []string
		for _, pr := range e.GetWorkflowRun().PullRequests {
			prUrls = append(prUrls, convertPRURL(pr.GetURL()))
		}
		attrs.PutStr(semconv.EverrGitPullRequestsURL, strings.Join(prUrls, ";"))
	}

	attrs.PutStr(string(conventions.VCSRepositoryNameKey), e.GetRepo().GetFullName())
}
