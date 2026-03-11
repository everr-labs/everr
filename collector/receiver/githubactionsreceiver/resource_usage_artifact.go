package githubactionsreceiver

import (
	"archive/zip"
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	urlpkg "net/url"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/go-github/v67/github"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/semconv"
)

const (
	resourceUsageArtifactName    = "everr-resource-usage-v1"
	maxResourceUsageArtifactSize = 64 * 1024 * 1024 // 64 MB
)

type workflowRunActionsAPI interface {
	ListWorkflowRunArtifacts(ctx context.Context, owner, repo string, runID int64, opts *github.ListOptions) (*github.ArtifactList, *github.Response, error)
	DownloadArtifact(ctx context.Context, owner, repo string, artifactID int64, maxRedirects int) (*urlpkg.URL, *github.Response, error)
	ListWorkflowJobs(ctx context.Context, owner, repo string, runID int64, opts *github.ListWorkflowJobsOptions) (*github.Jobs, *github.Response, error)
}

type resourceUsageManifest struct {
	SchemaVersion         int                        `json:"schemaVersion"`
	Repo                  string                     `json:"repo"`
	RunID                 int64                      `json:"runId"`
	RunAttempt            int                        `json:"runAttempt"`
	SampleIntervalSeconds int                        `json:"sampleIntervalSeconds"`
	GeneratedAt           string                     `json:"generatedAt"`
	Jobs                  []resourceUsageManifestJob `json:"jobs"`
}

type resourceUsageManifestJob struct {
	CheckRunID  int64  `json:"checkRunId"`
	SampleCount int    `json:"sampleCount"`
	SummaryPath string `json:"summaryPath"`
	SamplesPath string `json:"samplesPath"`
}

type resourceUsageSummary struct {
	SchemaVersion         int    `json:"schemaVersion"`
	CheckRunID            int64  `json:"checkRunId"`
	Repo                  string `json:"repo"`
	RunID                 int64  `json:"runId"`
	RunAttempt            int    `json:"runAttempt"`
	GitHubJob             string `json:"githubJob"`
	SampleIntervalSeconds int    `json:"sampleIntervalSeconds"`
	StartedAt             string `json:"startedAt"`
	CompletedAt           string `json:"completedAt"`
	Runner                struct {
		Name string `json:"name"`
		OS   string `json:"os"`
		Arch string `json:"arch"`
	} `json:"runner"`
	SampleCount int   `json:"sampleCount"`
	DurationMs  int64 `json:"durationMs"`
	CPU         struct {
		AvgPct float64 `json:"avgPct"`
		P95Pct float64 `json:"p95Pct"`
		MaxPct float64 `json:"maxPct"`
	} `json:"cpu"`
	Memory struct {
		AvgUsedBytes float64 `json:"avgUsedBytes"`
		MaxUsedBytes float64 `json:"maxUsedBytes"`
	} `json:"memory"`
	Disk struct {
		PeakUsedBytes      float64 `json:"peakUsedBytes"`
		PeakUtilizationPct float64 `json:"peakUtilizationPct"`
	} `json:"disk"`
	Load1 struct {
		Max float64 `json:"max"`
	} `json:"load1"`
}

type resourceUsageSample struct {
	Timestamp            string  `json:"timestamp"`
	CPUUtilizationPct    float64 `json:"cpuUtilizationPct"`
	MemoryUsedBytes      float64 `json:"memoryUsedBytes"`
	MemoryAvailableBytes float64 `json:"memoryAvailableBytes"`
	DiskUsedBytes        float64 `json:"diskUsedBytes"`
	DiskAvailableBytes   float64 `json:"diskAvailableBytes"`
	DiskUtilizationPct   float64 `json:"diskUtilizationPct"`
	Load1                float64 `json:"load1"`
}

func appendResourceUsageLogs(
	ctx context.Context,
	event *github.WorkflowRunEvent,
	actionsAPI workflowRunActionsAPI,
	httpClient *http.Client,
	logger *zap.Logger,
	resourceLogs plog.ResourceLogs,
	traceID pcommon.TraceID,
	withTraceInfo bool,
) {
	owner := event.GetRepo().GetOwner().GetLogin()
	repo := event.GetRepo().GetName()
	runID := event.GetWorkflowRun().GetID()

	artifact, ok := findResourceUsageArtifact(ctx, actionsAPI, owner, repo, runID, logger)
	if !ok {
		return
	}

	archive, cleanup, err := downloadArtifactArchive(ctx, httpClient, actionsAPI, owner, repo, artifact.GetID())
	if err != nil {
		logger.Warn("Skipping resource usage artifact download", zap.Error(err), zap.Int64("artifact_id", artifact.GetID()))
		return
	}
	defer cleanup()

	filesByName := make(map[string]*zip.File, len(archive.File))
	for _, file := range archive.File {
		filesByName[file.Name] = file
	}

	manifest := resourceUsageManifest{}
	if err := readJSONFromArchive(filesByName["manifest.json"], &manifest); err != nil {
		logger.Warn("Skipping resource usage artifact with invalid manifest", zap.Error(err))
		return
	}

	if manifest.SchemaVersion != 1 {
		logger.Warn("Skipping resource usage artifact with unsupported schema version", zap.Int("schema_version", manifest.SchemaVersion))
		return
	}

	jobsByCheckRunID, err := listWorkflowJobsByCheckRunID(ctx, actionsAPI, owner, repo, runID)
	if err != nil {
		logger.Warn("Skipping resource usage enrichment because workflow jobs could not be listed", zap.Error(err))
		return
	}

	for _, manifestJob := range manifest.Jobs {
		job, found := jobsByCheckRunID[manifestJob.CheckRunID]
		if !found {
			logger.Warn("Skipping resource usage entry with unmatched check run id", zap.Int64("check_run_id", manifestJob.CheckRunID))
			continue
		}

		jobSpanID, err := generateJobSpanID(runID, event.GetWorkflowRun().GetRunAttempt(), job.GetName())
		if err != nil {
			logger.Warn("Skipping resource usage entry because job span id generation failed", zap.Error(err), zap.String("job_name", job.GetName()))
			continue
		}

		scopeLogs := resourceLogs.ScopeLogs().AppendEmpty()
		scopeLogs.Scope().Attributes().PutStr(string(conventions.CICDPipelineTaskNameKey), job.GetName())

		summary := resourceUsageSummary{}
		if manifestJob.SummaryPath != "" && filesByName[manifestJob.SummaryPath] != nil {
			if err := readJSONFromArchive(filesByName[manifestJob.SummaryPath], &summary); err != nil {
				logger.Warn("Skipping malformed resource usage summary", zap.Error(err), zap.String("path", manifestJob.SummaryPath))
			} else {
				appendResourceUsageSummaryRecord(scopeLogs, summary, manifest, manifestJob.CheckRunID, job, jobSpanID, traceID, withTraceInfo)
			}
		}

		if manifestJob.SamplesPath == "" || filesByName[manifestJob.SamplesPath] == nil {
			continue
		}

		samples, err := readSamplesFromArchive(filesByName[manifestJob.SamplesPath])
		if err != nil {
			logger.Warn("Skipping malformed resource usage samples", zap.Error(err), zap.String("path", manifestJob.SamplesPath))
			continue
		}

		appendResourceUsageSampleRecords(scopeLogs, samples, summary, manifest, manifestJob.CheckRunID, job, jobSpanID, traceID, withTraceInfo)
	}
}

func findResourceUsageArtifact(
	ctx context.Context,
	actionsAPI workflowRunActionsAPI,
	owner string,
	repo string,
	runID int64,
	logger *zap.Logger,
) (*github.Artifact, bool) {
	opts := &github.ListOptions{PerPage: 100}
	var selected *github.Artifact

	for {
		list, response, err := actionsAPI.ListWorkflowRunArtifacts(ctx, owner, repo, runID, opts)
		if err != nil {
			logger.Warn("Failed to list workflow run artifacts", zap.Error(err))
			return nil, false
		}

		for _, artifact := range list.Artifacts {
			if artifact.GetName() != resourceUsageArtifactName {
				continue
			}
			if selected == nil || artifact.GetUpdatedAt().Time.After(selected.GetUpdatedAt().Time) {
				selected = artifact
			}
		}

		if response == nil || response.NextPage == 0 {
			break
		}
		opts.Page = response.NextPage
	}

	if selected == nil {
		logger.Debug("Resource usage artifact not found")
		return nil, false
	}

	if selected.GetExpired() {
		logger.Warn("Resource usage artifact expired", zap.Int64("artifact_id", selected.GetID()))
		return nil, false
	}

	return selected, true
}

func listWorkflowJobsByCheckRunID(
	ctx context.Context,
	actionsAPI workflowRunActionsAPI,
	owner string,
	repo string,
	runID int64,
) (map[int64]*github.WorkflowJob, error) {
	opts := &github.ListWorkflowJobsOptions{
		Filter: "latest",
		ListOptions: github.ListOptions{
			PerPage: 100,
		},
	}
	jobsByCheckRunID := make(map[int64]*github.WorkflowJob)

	for {
		jobs, response, err := actionsAPI.ListWorkflowJobs(ctx, owner, repo, runID, opts)
		if err != nil {
			return nil, err
		}

		for _, job := range jobs.Jobs {
			checkRunID, ok := workflowJobCheckRunID(job)
			if !ok {
				continue
			}
			jobsByCheckRunID[checkRunID] = job
		}

		if response == nil || response.NextPage == 0 {
			break
		}
		opts.Page = response.NextPage
	}

	return jobsByCheckRunID, nil
}

func workflowJobCheckRunID(job *github.WorkflowJob) (int64, bool) {
	checkRunURL := job.GetCheckRunURL()
	if checkRunURL == "" {
		return 0, false
	}

	parsed, err := urlpkg.Parse(checkRunURL)
	if err != nil {
		return 0, false
	}

	checkRunID, err := strconv.ParseInt(path.Base(parsed.Path), 10, 64)
	if err != nil {
		return 0, false
	}

	return checkRunID, true
}

func downloadArtifactArchive(
	ctx context.Context,
	httpClient *http.Client,
	actionsAPI workflowRunActionsAPI,
	owner string,
	repo string,
	artifactID int64,
) (*zip.ReadCloser, func(), error) {
	url, _, err := actionsAPI.DownloadArtifact(ctx, owner, repo, artifactID, 10)
	if err != nil {
		return nil, nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url.String(), nil)
	if err != nil {
		return nil, nil, err
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("artifact download status=%d", resp.StatusCode)
	}

	tmpFile, err := os.CreateTemp("", "resource-usage-artifact-*.zip")
	if err != nil {
		return nil, nil, err
	}

	limitedReader := io.LimitReader(resp.Body, maxResourceUsageArtifactSize+1)
	written, err := io.Copy(tmpFile, limitedReader)
	if closeErr := tmpFile.Close(); closeErr != nil && err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(tmpFile.Name())
		return nil, nil, err
	}
	if written > maxResourceUsageArtifactSize {
		os.Remove(tmpFile.Name())
		return nil, nil, fmt.Errorf("artifact exceeds %d bytes", maxResourceUsageArtifactSize)
	}

	archive, err := zip.OpenReader(tmpFile.Name())
	if err != nil {
		os.Remove(tmpFile.Name())
		return nil, nil, err
	}

	cleanup := func() {
		archive.Close()
		os.Remove(tmpFile.Name())
	}

	return archive, cleanup, nil
}

func readJSONFromArchive(file *zip.File, target any) error {
	if file == nil {
		return fmt.Errorf("file missing from archive")
	}

	reader, err := file.Open()
	if err != nil {
		return err
	}
	defer reader.Close()

	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func readSamplesFromArchive(file *zip.File) ([]resourceUsageSample, error) {
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	samples := make([]resourceUsageSample, 0)
	scanner := bufio.NewScanner(reader)
	for lineNumber := 1; scanner.Scan(); lineNumber += 1 {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		sample := resourceUsageSample{}
		if err := json.Unmarshal([]byte(line), &sample); err != nil {
			return nil, fmt.Errorf("line %d: %w", lineNumber, err)
		}
		samples = append(samples, sample)
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return samples, nil
}

func appendResourceUsageSummaryRecord(
	scopeLogs plog.ScopeLogs,
	summary resourceUsageSummary,
	manifest resourceUsageManifest,
	checkRunID int64,
	job *github.WorkflowJob,
	jobSpanID pcommon.SpanID,
	traceID pcommon.TraceID,
	withTraceInfo bool,
) {
	record := scopeLogs.LogRecords().AppendEmpty()
	applyResourceUsageMetadata(record.Attributes(), summary, manifest, checkRunID, job, semconv.EverrResourceUsageRecordKindJobSummary)
	record.Attributes().PutInt(semconv.EverrResourceUsageSampleCount, int64(summary.SampleCount))
	record.Attributes().PutInt(semconv.EverrResourceUsageDurationMs, summary.DurationMs)
	record.Attributes().PutDouble(semconv.EverrResourceUsageCPUAvgPct, summary.CPU.AvgPct)
	record.Attributes().PutDouble(semconv.EverrResourceUsageCPUP95Pct, summary.CPU.P95Pct)
	record.Attributes().PutDouble(semconv.EverrResourceUsageCPUMaxPct, summary.CPU.MaxPct)
	record.Attributes().PutDouble(semconv.EverrResourceUsageMemoryAvgUsedBytes, summary.Memory.AvgUsedBytes)
	record.Attributes().PutDouble(semconv.EverrResourceUsageMemoryMaxUsedBytes, summary.Memory.MaxUsedBytes)
	record.Attributes().PutDouble(semconv.EverrResourceUsageDiskPeakUsedBytes, summary.Disk.PeakUsedBytes)
	record.Attributes().PutDouble(semconv.EverrResourceUsageDiskPeakUtilizationPct, summary.Disk.PeakUtilizationPct)
	record.Attributes().PutDouble(semconv.EverrResourceUsageLoad1Max, summary.Load1.Max)
	record.SetTimestamp(pcommon.NewTimestampFromTime(resourceUsageTimestamp(summary.CompletedAt, job.GetCompletedAt().Time)))
	record.SetObservedTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	record.Body().SetStr("resource usage job summary")
	if withTraceInfo {
		record.SetTraceID(traceID)
		record.SetSpanID(jobSpanID)
	}
}

func appendResourceUsageSampleRecords(
	scopeLogs plog.ScopeLogs,
	samples []resourceUsageSample,
	summary resourceUsageSummary,
	manifest resourceUsageManifest,
	checkRunID int64,
	job *github.WorkflowJob,
	jobSpanID pcommon.SpanID,
	traceID pcommon.TraceID,
	withTraceInfo bool,
) {
	for _, sample := range samples {
		record := scopeLogs.LogRecords().AppendEmpty()
		applyResourceUsageMetadata(record.Attributes(), summary, manifest, checkRunID, job, semconv.EverrResourceUsageRecordKindSample)
		record.Attributes().PutDouble(semconv.EverrResourceUsageCPUUtilizationPct, sample.CPUUtilizationPct)
		record.Attributes().PutDouble(semconv.EverrResourceUsageMemoryUsedBytes, sample.MemoryUsedBytes)
		record.Attributes().PutDouble(semconv.EverrResourceUsageMemoryAvailableBytes, sample.MemoryAvailableBytes)
		record.Attributes().PutDouble(semconv.EverrResourceUsageDiskUsedBytes, sample.DiskUsedBytes)
		record.Attributes().PutDouble(semconv.EverrResourceUsageDiskAvailableBytes, sample.DiskAvailableBytes)
		record.Attributes().PutDouble(semconv.EverrResourceUsageDiskUtilizationPct, sample.DiskUtilizationPct)
		record.Attributes().PutDouble(semconv.EverrResourceUsageLoad1, sample.Load1)
		record.SetTimestamp(pcommon.NewTimestampFromTime(resourceUsageTimestamp(sample.Timestamp, job.GetCompletedAt().Time)))
		record.SetObservedTimestamp(pcommon.NewTimestampFromTime(time.Now()))
		record.Body().SetStr("resource usage sample")
		if withTraceInfo {
			record.SetTraceID(traceID)
			record.SetSpanID(jobSpanID)
		}
	}
}

func applyResourceUsageMetadata(
	attrs pcommon.Map,
	summary resourceUsageSummary,
	manifest resourceUsageManifest,
	checkRunID int64,
	job *github.WorkflowJob,
	recordKind string,
) {
	attrs.PutStr(semconv.EverrResourceUsageRecordKind, recordKind)
	attrs.PutInt(semconv.EverrResourceUsageSchemaVersion, 1)
	sampleIntervalSeconds := summary.SampleIntervalSeconds
	if sampleIntervalSeconds == 0 {
		sampleIntervalSeconds = manifest.SampleIntervalSeconds
	}
	attrs.PutInt(semconv.EverrResourceUsageSampleIntervalSeconds, int64(sampleIntervalSeconds))
	attrs.PutInt(semconv.EverrResourceUsageCheckRunID, checkRunID)

	runnerName := summary.Runner.Name
	if runnerName == "" {
		runnerName = job.GetRunnerName()
	}
	if runnerName != "" {
		attrs.PutStr(semconv.EverrResourceUsageRunnerName, runnerName)
		attrs.PutStr(string(conventions.CICDWorkerNameKey), runnerName)
	}
	if summary.Runner.OS != "" {
		attrs.PutStr(semconv.EverrResourceUsageRunnerOS, summary.Runner.OS)
	}
	if summary.Runner.Arch != "" {
		attrs.PutStr(semconv.EverrResourceUsageRunnerArch, summary.Runner.Arch)
	}
	if runnerGroupName := job.GetRunnerGroupName(); runnerGroupName != "" {
		attrs.PutStr(semconv.CICDPipelineWorkerGroupName, runnerGroupName)
	}
	if labels := joinedRunnerLabels(job.Labels); labels != "" {
		attrs.PutStr(semconv.CICDPipelineWorkerLabels, labels)
	}
}

func joinedRunnerLabels(labels []string) string {
	if len(labels) == 0 {
		return ""
	}

	normalized := append([]string(nil), labels...)
	for index, label := range normalized {
		normalized[index] = strings.ToLower(label)
	}
	sort.Strings(normalized)
	return strings.Join(normalized, ",")
}

func resourceUsageTimestamp(value string, fallback time.Time) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err == nil {
		return parsed
	}
	return fallback
}
