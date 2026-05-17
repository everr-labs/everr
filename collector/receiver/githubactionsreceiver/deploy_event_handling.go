package githubactionsreceiver

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/go-github/v67/github"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/semconv"
)

const (
	cdeventsSpecVersion        = "0.5.0"
	cdeventsPipelineRunQueued  = "dev.cdevents.pipelinerun.queued.0.3.0"
	cdeventsPipelineRunStarted = "dev.cdevents.pipelinerun.started.0.3.0"
	cdeventsPipelineRunDone    = "dev.cdevents.pipelinerun.finished.0.3.0"
	cdeventsServiceDeployed    = "dev.cdevents.service.deployed.0.3.0"
	everrDeploySuperseded      = "everr.deploy.superseded"
)

type cdeventsBody struct {
	Context cdeventsContext `json:"context"`
	Subject cdeventsSubject `json:"subject"`
}

// cdeventsContext mirrors the CDEvents v0.5.0 context object. The spec text
// and conformance examples (cdevents/spec @ v0.5.0/conformance/) name the
// version field `specversion`; the v0.5.0 JSON schema's `required` array
// erroneously lists `version`, but its `properties` only define `specversion`,
// so we follow the spec text and conformance examples here.
type cdeventsContext struct {
	Specversion string `json:"specversion"`
	ID          string `json:"id"`
	Source      string `json:"source"`
	Type        string `json:"type"`
	Timestamp   string `json:"timestamp,omitempty"`
}

// cdeventsSubject mirrors the CDEvents v0.5.0 subject object. The subject
// has no `type` field (the event type lives in context.type only), and
// `content` is event-type specific — we use per-event-type content builders
// below so the body remains schema-valid (`additionalProperties: false`).
type cdeventsSubject struct {
	ID      string `json:"id"`
	Source  string `json:"source,omitempty"`
	Content any    `json:"content"`
}

type deploymentLogInput struct {
	EventType        string
	DeliveryID       string
	CDEventsIDSuffix string
	Repo             *github.Repository
	Deployment       *github.Deployment
	Status           *github.DeploymentStatus
	WorkflowRun      *github.WorkflowRun
	WorkflowRunID    int64
	RunAttempt       int
	State            string
	Result           string
	URL              string
	Time             time.Time
}

type deploymentPayload struct {
	WorkflowRunID      int64 `json:"workflow_run_id"`
	WorkflowRunAttempt int   `json:"workflow_run_attempt"`
}

func deploymentEventToLogs(event interface{}, deliveryID string, logger *zap.Logger) (*plog.Logs, error) {
	if deliveryID == "" {
		return nil, fmt.Errorf("missing x-github-delivery")
	}

	switch e := event.(type) {
	case *github.DeploymentEvent:
		return deploymentCreatedToLogs(e, deliveryID)
	case *github.DeploymentStatusEvent:
		return deploymentStatusToLogs(e, deliveryID, logger)
	default:
		return nil, nil
	}
}

func deploymentCreatedToLogs(e *github.DeploymentEvent, deliveryID string) (*plog.Logs, error) {
	logs, records := newDeploymentLogs(e.GetRepo(), e.GetDeployment().GetEnvironment())
	record := records.AppendEmpty()
	fillDeploymentLogRecord(record, deploymentLogInput{
		EventType:   cdeventsPipelineRunQueued,
		DeliveryID:  deliveryID,
		Repo:        e.GetRepo(),
		Deployment:  e.GetDeployment(),
		WorkflowRun: e.GetWorkflowRun(),
		State:       "pending",
		Result:      "",
		URL:         "",
		Time:        firstNonZeroTime(e.GetDeployment().GetCreatedAt().Time, e.GetDeployment().GetUpdatedAt().Time),
	})
	return &logs, nil
}

func deploymentStatusToLogs(e *github.DeploymentStatusEvent, deliveryID string, logger *zap.Logger) (*plog.Logs, error) {
	status := e.GetDeploymentStatus()
	state := status.GetState()
	logs, records := newDeploymentLogs(e.GetRepo(), e.GetDeployment().GetEnvironment())

	switch state {
	case "in_progress":
		record := records.AppendEmpty()
		fillDeploymentLogRecord(record, deploymentLogInput{
			EventType:  cdeventsPipelineRunStarted,
			DeliveryID: deliveryID,
			Repo:       e.GetRepo(),
			Deployment: e.GetDeployment(),
			Status:     status,
			State:      "executing",
			URL:        firstString(status.GetEnvironmentURL(), status.GetTargetURL(), status.GetLogURL()),
			Time:       firstNonZeroTime(status.GetCreatedAt().Time, status.GetUpdatedAt().Time),
		})
	case "queued", "pending":
		logger.Debug("Skipping deployment_status state already represented by deployment event", zap.String("state", state))
	case "success":
		finished := records.AppendEmpty()
		fillDeploymentLogRecord(finished, deploymentLogInput{
			EventType:  cdeventsPipelineRunDone,
			DeliveryID: deliveryID,
			Repo:       e.GetRepo(),
			Deployment: e.GetDeployment(),
			Status:     status,
			Result:     "success",
			URL:        firstString(status.GetEnvironmentURL(), status.GetTargetURL(), status.GetLogURL()),
			Time:       firstNonZeroTime(status.GetCreatedAt().Time, status.GetUpdatedAt().Time),
		})
		deployed := records.AppendEmpty()
		fillDeploymentLogRecord(deployed, deploymentLogInput{
			EventType:        cdeventsServiceDeployed,
			DeliveryID:       deliveryID,
			CDEventsIDSuffix: "service-deployed",
			Repo:             e.GetRepo(),
			Deployment:       e.GetDeployment(),
			Status:           status,
			Result:           "success",
			URL:              firstString(status.GetEnvironmentURL(), status.GetTargetURL(), status.GetLogURL()),
			Time:             firstNonZeroTime(status.GetCreatedAt().Time, status.GetUpdatedAt().Time),
		})
	case "failure", "error":
		record := records.AppendEmpty()
		fillDeploymentLogRecord(record, deploymentLogInput{
			EventType:  cdeventsPipelineRunDone,
			DeliveryID: deliveryID,
			Repo:       e.GetRepo(),
			Deployment: e.GetDeployment(),
			Status:     status,
			Result:     state,
			URL:        firstString(status.GetEnvironmentURL(), status.GetTargetURL(), status.GetLogURL()),
			Time:       firstNonZeroTime(status.GetCreatedAt().Time, status.GetUpdatedAt().Time),
		})
	case "inactive":
		record := records.AppendEmpty()
		fillDeploymentLogRecord(record, deploymentLogInput{
			EventType:  everrDeploySuperseded,
			DeliveryID: deliveryID,
			Repo:       e.GetRepo(),
			Deployment: e.GetDeployment(),
			Status:     status,
			URL:        firstString(status.GetEnvironmentURL(), status.GetTargetURL(), status.GetLogURL()),
			Time:       firstNonZeroTime(status.GetCreatedAt().Time, status.GetUpdatedAt().Time),
		})
	default:
		logger.Debug("Skipping unsupported deployment_status state", zap.String("state", state))
	}

	if logs.LogRecordCount() == 0 {
		return nil, nil
	}
	return &logs, nil
}

func newDeploymentLogs(repo *github.Repository, environment string) (plog.Logs, plog.LogRecordSlice) {
	logs := plog.NewLogs()
	resourceLogs := logs.ResourceLogs().AppendEmpty()
	resourceLogs.SetSchemaUrl(conventions.SchemaURL)
	setDeploymentResourceAttributes(resourceLogs.Resource().Attributes(), repo, environment)
	scopeLogs := resourceLogs.ScopeLogs().AppendEmpty()
	scopeLogs.Scope().SetName("github-deployments")
	return logs, scopeLogs.LogRecords()
}

func firstString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func firstNonZeroTime(values ...time.Time) time.Time {
	for _, value := range values {
		if !value.IsZero() {
			return value
		}
	}
	return time.Now().UTC()
}

// cdeventsSource returns a CDEvents `context.source` value: an absolute URI
// per CDEvents v0.5.0 ("An absolute URI is RECOMMENDED"). It mirrors the
// repository's HTML URL so downstream consumers can join on the same identity
// they would derive from `vcs.repository.url.full`.
func cdeventsSource(repo *github.Repository) string {
	if repo != nil {
		if htmlURL := repo.GetHTMLURL(); htmlURL != "" {
			return htmlURL
		}
	}
	return "https://github.com"
}

func cdeventsID(input deploymentLogInput) string {
	if input.CDEventsIDSuffix != "" {
		return fmt.Sprintf("%s-%s", input.DeliveryID, input.CDEventsIDSuffix)
	}
	return input.DeliveryID
}

func githubIDString(id int64) string {
	if id == 0 {
		return ""
	}
	return fmt.Sprintf("%d", id)
}

func deploymentIDString(deployment *github.Deployment) string {
	return githubIDString(deployment.GetID())
}

func deploymentStatusIDString(status *github.DeploymentStatus) string {
	return githubIDString(status.GetID())
}

func workflowRunLink(deployment *github.Deployment, workflowRun *github.WorkflowRun) (int64, int) {
	if workflowRun != nil && workflowRun.GetID() > 0 && workflowRun.GetRunAttempt() > 0 {
		return workflowRun.GetID(), workflowRun.GetRunAttempt()
	}
	if deployment == nil || len(deployment.Payload) == 0 {
		return 0, 0
	}
	var payload deploymentPayload
	if err := json.Unmarshal(deployment.Payload, &payload); err != nil {
		return 0, 0
	}
	return payload.WorkflowRunID, payload.WorkflowRunAttempt
}

func cdeventsSubjectID(input deploymentLogInput) string {
	if input.EventType == cdeventsServiceDeployed {
		return deploymentServiceName(input.Deployment.GetTask())
	}
	if id := deploymentIDString(input.Deployment); id != "" {
		return fmt.Sprintf("github-deployment-%s", id)
	}
	return "github-deployment"
}

// pipelineRunContent matches the CDEvents v0.5.0 pipelinerun.* subject content
// schema (cdevents/spec @ v0.5.0/schemas/pipelinerun{queued,started,finished}.json,
// additionalProperties: false). Only `pipelineName`, `uri`, `outcome`, and
// `errors` are permitted across the three pipelinerun event types.
type pipelineRunContent struct {
	PipelineName string `json:"pipelineName,omitempty"`
	URI          string `json:"uri,omitempty"`
	Outcome      string `json:"outcome,omitempty"`
	Errors       string `json:"errors,omitempty"`
}

// serviceDeployedContent matches the CDEvents v0.5.0 service.deployed subject
// content schema. Both `environment` and `artifactId` are required and no
// additional properties are allowed.
type serviceDeployedContent struct {
	Environment serviceEnvironment `json:"environment"`
	ArtifactID  string             `json:"artifactId"`
}

type serviceEnvironment struct {
	ID     string `json:"id"`
	Source string `json:"source,omitempty"`
}

// deploymentPipelineURI returns the URI advertised in pipelinerun event bodies.
// pipelinerun.started requires a non-empty uri per the schema, so fall back to
// the repository URL when GitHub has not yet attached any status URL.
func deploymentPipelineURI(input deploymentLogInput) string {
	if input.URL != "" {
		return input.URL
	}
	if input.Repo != nil {
		if htmlURL := input.Repo.GetHTMLURL(); htmlURL != "" {
			return htmlURL
		}
	}
	return "https://github.com"
}

func pipelineRunCDEventsContent(input deploymentLogInput) pipelineRunContent {
	content := pipelineRunContent{
		PipelineName: firstString(input.Deployment.GetTask(), "deploy"),
		URI:          deploymentPipelineURI(input),
	}
	if input.EventType == cdeventsPipelineRunDone {
		content.Outcome = input.Result
		if input.Status != nil {
			content.Errors = input.Status.GetDescription()
		}
	}
	return content
}

// deploymentArtifactID returns a purl-style identifier for the deployed
// artifact. service.deployed requires a non-empty artifactId per the schema,
// so always return a stable string even when SHA or repo are missing.
func deploymentArtifactID(repo *github.Repository, sha string) string {
	switch {
	case repo == nil || repo.GetFullName() == "":
		if sha != "" {
			return fmt.Sprintf("pkg:github/unknown@%s", sha)
		}
		return "pkg:github/unknown"
	case sha == "":
		return fmt.Sprintf("pkg:github/%s", repo.GetFullName())
	default:
		return fmt.Sprintf("pkg:github/%s@%s", repo.GetFullName(), sha)
	}
}

func serviceDeployedCDEventsContent(input deploymentLogInput) serviceDeployedContent {
	envID := input.Deployment.GetEnvironment()
	if envID == "" {
		envID = "unknown"
	}
	return serviceDeployedContent{
		Environment: serviceEnvironment{ID: envID},
		ArtifactID:  deploymentArtifactID(input.Repo, input.Deployment.GetSHA()),
	}
}

func deploymentCDEventsContent(input deploymentLogInput) any {
	if input.EventType == cdeventsServiceDeployed {
		return serviceDeployedCDEventsContent(input)
	}
	return pipelineRunCDEventsContent(input)
}

func deploymentCDEventsBody(input deploymentLogInput) cdeventsBody {
	source := cdeventsSource(input.Repo)
	return cdeventsBody{
		Context: cdeventsContext{
			Specversion: cdeventsSpecVersion,
			ID:          cdeventsID(input),
			Source:      source,
			Type:        input.EventType,
			Timestamp:   input.Time.UTC().Format(time.RFC3339Nano),
		},
		Subject: cdeventsSubject{
			ID:      cdeventsSubjectID(input),
			Source:  source,
			Content: deploymentCDEventsContent(input),
		},
	}
}

func deploymentStatusValue(input deploymentLogInput) string {
	if input.Status != nil && input.Status.GetState() != "" {
		return input.Status.GetState()
	}
	return input.State
}

func fillDeploymentLogRecord(record plog.LogRecord, input deploymentLogInput) {
	record.SetEventName(input.EventType)
	record.SetTimestamp(pcommon.NewTimestampFromTime(input.Time))
	workflowRunID := input.WorkflowRunID
	runAttempt := input.RunAttempt
	if workflowRunID == 0 || runAttempt == 0 {
		workflowRunID, runAttempt = workflowRunLink(input.Deployment, input.WorkflowRun)
	}
	if input.Repo != nil && input.Repo.GetID() > 0 && workflowRunID > 0 && runAttempt > 0 {
		traceID, err := generateTraceID(input.Repo.GetID(), workflowRunID, runAttempt)
		if err == nil {
			record.SetTraceID(traceID)
		}
	}
	attrs := record.Attributes()
	attrs.PutStr(semconv.EverrGitHubDeliveryID, input.DeliveryID)
	if input.EventType != everrDeploySuperseded {
		attrs.PutStr(semconv.CDEventsType, input.EventType)
		attrs.PutStr(semconv.CDEventsID, cdeventsID(input))
		attrs.PutStr(semconv.CDEventsSource, cdeventsSource(input.Repo))
	}
	deploymentID := deploymentIDString(input.Deployment)
	attrs.PutStr(string(conventions.CICDPipelineRunIDKey), deploymentID)
	attrs.PutStr(string(conventions.CICDPipelineNameKey), firstString(input.Deployment.GetTask(), "deploy"))
	if input.State != "" {
		attrs.PutStr(string(conventions.CICDPipelineRunStateKey), input.State)
	}
	if input.Result != "" {
		attrs.PutStr(string(conventions.CICDPipelineResultKey), input.Result)
	}
	attrs.PutStr(string(conventions.VCSRefHeadRevisionKey), input.Deployment.GetSHA())
	attrs.PutStr(string(conventions.VCSRefHeadNameKey), input.Deployment.GetRef())
	attrs.PutStr(semconv.EverrDeployID, deploymentID)
	attrs.PutStr(semconv.EverrDeployServiceName, deploymentServiceName(input.Deployment.GetTask()))
	attrs.PutStr(semconv.EverrDeployStatus, deploymentStatusValue(input))
	if input.URL != "" {
		attrs.PutStr(semconv.EverrDeployURL, input.URL)
	}
	if input.Deployment.GetID() > 0 {
		attrs.PutInt(semconv.EverrGitHubDeploymentID, input.Deployment.GetID())
	}
	attrs.PutStr(semconv.EverrGitHubDeploymentCreatorLogin, input.Deployment.GetCreator().GetLogin())
	if input.Status != nil && input.Status.GetID() > 0 {
		attrs.PutInt(semconv.EverrGitHubDeploymentStatusID, input.Status.GetID())
	}
	if workflowRunID > 0 && runAttempt > 0 {
		attrs.PutInt(semconv.EverrGitHubWorkflowRunID, workflowRunID)
		attrs.PutInt(semconv.EverrGitHubWorkflowRunRunAttempt, int64(runAttempt))
	}
	if input.EventType == everrDeploySuperseded {
		bodyBytes, _ := json.Marshal(map[string]any{
			"deploymentId":       deploymentIDString(input.Deployment),
			"deploymentStatusId": deploymentStatusIDString(input.Status),
			"environment":        input.Deployment.GetEnvironment(),
			"githubDeliveryId":   input.DeliveryID,
		})
		record.Body().SetStr(string(bodyBytes))
	} else {
		bodyBytes, _ := json.Marshal(deploymentCDEventsBody(input))
		record.Body().SetStr(string(bodyBytes))
	}
}
