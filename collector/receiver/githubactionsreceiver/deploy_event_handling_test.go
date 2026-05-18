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

func keysOf(m map[string]json.RawMessage) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func rawSubjectContent(t *testing.T, body string) map[string]json.RawMessage {
	t.Helper()
	var raw map[string]json.RawMessage
	require.NoError(t, json.Unmarshal([]byte(body), &raw))
	var subject map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(raw["subject"], &subject))
	var content map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(subject["content"], &content))
	return content
}

func jsonString(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	if len(raw) == 0 {
		return ""
	}
	var s string
	require.NoError(t, json.Unmarshal(raw, &s))
	return s
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
	require.Equal(t, "0.5.0", body.Context.Specversion)
	require.Equal(t, "delivery-deploy-created-1", body.Context.ID)
	require.Equal(t, "dev.cdevents.pipelinerun.queued.0.3.0", body.Context.Type)
	require.Equal(t, "https://github.com/everr-labs/everr-deploy", body.Context.Source)
	require.Equal(t, "https://github.com/everr-labs/everr-deploy", body.Subject.Source)
	require.Equal(t, "https://github.com/everr-labs/everr-deploy", record.Attributes().AsRaw()[semconv.CDEventsSource])

	// Raw body shape: assert the JSON contains only the CDEvents-allowed keys
	// (the schema for pipelinerun events sets `additionalProperties: false`).
	var raw map[string]json.RawMessage
	require.NoError(t, json.Unmarshal([]byte(record.Body().Str()), &raw))
	require.ElementsMatch(t, []string{"context", "subject"}, keysOf(raw))
	var rawContext, rawSubject map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(raw["context"], &rawContext))
	require.NoError(t, json.Unmarshal(raw["subject"], &rawSubject))
	require.ElementsMatch(t, []string{"specversion", "id", "source", "type", "timestamp"}, keysOf(rawContext))
	require.ElementsMatch(t, []string{"id", "source", "content"}, keysOf(rawSubject))
	var rawContent map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(rawSubject["content"], &rawContent))
	for k := range rawContent {
		require.Contains(t, []string{"pipelineName", "uri", "outcome", "errors"}, k)
	}
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
	require.Equal(t, "0.5.0", finishedBody.Context.Specversion)
	require.Equal(t, "delivery-deploy-status-success-1", finishedBody.Context.ID)
	require.Equal(t, "dev.cdevents.pipelinerun.finished.0.3.0", finishedBody.Context.Type)

	// pipelinerun.finished content: only {pipelineName, uri, outcome, errors} are
	// allowed per the CDEvents v0.5.0 schema (additionalProperties: false).
	finishedContent := rawSubjectContent(t, records.At(0).Body().Str())
	for k := range finishedContent {
		require.Contains(t, []string{"pipelineName", "uri", "outcome", "errors"}, k)
	}
	require.Equal(t, "success", jsonString(t, finishedContent["outcome"]))
	require.NotEmpty(t, jsonString(t, finishedContent["pipelineName"]))
	require.NotEmpty(t, jsonString(t, finishedContent["uri"]))

	var deployedBody cdeventsBody
	require.NoError(t, json.Unmarshal([]byte(records.At(1).Body().Str()), &deployedBody))
	require.Equal(t, "0.5.0", deployedBody.Context.Specversion)
	require.Equal(t, "delivery-deploy-status-success-1-service-deployed", deployedBody.Context.ID)
	require.Equal(t, "dev.cdevents.service.deployed.0.3.0", deployedBody.Context.Type)

	// service.deployed content: only {environment, artifactId} are allowed and
	// both are required per the CDEvents v0.5.0 schema.
	deployedContent := rawSubjectContent(t, records.At(1).Body().Str())
	require.ElementsMatch(t, []string{"environment", "artifactId"}, keysOf(deployedContent))
	require.Equal(t, "pkg:github/everr-labs/everr-deploy@abc123", jsonString(t, deployedContent["artifactId"]))
	var env map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(deployedContent["environment"], &env))
	for k := range env {
		require.Contains(t, []string{"id", "source"}, k)
	}
	require.Equal(t, "production", jsonString(t, env["id"]))
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
	// CDEvents subject.content for pipelinerun has no deploymentId field —
	// the deployment id lives in the queryable log attributes above. The
	// subject.id falls back to "github-deployment" when the id is missing.
	var body cdeventsBody
	require.NoError(t, json.Unmarshal([]byte(record.Body().Str()), &body))
	require.Equal(t, "github-deployment", body.Subject.ID)
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
