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
	"go.opentelemetry.io/collector/pdata/pmetric"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/semconv"
)

const (
	resourceUsageArtifactNamePrefix = "everr-resource-usage-v2-"
	maxResourceUsageArtifactSize    = 64 * 1024 * 1024 // 64 MB
)

const (
	systemCPUUtilizationMetricName        = "system.cpu.utilization"
	systemMemoryLimitMetricName           = "system.memory.limit"
	systemMemoryUsageMetricName           = "system.memory.usage"
	systemLinuxMemoryAvailableMetricName  = "system.linux.memory.available"
	systemMemoryUtilizationMetricName     = "system.memory.utilization"
	systemFilesystemLimitMetricName       = "system.filesystem.limit"
	systemFilesystemUsageMetricName       = "system.filesystem.usage"
	systemFilesystemUtilizationMetricName = "system.filesystem.utilization"
	systemNetworkIOMetricName             = "system.network.io"
)

const (
	memoryStateUsed     = "used"
	filesystemStateUsed = "used"
	filesystemStateFree = "free"
)

type workflowRunActionsAPI interface {
	ListWorkflowRunArtifacts(ctx context.Context, owner, repo string, runID int64, opts *github.ListOptions) (*github.ArtifactList, *github.Response, error)
	DownloadArtifact(ctx context.Context, owner, repo string, artifactID int64, maxRedirects int) (*urlpkg.URL, *github.Response, error)
	ListWorkflowJobs(ctx context.Context, owner, repo string, runID int64, opts *github.ListWorkflowJobsOptions) (*github.Jobs, *github.Response, error)
}

type resourceUsageMetadata struct {
	SchemaVersion int    `json:"schemaVersion"`
	CheckRunID    int64  `json:"checkRunId"`
	Repo          string `json:"repo"`
	RunID         int64  `json:"runId"`
	RunAttempt    int    `json:"runAttempt"`
	GitHubJob     string `json:"githubJob"`
	StartedAt     string `json:"startedAt"`
	CompletedAt   string `json:"completedAt"`
	Runner        struct {
		Name string `json:"name"`
		OS   string `json:"os"`
		Arch string `json:"arch"`
	} `json:"runner"`
	Filesystem struct {
		Device     string `json:"device"`
		Mountpoint string `json:"mountpoint"`
		Type       string `json:"type"`
	} `json:"filesystem"`
}

type resourceUsageSample struct {
	Timestamp string `json:"timestamp"`
	CPU       struct {
		Logical []struct {
			LogicalNumber int     `json:"logicalNumber"`
			Utilization   float64 `json:"utilization"`
		} `json:"logical"`
	} `json:"cpu"`
	Memory struct {
		LimitBytes     int64   `json:"limitBytes"`
		UsedBytes      int64   `json:"usedBytes"`
		AvailableBytes int64   `json:"availableBytes"`
		Utilization    float64 `json:"utilization"`
	} `json:"memory"`
	Filesystem struct {
		Device      string  `json:"device"`
		Mountpoint  string  `json:"mountpoint"`
		Type        string  `json:"type"`
		LimitBytes  int64   `json:"limitBytes"`
		UsedBytes   int64   `json:"usedBytes"`
		FreeBytes   int64   `json:"freeBytes"`
		Utilization float64 `json:"utilization"`
	} `json:"filesystem"`
	Network struct {
		Interfaces []struct {
			Name          string `json:"name"`
			ReceiveBytes  int64  `json:"receiveBytes"`
			TransmitBytes int64  `json:"transmitBytes"`
		} `json:"interfaces"`
	} `json:"network"`
}

type resourceUsageMetricBuilder struct {
	cpuUtilization        pmetric.NumberDataPointSlice
	memoryLimit           pmetric.NumberDataPointSlice
	memoryUsage           pmetric.NumberDataPointSlice
	linuxMemoryAvailable  pmetric.NumberDataPointSlice
	memoryUtilization     pmetric.NumberDataPointSlice
	filesystemLimit       pmetric.NumberDataPointSlice
	filesystemUsage       pmetric.NumberDataPointSlice
	filesystemUtilization pmetric.NumberDataPointSlice
	networkIO             pmetric.NumberDataPointSlice
}

type resourceUsageNetworkBaseline struct {
	ReceiveBytes  int64
	TransmitBytes int64
}

func appendResourceUsageMetrics(
	ctx context.Context,
	event *github.WorkflowRunEvent,
	actionsAPI workflowRunActionsAPI,
	httpClient *http.Client,
	logger *zap.Logger,
	scopeMetrics pmetric.ScopeMetrics,
) bool {
	owner := event.GetRepo().GetOwner().GetLogin()
	repo := event.GetRepo().GetName()
	runID := event.GetWorkflowRun().GetID()

	artifacts := findResourceUsageArtifacts(ctx, actionsAPI, owner, repo, runID, logger)
	if len(artifacts) == 0 {
		return false
	}

	jobsByCheckRunID, err := listWorkflowJobsByCheckRunID(ctx, actionsAPI, owner, repo, runID)
	if err != nil {
		logger.Warn("Skipping resource usage metrics because workflow jobs could not be listed", zap.Error(err))
		return false
	}

	var builder *resourceUsageMetricBuilder
	ensureBuilder := func() *resourceUsageMetricBuilder {
		if builder == nil {
			newBuilder := newResourceUsageMetricBuilder(scopeMetrics)
			builder = &newBuilder
		}
		return builder
	}

	appended := false
	for _, artifact := range artifacts {
		if appendResourceUsageArtifactMetrics(
			ctx,
			owner,
			repo,
			artifact,
			actionsAPI,
			httpClient,
			logger,
			ensureBuilder,
			jobsByCheckRunID,
		) {
			appended = true
		}
	}

	return appended
}

func appendResourceUsageArtifactMetrics(
	ctx context.Context,
	owner string,
	repo string,
	artifact *github.Artifact,
	actionsAPI workflowRunActionsAPI,
	httpClient *http.Client,
	logger *zap.Logger,
	ensureBuilder func() *resourceUsageMetricBuilder,
	jobsByCheckRunID map[int64]*github.WorkflowJob,
) bool {
	archive, cleanup, err := downloadArtifactArchive(ctx, httpClient, actionsAPI, owner, repo, artifact.GetID())
	if err != nil {
		logger.Warn("Skipping resource usage artifact download", zap.Error(err), zap.Int64("artifact_id", artifact.GetID()))
		return false
	}
	defer cleanup()

	filesByName := make(map[string]*zip.File, len(archive.File))
	for _, file := range archive.File {
		filesByName[file.Name] = file
	}

	metadata := resourceUsageMetadata{}
	if err := readJSONFromArchive(filesByName["metadata.json"], &metadata); err != nil {
		logger.Warn("Skipping resource usage artifact with invalid metadata", zap.Error(err), zap.Int64("artifact_id", artifact.GetID()))
		return false
	}

	if metadata.SchemaVersion != 2 {
		logger.Warn("Skipping resource usage artifact with unsupported schema version", zap.Int("schema_version", metadata.SchemaVersion), zap.Int64("artifact_id", artifact.GetID()))
		return false
	}

	if metadata.CheckRunID <= 0 {
		logger.Warn("Skipping resource usage artifact with invalid check run id", zap.Int64("artifact_id", artifact.GetID()))
		return false
	}

	job, found := jobsByCheckRunID[metadata.CheckRunID]
	if !found {
		logger.Warn("Skipping resource usage artifact with unmatched check run id", zap.Int64("check_run_id", metadata.CheckRunID), zap.Int64("artifact_id", artifact.GetID()))
		return false
	}

	samplesFile := filesByName["samples.ndjson"]
	if samplesFile == nil {
		logger.Warn("Skipping resource usage artifact with missing samples", zap.Int64("artifact_id", artifact.GetID()), zap.Int64("check_run_id", metadata.CheckRunID))
		return false
	}

	samples, err := readSamplesFromArchive(samplesFile)
	if err != nil {
		logger.Warn("Skipping malformed resource usage samples", zap.Error(err), zap.Int64("artifact_id", artifact.GetID()), zap.Int64("check_run_id", metadata.CheckRunID))
		return false
	}

	if len(samples) == 0 {
		return false
	}

	builder := ensureBuilder()
	jobStart := resourceUsageStartTime(metadata.StartedAt, job.GetStartedAt().Time, job.GetCompletedAt().Time)
	networkBaselines := make(map[string]resourceUsageNetworkBaseline)
	appended := false

	for _, sample := range samples {
		if appendResourceUsageSampleMetrics(builder, metadata, sample, job, jobStart, networkBaselines) {
			appended = true
		}
	}

	return appended
}

func findResourceUsageArtifacts(
	ctx context.Context,
	actionsAPI workflowRunActionsAPI,
	owner string,
	repo string,
	runID int64,
	logger *zap.Logger,
) []*github.Artifact {
	opts := &github.ListOptions{PerPage: 100}
	artifactsByCheckRunID := make(map[int64]*github.Artifact)

	for {
		list, response, err := actionsAPI.ListWorkflowRunArtifacts(ctx, owner, repo, runID, opts)
		if err != nil {
			logger.Warn("Failed to list workflow run artifacts", zap.Error(err))
			return nil
		}

		for _, artifact := range list.Artifacts {
			checkRunID, ok := checkRunIDFromArtifactName(artifact.GetName())
			if !ok {
				continue
			}

			if artifact.GetExpired() {
				logger.Warn("Skipping expired resource usage artifact", zap.Int64("artifact_id", artifact.GetID()), zap.Int64("check_run_id", checkRunID))
				continue
			}

			existing := artifactsByCheckRunID[checkRunID]
			if existing == nil || artifact.GetUpdatedAt().Time.After(existing.GetUpdatedAt().Time) {
				artifactsByCheckRunID[checkRunID] = artifact
			}
		}

		if response == nil || response.NextPage == 0 {
			break
		}
		opts.Page = response.NextPage
	}

	if len(artifactsByCheckRunID) == 0 {
		logger.Debug("Resource usage artifacts not found")
		return nil
	}

	checkRunIDs := make([]int64, 0, len(artifactsByCheckRunID))
	for checkRunID := range artifactsByCheckRunID {
		checkRunIDs = append(checkRunIDs, checkRunID)
	}
	sort.Slice(checkRunIDs, func(left, right int) bool {
		return checkRunIDs[left] < checkRunIDs[right]
	})

	selected := make([]*github.Artifact, 0, len(checkRunIDs))
	for _, checkRunID := range checkRunIDs {
		selected = append(selected, artifactsByCheckRunID[checkRunID])
	}
	return selected
}

func checkRunIDFromArtifactName(name string) (int64, bool) {
	if !strings.HasPrefix(name, resourceUsageArtifactNamePrefix) {
		return 0, false
	}

	checkRunID, err := strconv.ParseInt(strings.TrimPrefix(name, resourceUsageArtifactNamePrefix), 10, 64)
	if err != nil || checkRunID <= 0 {
		return 0, false
	}

	return checkRunID, true
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
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
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

func newResourceUsageMetricBuilder(scopeMetrics pmetric.ScopeMetrics) resourceUsageMetricBuilder {
	metrics := scopeMetrics.Metrics()

	return resourceUsageMetricBuilder{
		cpuUtilization:        newDoubleGaugeMetric(metrics, systemCPUUtilizationMetricName, "CPU utilization by logical core.", "1"),
		memoryLimit:           newIntSumMetric(metrics, systemMemoryLimitMetricName, "Total virtual memory available in the system.", "By", false),
		memoryUsage:           newIntSumMetric(metrics, systemMemoryUsageMetricName, "Reports memory in use by state.", "By", false),
		linuxMemoryAvailable:  newIntSumMetric(metrics, systemLinuxMemoryAvailableMetricName, "Linux memory available without swapping.", "By", false),
		memoryUtilization:     newDoubleGaugeMetric(metrics, systemMemoryUtilizationMetricName, "Percentage of memory bytes in use.", "1"),
		filesystemLimit:       newIntSumMetric(metrics, systemFilesystemLimitMetricName, "The total storage capacity of the filesystem.", "By", false),
		filesystemUsage:       newIntSumMetric(metrics, systemFilesystemUsageMetricName, "Reports a filesystem's space usage across different states.", "By", false),
		filesystemUtilization: newDoubleGaugeMetric(metrics, systemFilesystemUtilizationMetricName, "Fraction of filesystem bytes used.", "1"),
		networkIO:             newIntSumMetric(metrics, systemNetworkIOMetricName, "The number of bytes transmitted and received.", "By", true),
	}
}

func newDoubleGaugeMetric(metricSlice pmetric.MetricSlice, name, description, unit string) pmetric.NumberDataPointSlice {
	metric := metricSlice.AppendEmpty()
	metric.SetName(name)
	metric.SetDescription(description)
	metric.SetUnit(unit)
	return metric.SetEmptyGauge().DataPoints()
}

func newIntSumMetric(metricSlice pmetric.MetricSlice, name, description, unit string, monotonic bool) pmetric.NumberDataPointSlice {
	metric := metricSlice.AppendEmpty()
	metric.SetName(name)
	metric.SetDescription(description)
	metric.SetUnit(unit)
	sum := metric.SetEmptySum()
	sum.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	sum.SetIsMonotonic(monotonic)
	return sum.DataPoints()
}

func appendResourceUsageSampleMetrics(
	builder *resourceUsageMetricBuilder,
	metadata resourceUsageMetadata,
	sample resourceUsageSample,
	job *github.WorkflowJob,
	jobStart time.Time,
	networkBaselines map[string]resourceUsageNetworkBaseline,
) bool {
	timestamp := resourceUsageTimestamp(sample.Timestamp, job.GetCompletedAt().Time)
	timestampValue := pcommon.NewTimestampFromTime(timestamp)
	startTimestamp := pcommon.NewTimestampFromTime(jobStart)

	for _, logicalCPU := range sample.CPU.Logical {
		appendDoubleDataPoint(builder.cpuUtilization, startTimestamp, timestampValue, logicalCPU.Utilization, func(attrs pcommon.Map) {
			applyResourceUsageMetricBaseAttributes(attrs, metadata, job)
			attrs.PutInt("cpu.logical_number", int64(logicalCPU.LogicalNumber))
		})
	}

	appendIntDataPoint(builder.memoryLimit, startTimestamp, timestampValue, sample.Memory.LimitBytes, func(attrs pcommon.Map) {
		applyResourceUsageMetricBaseAttributes(attrs, metadata, job)
	})
	appendIntDataPoint(builder.memoryUsage, startTimestamp, timestampValue, sample.Memory.UsedBytes, func(attrs pcommon.Map) {
		applyResourceUsageMetricBaseAttributes(attrs, metadata, job)
		attrs.PutStr("system.memory.state", memoryStateUsed)
	})
	appendIntDataPoint(builder.linuxMemoryAvailable, startTimestamp, timestampValue, sample.Memory.AvailableBytes, func(attrs pcommon.Map) {
		applyResourceUsageMetricBaseAttributes(attrs, metadata, job)
	})
	appendDoubleDataPoint(builder.memoryUtilization, startTimestamp, timestampValue, sample.Memory.Utilization, func(attrs pcommon.Map) {
		applyResourceUsageMetricBaseAttributes(attrs, metadata, job)
	})

	filesystemDevice := sample.Filesystem.Device
	if filesystemDevice == "" {
		filesystemDevice = metadata.Filesystem.Device
	}
	filesystemMountpoint := sample.Filesystem.Mountpoint
	if filesystemMountpoint == "" {
		filesystemMountpoint = metadata.Filesystem.Mountpoint
	}
	filesystemType := sample.Filesystem.Type
	if filesystemType == "" {
		filesystemType = metadata.Filesystem.Type
	}

	appendIntDataPoint(builder.filesystemLimit, startTimestamp, timestampValue, sample.Filesystem.LimitBytes, func(attrs pcommon.Map) {
		applyResourceUsageMetricBaseAttributes(attrs, metadata, job)
		applyFilesystemAttributes(attrs, filesystemDevice, filesystemMountpoint, filesystemType)
	})
	appendIntDataPoint(builder.filesystemUsage, startTimestamp, timestampValue, sample.Filesystem.UsedBytes, func(attrs pcommon.Map) {
		applyResourceUsageMetricBaseAttributes(attrs, metadata, job)
		applyFilesystemAttributes(attrs, filesystemDevice, filesystemMountpoint, filesystemType)
		attrs.PutStr("system.filesystem.state", filesystemStateUsed)
	})
	appendIntDataPoint(builder.filesystemUsage, startTimestamp, timestampValue, sample.Filesystem.FreeBytes, func(attrs pcommon.Map) {
		applyResourceUsageMetricBaseAttributes(attrs, metadata, job)
		applyFilesystemAttributes(attrs, filesystemDevice, filesystemMountpoint, filesystemType)
		attrs.PutStr("system.filesystem.state", filesystemStateFree)
	})
	appendDoubleDataPoint(builder.filesystemUtilization, startTimestamp, timestampValue, sample.Filesystem.Utilization, func(attrs pcommon.Map) {
		applyResourceUsageMetricBaseAttributes(attrs, metadata, job)
		applyFilesystemAttributes(attrs, filesystemDevice, filesystemMountpoint, filesystemType)
	})

	for _, networkInterface := range sample.Network.Interfaces {
		receiveValue, transmitValue := normalizeNetworkInterfaceCounters(networkBaselines, networkInterface.Name, networkInterface.ReceiveBytes, networkInterface.TransmitBytes)

		appendIntDataPoint(builder.networkIO, startTimestamp, timestampValue, receiveValue, func(attrs pcommon.Map) {
			applyResourceUsageMetricBaseAttributes(attrs, metadata, job)
			attrs.PutStr("network.interface.name", networkInterface.Name)
			attrs.PutStr("network.io.direction", "receive")
		})
		appendIntDataPoint(builder.networkIO, startTimestamp, timestampValue, transmitValue, func(attrs pcommon.Map) {
			applyResourceUsageMetricBaseAttributes(attrs, metadata, job)
			attrs.PutStr("network.interface.name", networkInterface.Name)
			attrs.PutStr("network.io.direction", "transmit")
		})
	}

	return true
}

func normalizeNetworkInterfaceCounters(
	baselines map[string]resourceUsageNetworkBaseline,
	interfaceName string,
	receiveBytes int64,
	transmitBytes int64,
) (int64, int64) {
	baseline, found := baselines[interfaceName]
	if !found {
		baselines[interfaceName] = resourceUsageNetworkBaseline{
			ReceiveBytes:  receiveBytes,
			TransmitBytes: transmitBytes,
		}
		return 0, 0
	}

	if receiveBytes < baseline.ReceiveBytes {
		baseline.ReceiveBytes = receiveBytes
	}
	if transmitBytes < baseline.TransmitBytes {
		baseline.TransmitBytes = transmitBytes
	}
	baselines[interfaceName] = baseline

	return receiveBytes - baseline.ReceiveBytes, transmitBytes - baseline.TransmitBytes
}

func appendDoubleDataPoint(
	dataPoints pmetric.NumberDataPointSlice,
	startTimestamp pcommon.Timestamp,
	timestamp pcommon.Timestamp,
	value float64,
	setAttributes func(pcommon.Map),
) {
	dataPoint := dataPoints.AppendEmpty()
	dataPoint.SetStartTimestamp(startTimestamp)
	dataPoint.SetTimestamp(timestamp)
	dataPoint.SetDoubleValue(value)
	setAttributes(dataPoint.Attributes())
}

func appendIntDataPoint(
	dataPoints pmetric.NumberDataPointSlice,
	startTimestamp pcommon.Timestamp,
	timestamp pcommon.Timestamp,
	value int64,
	setAttributes func(pcommon.Map),
) {
	dataPoint := dataPoints.AppendEmpty()
	dataPoint.SetStartTimestamp(startTimestamp)
	dataPoint.SetTimestamp(timestamp)
	dataPoint.SetIntValue(value)
	setAttributes(dataPoint.Attributes())
}

func applyResourceUsageMetricBaseAttributes(
	attrs pcommon.Map,
	metadata resourceUsageMetadata,
	job *github.WorkflowJob,
) {
	attrs.PutInt(semconv.EverrResourceUsageCheckRunID, metadata.CheckRunID)

	jobName := job.GetName()
	if jobName == "" {
		jobName = metadata.GitHubJob
	}
	if jobName != "" {
		attrs.PutStr(string(conventions.CICDPipelineTaskNameKey), jobName)
	}

	runnerName := metadata.Runner.Name
	if runnerName == "" {
		runnerName = job.GetRunnerName()
	}
	if runnerName != "" {
		attrs.PutStr(string(conventions.CICDWorkerNameKey), runnerName)
	}
	if metadata.Runner.OS != "" {
		attrs.PutStr(semconv.EverrResourceUsageRunnerOS, metadata.Runner.OS)
	}
	if metadata.Runner.Arch != "" {
		attrs.PutStr(semconv.EverrResourceUsageRunnerArch, metadata.Runner.Arch)
	}
	if runnerGroupName := job.GetRunnerGroupName(); runnerGroupName != "" {
		attrs.PutStr(semconv.CICDPipelineWorkerGroupName, runnerGroupName)
	}
	if labels := joinedRunnerLabels(job.Labels); labels != "" {
		attrs.PutStr(semconv.CICDPipelineWorkerLabels, labels)
	}
}

func applyFilesystemAttributes(attrs pcommon.Map, device string, mountpoint string, filesystemType string) {
	if device != "" {
		attrs.PutStr("system.device", device)
	}
	if mountpoint != "" {
		attrs.PutStr("system.filesystem.mountpoint", mountpoint)
	}
	if filesystemType != "" {
		attrs.PutStr("system.filesystem.type", filesystemType)
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

func resourceUsageStartTime(value string, fallback time.Time, secondaryFallback time.Time) time.Time {
	parsed := resourceUsageTimestamp(value, fallback)
	if !parsed.IsZero() {
		return parsed
	}
	return secondaryFallback
}

func resourceUsageTimestamp(value string, fallback time.Time) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err == nil {
		return parsed
	}
	return fallback
}
