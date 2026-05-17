package githubactionsreceiver

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/google/go-github/v67/github"
	"github.com/stretchr/testify/require"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/semconv"
)

func parseGitHubTestEvent[T any](t *testing.T, path string, eventType string) T {
	t.Helper()
	payload, err := os.ReadFile(path)
	require.NoError(t, err)

	event, err := github.ParseWebHook(eventType, payload)
	require.NoError(t, err)

	typed, ok := event.(T)
	require.True(t, ok)
	return typed
}

func deploymentStatusEventWithState(t *testing.T, state string) *github.DeploymentStatusEvent {
	t.Helper()
	event := parseGitHubTestEvent[*github.DeploymentStatusEvent](t, "testdata/deployment/deployment_status_success.json", "deployment_status")
	event.DeploymentStatus.State = github.String(state)
	return event
}

func TestDeploymentEventToLogsMapsDeploymentCreated(t *testing.T) {
	event := parseGitHubTestEvent[*github.DeploymentEvent](t, "testdata/deployment/deployment_created.json", "deployment")

	logs, err := deploymentEventToLogs(event, "delivery-deploy-created-1", zap.NewNop())

	require.NoError(t, err)
	require.NotNil(t, logs)
	require.Equal(t, 1, logs.LogRecordCount())

	record := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0)
	require.Equal(t, "dev.cdevents.pipelinerun.queued.0.3.0", record.EventName())
	require.Equal(t, "dev.cdevents.pipelinerun.queued.0.3.0", record.Attributes().AsRaw()[semconv.CDEventsType])
	require.Equal(t, "delivery-deploy-created-1", record.Attributes().AsRaw()[semconv.CDEventsID])
	require.NotContains(t, record.Attributes().AsRaw(), "event.name")
	require.NotContains(t, record.Attributes().AsRaw(), "deployment.environment.name")
	require.Equal(t, int64(987), record.Attributes().AsRaw()[semconv.EverrGitHubDeploymentID])
	require.Equal(t, "987", record.Attributes().AsRaw()[string(conventions.CICDPipelineRunIDKey)])
	require.Equal(t, "987", record.Attributes().AsRaw()[semconv.EverrDeployID])

	require.Equal(t, conventions.SchemaURL, logs.ResourceLogs().At(0).SchemaUrl())
	resourceAttrs := logs.ResourceLogs().At(0).Resource().Attributes().AsRaw()
	require.Equal(t, "github-deployments", resourceAttrs["service.name"])
	require.Equal(t, "production", resourceAttrs["deployment.environment.name"])
	require.Equal(t, "everr-deploy", resourceAttrs[string(conventions.VCSRepositoryNameKey)])
	require.Equal(t, "https://github.com/everr-labs/everr-deploy", resourceAttrs["vcs.repository.url.full"])
	require.Equal(t, "everr-labs/everr-deploy", resourceAttrs[semconv.EverrGitHubRepositoryFullName])
	require.Equal(t, "everr-labs", resourceAttrs[semconv.EverrGitHubRepositoryOwnerLogin])
	require.NotContains(t, resourceAttrs, string(conventions.VCSProviderNameKey))
	require.NotContains(t, resourceAttrs, string(conventions.VCSOwnerNameKey))

	var body cdeventsBody
	require.NoError(t, json.Unmarshal([]byte(record.Body().Str()), &body))
	require.Equal(t, "0.5.0", body.Context.Version)
	require.Equal(t, "delivery-deploy-created-1", body.Context.ID)
	require.Equal(t, "dev.cdevents.pipelinerun.queued.0.3.0", body.Context.Type)
	require.Equal(t, "https://github.com/everr-labs/everr-deploy", body.Context.Source)
	require.Equal(t, "https://github.com/everr-labs/everr-deploy", body.Subject.Source)
	require.Equal(t, "https://github.com/everr-labs/everr-deploy", record.Attributes().AsRaw()[semconv.CDEventsSource])
}

func TestDeploymentStatusSuccessEmitsPipelineFinishedAndServiceDeployed(t *testing.T) {
	event := parseGitHubTestEvent[*github.DeploymentStatusEvent](t, "testdata/deployment/deployment_status_success.json", "deployment_status")

	logs, err := deploymentEventToLogs(event, "delivery-deploy-status-success-1", zap.NewNop())

	require.NoError(t, err)
	require.NotNil(t, logs)
	require.Equal(t, 2, logs.LogRecordCount())

	records := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords()
	require.Equal(t, "dev.cdevents.pipelinerun.finished.0.3.0", records.At(0).EventName())
	require.Equal(t, "delivery-deploy-status-success-1", records.At(0).Attributes().AsRaw()[semconv.CDEventsID])
	require.Equal(t, "success", records.At(0).Attributes().AsRaw()[string(conventions.CICDPipelineResultKey)])
	require.Equal(t, "dev.cdevents.service.deployed.0.3.0", records.At(1).EventName())
	require.Equal(t, "delivery-deploy-status-success-1-service-deployed", records.At(1).Attributes().AsRaw()[semconv.CDEventsID])
	require.Equal(t, "https://app.everr.dev", records.At(1).Attributes().AsRaw()[semconv.EverrDeployURL])

	var finishedBody cdeventsBody
	require.NoError(t, json.Unmarshal([]byte(records.At(0).Body().Str()), &finishedBody))
	require.Equal(t, "0.5.0", finishedBody.Context.Version)
	require.Equal(t, "delivery-deploy-status-success-1", finishedBody.Context.ID)
	require.Equal(t, "dev.cdevents.pipelinerun.finished.0.3.0", finishedBody.Context.Type)

	var deployedBody cdeventsBody
	require.NoError(t, json.Unmarshal([]byte(records.At(1).Body().Str()), &deployedBody))
	require.Equal(t, "0.5.0", deployedBody.Context.Version)
	require.Equal(t, "delivery-deploy-status-success-1-service-deployed", deployedBody.Context.ID)
	require.Equal(t, "dev.cdevents.service.deployed.0.3.0", deployedBody.Context.Type)
}

func TestDeploymentStatusInactiveEmitsSuperseded(t *testing.T) {
	event := parseGitHubTestEvent[*github.DeploymentStatusEvent](t, "testdata/deployment/deployment_status_inactive.json", "deployment_status")

	logs, err := deploymentEventToLogs(event, "delivery-deploy-status-inactive-1", zap.NewNop())

	require.NoError(t, err)
	require.NotNil(t, logs)
	require.Equal(t, 1, logs.LogRecordCount())
	record := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0)
	require.Equal(t, "everr.deploy.superseded", record.EventName())
	require.Equal(t, "delivery-deploy-status-inactive-1", record.Attributes().AsRaw()[semconv.EverrGitHubDeliveryID])
	require.NotContains(t, record.Attributes().AsRaw(), semconv.CDEventsType)
	require.NotContains(t, record.Attributes().AsRaw(), semconv.CDEventsID)
	require.NotContains(t, record.Attributes().AsRaw(), string(conventions.CICDPipelineResultKey))
	require.NotContains(t, record.Body().Str(), "service.removed")
}

func TestDeploymentStatusQueuedAndPendingAreSkipped(t *testing.T) {
	for _, state := range []string{"queued", "pending"} {
		event := deploymentStatusEventWithState(t, state)

		logs, err := deploymentEventToLogs(event, "delivery-deploy-status-"+state, zap.NewNop())

		require.NoError(t, err)
		require.Nil(t, logs)
	}
}

func TestDeploymentStatusUnknownStateYieldsNoLogs(t *testing.T) {
	event := deploymentStatusEventWithState(t, "waiting")

	logs, err := deploymentEventToLogs(event, "delivery-deploy-status-waiting-1", zap.NewNop())

	require.NoError(t, err)
	require.Nil(t, logs)
}

func TestDeploymentStatusInProgressEmitsPipelineStarted(t *testing.T) {
	event := deploymentStatusEventWithState(t, "in_progress")

	logs, err := deploymentEventToLogs(event, "delivery-deploy-status-started-1", zap.NewNop())

	require.NoError(t, err)
	require.Equal(t, 1, logs.LogRecordCount())
	record := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0)
	require.Equal(t, "dev.cdevents.pipelinerun.started.0.3.0", record.EventName())
	require.Equal(t, "executing", record.Attributes().AsRaw()[string(conventions.CICDPipelineRunStateKey)])
	require.Equal(t, "in_progress", record.Attributes().AsRaw()[semconv.EverrDeployStatus])
}

func TestDeploymentStatusFailureAndErrorEmitPipelineFinished(t *testing.T) {
	for _, state := range []string{"failure", "error"} {
		event := deploymentStatusEventWithState(t, state)

		logs, err := deploymentEventToLogs(event, "delivery-deploy-status-"+state, zap.NewNop())

		require.NoError(t, err)
		require.Equal(t, 1, logs.LogRecordCount())
		record := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0)
		require.Equal(t, "dev.cdevents.pipelinerun.finished.0.3.0", record.EventName())
		require.Equal(t, state, record.Attributes().AsRaw()[string(conventions.CICDPipelineResultKey)])
		require.Equal(t, state, record.Attributes().AsRaw()[semconv.EverrDeployStatus])
	}
}

func TestDeploymentLogTraceIDEmptyWithoutWorkflowRun(t *testing.T) {
	event := parseGitHubTestEvent[*github.DeploymentEvent](t, "testdata/deployment/deployment_created.json", "deployment")

	logs, err := deploymentEventToLogs(event, "delivery-deploy-no-workflow-1", zap.NewNop())

	require.NoError(t, err)
	record := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0)
	require.True(t, record.TraceID().IsEmpty())
}

func TestDeploymentLogUsesWorkflowTraceIDFromDeploymentPayload(t *testing.T) {
	event := parseGitHubTestEvent[*github.DeploymentEvent](t, "testdata/deployment/deployment_created.json", "deployment")
	event.WorkflowRun = nil
	event.Deployment.Payload = json.RawMessage(`{"workflow_run_id":456,"workflow_run_attempt":2}`)

	logs, err := deploymentEventToLogs(event, "delivery-deploy-payload-trace-1", zap.NewNop())

	require.NoError(t, err)
	expected, err := generateTraceID(654321, 456, 2)
	require.NoError(t, err)
	record := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0)
	require.Equal(t, expected, record.TraceID())
}

func TestDeploymentLogUsesEmptyStringForMissingDeploymentID(t *testing.T) {
	event := parseGitHubTestEvent[*github.DeploymentEvent](t, "testdata/deployment/deployment_created.json", "deployment")
	event.Deployment.ID = nil

	logs, err := deploymentEventToLogs(event, "delivery-deploy-missing-id-1", zap.NewNop())

	require.NoError(t, err)
	record := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0)
	attrs := record.Attributes().AsRaw()
	require.Equal(t, "", attrs[string(conventions.CICDPipelineRunIDKey)])
	require.Equal(t, "", attrs[semconv.EverrDeployID])
	require.NotContains(t, attrs, semconv.EverrGitHubDeploymentID)
	require.Contains(t, record.Body().Str(), `"deploymentId":""`)
}

func TestDeploymentEventUsesWorkflowTraceIDWhenPresent(t *testing.T) {
	event := parseGitHubTestEvent[*github.DeploymentEvent](t, "testdata/deployment/deployment_created_with_workflow_run.json", "deployment")

	logs, err := deploymentEventToLogs(event, "delivery-deploy-created-trace-1", zap.NewNop())

	require.NoError(t, err)
	expected, err := generateTraceID(654321, 456, 2)
	require.NoError(t, err)
	record := logs.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0)
	require.Equal(t, expected, record.TraceID())
}
