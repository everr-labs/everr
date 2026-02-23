// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package semconv

// Contrib — CICD extensions from opentelemetry-collector-contrib/receiver/githubreceiver
// OTel standard CICD/VCS keys should be imported from go.opentelemetry.io/otel/semconv/v1.38.0
const (
	CICDPipelineRunSenderLogin        = "cicd.pipeline.run.sender.login"
	CICDPipelineRunPreviousAttemptURL = "cicd.pipeline.run.previous_attempt.url.full"
	CICDPipelineTaskRunSenderLogin    = "cicd.pipeline.task.run.sender.login"
	CICDPipelineWorkerGroupName       = "cicd.pipeline.worker.group.name"
	CICDPipelineWorkerLabels          = "cicd.pipeline.worker.labels"
)

// Citric — GitHub workflow attributes with no OTel/contrib equivalent
const (
	CitricGitHubWorkflowID   = "citric.github.workflow.id"
	CitricGitHubWorkflowPath = "citric.github.workflow.path"
	CitricTenantID           = "citric.tenant.id"
)

// Citric — GitHub workflow run attributes with no OTel/contrib equivalent
const (
	CitricGitHubWorkflowRunActorLogin           = "citric.github.workflow_run.actor.login"
	CitricGitHubWorkflowRunCreatedAt            = "citric.github.workflow_run.created_at"
	CitricGitHubWorkflowRunDisplayTitle         = "citric.github.workflow_run.display_title"
	CitricGitHubWorkflowRunEvent                = "citric.github.workflow_run.event"
	CitricGitHubWorkflowRunReferencedWorkflows  = "citric.github.workflow_run.referenced_workflows"
	CitricGitHubWorkflowRunRunAttempt           = "citric.github.workflow_run.run_attempt"
	CitricGitHubWorkflowRunStartedAt            = "citric.github.workflow_run.started_at"
	CitricGitHubWorkflowRunStatus               = "citric.github.workflow_run.status"
	CitricGitHubWorkflowRunTriggeringActorLogin = "citric.github.workflow_run.triggering_actor.login"
	CitricGitHubWorkflowRunUpdatedAt            = "citric.github.workflow_run.updated_at"
)

// Citric — GitHub workflow job attributes with no OTel/contrib equivalent
const (
	CitricGitHubWorkflowJobCreatedAt   = "citric.github.workflow_job.created_at"
	CitricGitHubWorkflowJobCompletedAt = "citric.github.workflow_job.completed_at"
	CitricGitHubWorkflowJobStartedAt   = "citric.github.workflow_job.started_at"
	CitricGitHubWorkflowJobRunAttempt  = "citric.github.workflow_job.run_attempt"
	CitricGitHubWorkflowJobStatus      = "citric.github.workflow_job.status"
)

// Citric — GitHub workflow job step attributes with no OTel/contrib equivalent
const (
	CitricGitHubWorkflowJobStepNumber      = "citric.github.workflow_job_step.number"
	CitricGitHubWorkflowJobStepStatus      = "citric.github.workflow_job_step.status"
	CitricGitHubWorkflowJobStepStartedAt   = "citric.github.workflow_job_step.started_at"
	CitricGitHubWorkflowJobStepCompletedAt = "citric.github.workflow_job_step.completed_at"
)
