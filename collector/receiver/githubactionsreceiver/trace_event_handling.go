package githubactionsreceiver

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/google/go-github/v67/github"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.uber.org/zap"

	"github.com/get-citric/citric/collector/semconv"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
)

func mapConclusion(conclusion string) string {
	switch conclusion {
	case "skipped":
		return "skip"
	case "cancelled":
		return "cancellation"
	case "timed_out":
		return "timeout"
	default:
		return conclusion
	}
}

func eventToTraces(event interface{}, config *Config, logger *zap.Logger, tenantID int64) (*ptrace.Traces, error) {
	logger.Debug("Determining event")
	traces := ptrace.NewTraces()
	resourceSpans := traces.ResourceSpans().AppendEmpty()
	scopeSpans := resourceSpans.ScopeSpans().AppendEmpty()

	switch e := event.(type) {
	case *github.WorkflowJobEvent:
		logger.Info("Processing WorkflowJobEvent", zap.Int64("job_id", e.WorkflowJob.GetID()), zap.String("job_name", e.GetWorkflowJob().GetName()), zap.String("repo", e.GetRepo().GetFullName()))
		jobResource := resourceSpans.Resource()
		createResourceAttributes(jobResource, e, config, logger, tenantID)

		traceID, err := generateTraceID(e.GetWorkflowJob().GetRunID(), int(e.GetWorkflowJob().GetRunAttempt()))
		if err != nil {
			logger.Error("Failed to generate trace ID", zap.Error(err))
			return nil, fmt.Errorf("failed to generate trace ID: %w", err)
		}

		parentSpanID, err := createParentSpan(scopeSpans, e.GetWorkflowJob().Steps, e.GetWorkflowJob(), traceID, logger)
		if err != nil {
			return nil, fmt.Errorf("failed to create parent span: %w", err)
		}
		processSteps(scopeSpans, e.GetWorkflowJob().Steps, e.GetWorkflowJob(), traceID, parentSpanID, logger)

	case *github.WorkflowRunEvent:
		logger.Info("Processing WorkflowRunEvent", zap.Int64("workflow_id", e.GetWorkflowRun().GetID()), zap.String("workflow_name", e.GetWorkflowRun().GetName()), zap.String("repo", e.GetRepo().GetFullName()))
		runResource := resourceSpans.Resource()

		traceID, err := generateTraceID(e.GetWorkflowRun().GetID(), e.GetWorkflowRun().GetRunAttempt())
		if err != nil {
			logger.Error("Failed to generate trace ID", zap.Error(err))
			return nil, fmt.Errorf("failed to generate trace ID: %w", err)
		}

		createResourceAttributes(runResource, e, config, logger, tenantID)
		_, err = createRootSpan(resourceSpans, e, traceID, logger)
		if err != nil {
			return nil, fmt.Errorf("failed to create root span: %w", err)
		}

	default:
		logger.Error("unknown event type, dropping payload")
		return nil, fmt.Errorf("unknown event type")
	}

	return &traces, nil
}

func createParentSpan(scopeSpans ptrace.ScopeSpans, steps []*github.TaskStep, job *github.WorkflowJob, traceID pcommon.TraceID, logger *zap.Logger) (pcommon.SpanID, error) {
	logger.Debug("Creating parent span", zap.String("name", job.GetName()))
	span := scopeSpans.Spans().AppendEmpty()
	span.SetTraceID(traceID)

	parentSpanID, err := generateParentSpanID(job.GetRunID(), int(job.GetRunAttempt()))
	if err != nil {
		return pcommon.SpanID{}, fmt.Errorf("failed to generate parent span ID: %w", err)
	}
	span.SetParentSpanID(parentSpanID)

	jobSpanID, err := generateJobSpanID(job.GetRunID(), int(job.GetRunAttempt()), job.GetName())
	if err != nil {
		return pcommon.SpanID{}, fmt.Errorf("failed to generate job span ID: %w", err)
	}
	logger.Debug("Generated Job Span ID",
		zap.Int64("RunID", job.GetRunID()),
		zap.Int("RunAttempt", int(job.GetRunAttempt())),
		zap.String("JobName", job.GetName()),
		zap.String("SpanID", jobSpanID.String()),
	)
	span.SetSpanID(jobSpanID)

	span.SetName(job.GetName())
	span.SetKind(ptrace.SpanKindServer)
	if len(steps) > 0 {
		setSpanTimes(span, steps[0].GetStartedAt().Time, steps[len(steps)-1].GetCompletedAt().Time)
	} else {
		logger.Warn("No steps found, defaulting to job times")
		setSpanTimes(span, job.GetStartedAt().Time, job.GetCompletedAt().Time)
	}

	allSuccessful := true
	anyFailure := false
	for _, step := range steps {
		if step.GetStatus() != "completed" || step.GetConclusion() != "success" {
			allSuccessful = false
		}
		if step.GetConclusion() == "failure" {
			anyFailure = true
			break
		}
	}

	if anyFailure {
		span.Status().SetCode(ptrace.StatusCodeError)
	} else if allSuccessful {
		span.Status().SetCode(ptrace.StatusCodeOk)
	} else {
		span.Status().SetCode(ptrace.StatusCodeUnset)
	}

	span.Status().SetMessage(mapConclusion(job.GetConclusion()))

	return span.SpanID(), nil
}

func convertPRURL(apiURL string) string {
	apiURL = strings.Replace(apiURL, "/repos", "", 1)
	apiURL = strings.Replace(apiURL, "/pulls", "/pull", 1)
	return strings.Replace(apiURL, "api.", "", 1)
}

func createRootSpan(resourceSpans ptrace.ResourceSpans, event *github.WorkflowRunEvent, traceID pcommon.TraceID, logger *zap.Logger) (pcommon.SpanID, error) {
	logger.Debug("Creating root parent span", zap.String("name", event.GetWorkflowRun().GetName()))
	scopeSpans := resourceSpans.ScopeSpans().AppendEmpty()
	span := scopeSpans.Spans().AppendEmpty()

	rootSpanID, err := generateParentSpanID(event.GetWorkflowRun().GetID(), event.GetWorkflowRun().GetRunAttempt())
	if err != nil {
		logger.Error("Failed to generate root span ID", zap.Error(err))
		return pcommon.SpanID{}, fmt.Errorf("failed to generate root span ID: %w", err)
	}

	span.SetTraceID(traceID)
	span.SetSpanID(rootSpanID)
	span.SetName(event.GetWorkflowRun().GetName())
	span.SetKind(ptrace.SpanKindServer)
	setSpanTimes(span, event.GetWorkflowRun().GetRunStartedAt().Time, event.GetWorkflowRun().GetUpdatedAt().Time)

	conclusion := mapConclusion(event.GetWorkflowRun().GetConclusion())
	switch conclusion {
	case "success":
		span.Status().SetCode(ptrace.StatusCodeOk)
	case "failure":
		span.Status().SetCode(ptrace.StatusCodeError)
	default:
		span.Status().SetCode(ptrace.StatusCodeUnset)
	}

	span.Status().SetMessage(conclusion)

	// Attempt to link to previous trace ID if applicable
	if event.GetWorkflowRun().GetPreviousAttemptURL() != "" && event.GetWorkflowRun().GetRunAttempt() > 1 {
		logger.Debug("Linking to previous trace ID for WorkflowRunEvent")
		previousRunAttempt := event.GetWorkflowRun().GetRunAttempt() - 1
		previousTraceID, err := generateTraceID(event.GetWorkflowRun().GetID(), previousRunAttempt)
		if err != nil {
			logger.Error("Failed to generate previous trace ID", zap.Error(err))
		} else {
			link := span.Links().AppendEmpty()
			link.SetTraceID(previousTraceID)
			logger.Debug("Successfully linked to previous trace ID", zap.String("previousTraceID", previousTraceID.String()))
		}
	}

	return rootSpanID, nil
}

func createSpan(scopeSpans ptrace.ScopeSpans, step *github.TaskStep, job *github.WorkflowJob, traceID pcommon.TraceID, parentSpanID pcommon.SpanID, logger *zap.Logger) (pcommon.SpanID, error) {
	logger.Debug("Processing span", zap.String("step_name", step.GetName()))
	span := scopeSpans.Spans().AppendEmpty()
	span.SetTraceID(traceID)
	span.SetParentSpanID(parentSpanID)

	span.Attributes().PutStr(string(conventions.CICDPipelineTaskNameKey), step.GetName())
	span.Attributes().PutStr(semconv.CitricGitHubWorkflowJobStepStatus, step.GetStatus())
	span.Attributes().PutStr(string(conventions.CICDPipelineTaskRunResultKey), mapConclusion(step.GetConclusion()))
	span.Attributes().PutInt(semconv.CitricGitHubWorkflowJobStepNumber, step.GetNumber())

	spanID, err := generateStepSpanID(job.GetRunID(), int(job.GetRunAttempt()), job.GetName(), step.GetNumber())
	if err != nil {
		return pcommon.SpanID{}, fmt.Errorf("failed to generate step span ID: %w", err)
	}
	span.SetSpanID(spanID)

	// Set completed_at to same as started_at if ""
	// GitHub emits zero values sometimes
	if step.GetCompletedAt().IsZero() {
		step.CompletedAt = step.StartedAt
	}
	span.Attributes().PutStr(semconv.CitricGitHubWorkflowJobStepStartedAt, step.GetStartedAt().Format(time.RFC3339))
	span.Attributes().PutStr(semconv.CitricGitHubWorkflowJobStepCompletedAt, step.GetCompletedAt().Format(time.RFC3339))
	setSpanTimes(span, step.GetStartedAt().Time, step.GetCompletedAt().Time)

	span.SetName(step.GetName())
	span.SetKind(ptrace.SpanKindServer)

	stepConclusion := mapConclusion(step.GetConclusion())
	switch stepConclusion {
	case "success":
		span.Status().SetCode(ptrace.StatusCodeOk)
	case "failure":
		span.Status().SetCode(ptrace.StatusCodeError)
	default:
		span.Status().SetCode(ptrace.StatusCodeUnset)
	}

	span.Status().SetMessage(stepConclusion)

	return span.SpanID(), nil
}

func generateTraceID(runID int64, runAttempt int) (pcommon.TraceID, error) {
	input := fmt.Sprintf("%d%dt", runID, runAttempt)
	hash := sha256.Sum256([]byte(input))
	traceIDHex := hex.EncodeToString(hash[:])

	var traceID pcommon.TraceID
	_, err := hex.Decode(traceID[:], []byte(traceIDHex[:32]))
	if err != nil {
		return pcommon.TraceID{}, err
	}

	return traceID, nil
}

func generateJobSpanID(runID int64, runAttempt int, job string) (pcommon.SpanID, error) {
	input := fmt.Sprintf("%d%d%s", runID, runAttempt, job)
	hash := sha256.Sum256([]byte(input))
	spanIDHex := hex.EncodeToString(hash[:])

	var spanID pcommon.SpanID
	_, err := hex.Decode(spanID[:], []byte(spanIDHex[16:32]))
	if err != nil {
		return pcommon.SpanID{}, err
	}

	return spanID, nil
}

func generateParentSpanID(runID int64, runAttempt int) (pcommon.SpanID, error) {
	input := fmt.Sprintf("%d%ds", runID, runAttempt)
	hash := sha256.Sum256([]byte(input))
	spanIDHex := hex.EncodeToString(hash[:])

	var spanID pcommon.SpanID
	_, err := hex.Decode(spanID[:], []byte(spanIDHex[16:32]))
	if err != nil {
		return pcommon.SpanID{}, err
	}

	return spanID, nil
}

func generateServiceName(config *Config, fullName string) string {
	if config.CustomServiceName != "" {
		return config.CustomServiceName
	}
	formattedName := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(fullName, "/", "-"), "_", "-"))
	return fmt.Sprintf("%s%s%s", config.ServiceNamePrefix, formattedName, config.ServiceNameSuffix)
}

func generateStepSpanID(runID int64, runAttempt int, jobName string, stepNumber int64) (pcommon.SpanID, error) {
	input := fmt.Sprintf("%d%d%s%d", runID, runAttempt, jobName, stepNumber)
	hash := sha256.Sum256([]byte(input))
	spanIDHex := hex.EncodeToString(hash[:])

	var spanID pcommon.SpanID
	_, err := hex.Decode(spanID[:], []byte(spanIDHex[16:32]))
	if err != nil {
		return pcommon.SpanID{}, err
	}

	return spanID, nil
}

func processSteps(scopeSpans ptrace.ScopeSpans, steps []*github.TaskStep, job *github.WorkflowJob, traceID pcommon.TraceID, parentSpanID pcommon.SpanID, logger *zap.Logger) {
	for _, step := range steps {
		if _, err := createSpan(scopeSpans, step, job, traceID, parentSpanID, logger); err != nil {
			logger.Error("Failed to create span for step", zap.String("step_name", step.GetName()), zap.Error(err))
		}
	}
}

func setSpanTimes(span ptrace.Span, start, end time.Time) {
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(start))
	span.SetEndTimestamp(pcommon.NewTimestampFromTime(end))
}

func transformGitHubAPIURL(apiURL string) string {
	htmlURL := strings.Replace(apiURL, "api.github.com/repos", "github.com", 1)
	return htmlURL
}
