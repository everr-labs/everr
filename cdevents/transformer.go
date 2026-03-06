package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/cdevents/sdk-go/pkg/api"
	"github.com/google/go-github/v67/github"
)

type transformer struct{}

type transformInput struct {
	EventType  string
	DeliveryID string
	TenantID   uint64
	Parsed     interface{}
}

func (t transformer) Transform(input transformInput) ([]eventRow, error) {
	switch event := input.Parsed.(type) {
	case *github.WorkflowRunEvent:
		row, ok, err := t.transformWorkflowRun(input, event)
		if err != nil || !ok {
			return nil, err
		}
		return []eventRow{row}, nil
	case *github.WorkflowJobEvent:
		row, ok, err := t.transformWorkflowJob(input, event)
		if err != nil || !ok {
			return nil, err
		}
		return []eventRow{row}, nil
	default:
		return nil, nil
	}
}

func (t transformer) transformWorkflowRun(input transformInput, event *github.WorkflowRunEvent) (eventRow, bool, error) {
	if event == nil || event.WorkflowRun == nil {
		return eventRow{}, false, nil
	}

	run := event.WorkflowRun
	action := strings.TrimSpace(event.GetAction())

	switch action {
	case "requested":
		cdevent, err := api.NewPipelineRunQueuedEventV0_2_0(specVersion)
		if err != nil {
			return eventRow{}, false, err
		}
		populateWorkflowRunEventBase(cdevent, input, event)
		cdevent.SetTimestamp(firstTimestamp(run.CreatedAt, run.UpdatedAt, run.RunStartedAt))
		return t.buildRow(input, run.GetID(), run.GetName(), run.GetHTMLURL(), run.GetHeadSHA(), run.GetHeadBranch(), "", run.GetRepository().GetFullName(), cdevent)
	case "in_progress":
		cdevent, err := api.NewPipelineRunStartedEventV0_2_0(specVersion)
		if err != nil {
			return eventRow{}, false, err
		}
		populateWorkflowRunEventBase(cdevent, input, event)
		cdevent.SetTimestamp(firstTimestamp(run.RunStartedAt, run.UpdatedAt, run.CreatedAt))
		return t.buildRow(input, run.GetID(), run.GetName(), run.GetHTMLURL(), run.GetHeadSHA(), run.GetHeadBranch(), "", run.GetRepository().GetFullName(), cdevent)
	case "completed":
		cdevent, err := api.NewPipelineRunFinishedEventV0_2_0(specVersion)
		if err != nil {
			return eventRow{}, false, err
		}
		populateWorkflowRunEventBase(cdevent, input, event)
		cdevent.SetTimestamp(firstTimestamp(run.UpdatedAt, run.RunStartedAt, run.CreatedAt))
		outcome := mapOutcome(run.GetConclusion())
		if outcome != "" {
			cdevent.SetSubjectOutcome(outcome)
		}
		return t.buildRow(input, run.GetID(), run.GetName(), run.GetHTMLURL(), run.GetHeadSHA(), run.GetHeadBranch(), outcome, run.GetRepository().GetFullName(), cdevent)
	default:
		return eventRow{}, false, nil
	}
}

func (t transformer) transformWorkflowJob(input transformInput, event *github.WorkflowJobEvent) (eventRow, bool, error) {
	if event == nil || event.WorkflowJob == nil {
		return eventRow{}, false, nil
	}

	job := event.WorkflowJob
	action := strings.TrimSpace(event.GetAction())

	switch action {
	case "in_progress":
		cdevent, err := api.NewTaskRunStartedEventV0_2_0(specVersion)
		if err != nil {
			return eventRow{}, false, err
		}
		populateWorkflowJobEventBase(cdevent, input, event)
		cdevent.SetTimestamp(firstTimestamp(job.StartedAt, job.CreatedAt))
		cdevent.SetSubjectPipelineRun(&api.Reference{Id: strconv.FormatInt(job.GetRunID(), 10), Source: repositoryHTMLURL(event.Repo)})
		return t.buildRow(input, job.GetID(), job.GetName(), job.GetHTMLURL(), job.GetHeadSHA(), job.GetHeadBranch(), "", event.GetRepo().GetFullName(), cdevent)
	case "completed":
		cdevent, err := api.NewTaskRunFinishedEventV0_2_0(specVersion)
		if err != nil {
			return eventRow{}, false, err
		}
		populateWorkflowJobEventBase(cdevent, input, event)
		cdevent.SetTimestamp(firstTimestamp(job.CompletedAt, job.StartedAt, job.CreatedAt))
		cdevent.SetSubjectPipelineRun(&api.Reference{Id: strconv.FormatInt(job.GetRunID(), 10), Source: repositoryHTMLURL(event.Repo)})
		outcome := mapOutcome(job.GetConclusion())
		if outcome != "" {
			cdevent.SetSubjectOutcome(outcome)
		}
		return t.buildRow(input, job.GetID(), job.GetName(), job.GetHTMLURL(), job.GetHeadSHA(), job.GetHeadBranch(), outcome, event.GetRepo().GetFullName(), cdevent)
	default:
		return eventRow{}, false, nil
	}
}

func populateWorkflowRunEventBase(event workflowRunEventWriter, input transformInput, payload *github.WorkflowRunEvent) {
	run := payload.WorkflowRun
	event.SetId(input.DeliveryID)
	event.SetSource(repositoryHTMLURL(payload.Repo))
	event.SetSubjectId(strconv.FormatInt(run.GetID(), 10))
	event.SetSubjectPipelineName(run.GetName())
	event.SetSubjectUrl(run.GetHTMLURL())
}

func populateWorkflowJobEventBase(event workflowJobEventWriter, input transformInput, payload *github.WorkflowJobEvent) {
	job := payload.WorkflowJob
	event.SetId(input.DeliveryID)
	event.SetSource(repositoryHTMLURL(payload.Repo))
	event.SetSubjectId(strconv.FormatInt(job.GetID(), 10))
	event.SetSubjectTaskName(job.GetName())
	event.SetSubjectUrl(job.GetHTMLURL())
}

func (t transformer) buildRow(input transformInput, subjectID int64, subjectName, subjectURL, sha, gitRef, outcome, repository string, event api.CDEventReader) (eventRow, bool, error) {
	if err := api.Validate(event); err != nil {
		return eventRow{}, false, fmt.Errorf("validate cdevent: %w", err)
	}

	cdeventJSON, err := json.Marshal(event)
	if err != nil {
		return eventRow{}, false, fmt.Errorf("marshal cdevent: %w", err)
	}

	eventType := event.GetType()
	return eventRow{
		TenantID:      input.TenantID,
		DeliveryID:    input.DeliveryID,
		EventKind:     eventType.Subject,
		EventPhase:    eventType.Predicate,
		EventTime:     event.GetTimestamp().UTC(),
		SubjectID:     strconv.FormatInt(subjectID, 10),
		SubjectName:   subjectName,
		SubjectURL:    subjectURL,
		PipelineRunID: pipelineRunID(event),
		Repository:    repository,
		SHA:           sha,
		GitRef:        gitRef,
		Outcome:       outcome,
		CDEventJSON:   string(cdeventJSON),
	}, true, nil
}

type workflowRunEventWriter interface {
	api.CDEventReader
	SetId(string)
	SetSource(string)
	SetTimestamp(time.Time)
	SetSubjectId(string)
	SetSubjectPipelineName(string)
	SetSubjectUrl(string)
}

type workflowJobEventWriter interface {
	api.CDEventReader
	SetId(string)
	SetSource(string)
	SetTimestamp(time.Time)
	SetSubjectId(string)
	SetSubjectTaskName(string)
	SetSubjectUrl(string)
}

type pipelineRefReader interface {
	GetSubjectContent() interface{}
}

func pipelineRunID(event api.CDEventReader) string {
	reader, ok := event.(pipelineRefReader)
	if !ok {
		return ""
	}

	switch content := reader.GetSubjectContent().(type) {
	case api.TaskRunStartedSubjectContentV0_2_0:
		if content.PipelineRun != nil {
			return content.PipelineRun.Id
		}
	case api.TaskRunFinishedSubjectContentV0_2_0:
		if content.PipelineRun != nil {
			return content.PipelineRun.Id
		}
	}

	return ""
}

func firstTimestamp(values ...*github.Timestamp) time.Time {
	for _, value := range values {
		if value != nil {
			return value.Time.UTC()
		}
	}
	return time.Now().UTC()
}

func mapOutcome(conclusion string) string {
	switch conclusion {
	case "success":
		return "success"
	case "failure":
		return "failure"
	case "cancelled":
		return "cancelled"
	case "timed_out", "startup_failure":
		return "error"
	case "skipped", "neutral":
		return "skipped"
	case "action_required":
		return "action_required"
	case "stale":
		return "stale"
	default:
		return ""
	}
}

func repositoryHTMLURL(repo *github.Repository) string {
	if repo == nil {
		return "https://github.com"
	}
	if htmlURL := repo.GetHTMLURL(); htmlURL != "" {
		return htmlURL
	}
	if fullName := repo.GetFullName(); fullName != "" {
		return "https://github.com/" + fullName
	}
	return "https://github.com"
}
