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

// Everr — GitHub workflow attributes with no OTel/contrib equivalent
const (
	EverrGitHubWorkflowID   = "everr.github.workflow.id"
	EverrGitHubWorkflowPath = "everr.github.workflow.path"
	EverrTenantID           = "everr.tenant.id"
)

// Everr — GitHub workflow run attributes with no OTel/contrib equivalent
const (
	EverrGitHubWorkflowRunActorLogin           = "everr.github.workflow_run.actor.login"
	EverrGitHubWorkflowRunCreatedAt            = "everr.github.workflow_run.created_at"
	EverrGitHubWorkflowRunDisplayTitle         = "everr.github.workflow_run.display_title"
	EverrGitHubWorkflowRunEvent                = "everr.github.workflow_run.event"
	EverrGitHubWorkflowRunReferencedWorkflows  = "everr.github.workflow_run.referenced_workflows"
	EverrGitHubWorkflowRunRunAttempt           = "everr.github.workflow_run.run_attempt"
	EverrGitHubWorkflowRunStartedAt            = "everr.github.workflow_run.started_at"
	EverrGitHubWorkflowRunStatus               = "everr.github.workflow_run.status"
	EverrGitHubWorkflowRunTriggeringActorLogin = "everr.github.workflow_run.triggering_actor.login"
	EverrGitHubWorkflowRunUpdatedAt            = "everr.github.workflow_run.updated_at"
)

// Everr — GitHub workflow job attributes with no OTel/contrib equivalent
const (
	EverrGitHubWorkflowJobCreatedAt   = "everr.github.workflow_job.created_at"
	EverrGitHubWorkflowJobCompletedAt = "everr.github.workflow_job.completed_at"
	EverrGitHubWorkflowJobStartedAt   = "everr.github.workflow_job.started_at"
	EverrGitHubWorkflowJobRunAttempt  = "everr.github.workflow_job.run_attempt"
	EverrGitHubWorkflowJobStatus      = "everr.github.workflow_job.status"
)

// Everr — GitHub workflow job step attributes with no OTel/contrib equivalent
const (
	EverrGitHubWorkflowJobStepNumber      = "everr.github.workflow_job_step.number"
	EverrGitHubWorkflowJobStepStatus      = "everr.github.workflow_job_step.status"
	EverrGitHubWorkflowJobStepStartedAt   = "everr.github.workflow_job_step.started_at"
	EverrGitHubWorkflowJobStepCompletedAt = "everr.github.workflow_job_step.completed_at"
)
