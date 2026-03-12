package githubactionsreceiver

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	urlpkg "net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/everr-labs/everr/collector/receiver/githubactionsreceiver/internal/metadata"
	"github.com/everr-labs/everr/collector/semconv"
	"github.com/google/go-github/v67/github"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
	"go.uber.org/zap/zaptest"
)

type fakeWorkflowRunActionsAPI struct {
	artifacts             []*github.Artifact
	jobs                  []*github.WorkflowJob
	downloadArtifactCalls []int64
	downloadURLs          map[int64]string
	listArtifactsErr      error
	downloadArtifactErr   error
	listJobsErr           error
}

func (f *fakeWorkflowRunActionsAPI) ListWorkflowRunArtifacts(_ context.Context, _, _ string, _ int64, _ *github.ListOptions) (*github.ArtifactList, *github.Response, error) {
	if f.listArtifactsErr != nil {
		return nil, nil, f.listArtifactsErr
	}
	return &github.ArtifactList{Artifacts: f.artifacts}, nil, nil
}

func (f *fakeWorkflowRunActionsAPI) DownloadArtifact(_ context.Context, _, _ string, artifactID int64, _ int) (*urlpkg.URL, *github.Response, error) {
	if f.downloadArtifactErr != nil {
		return nil, nil, f.downloadArtifactErr
	}

	f.downloadArtifactCalls = append(f.downloadArtifactCalls, artifactID)
	downloadURL := f.downloadURLs[artifactID]
	parsed, err := urlpkg.Parse(downloadURL)
	if err != nil {
		return nil, nil, err
	}

	return parsed, nil, nil
}

func (f *fakeWorkflowRunActionsAPI) ListWorkflowJobs(_ context.Context, _, _ string, _ int64, _ *github.ListWorkflowJobsOptions) (*github.Jobs, *github.Response, error) {
	if f.listJobsErr != nil {
		return nil, nil, f.listJobsErr
	}
	return &github.Jobs{Jobs: f.jobs}, nil, nil
}

func TestEventToMetricsAppendsResourceUsageMetrics(t *testing.T) {
	t.Parallel()

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/everr-labs/everr/actions/runs/123/artifacts":
			writeJSONResponse(t, w, github.ArtifactList{
				Artifacts: []*github.Artifact{
					{
						ID:        github.Int64(2),
						Name:      github.String("everr-resource-usage-v2-101"),
						Expired:   github.Bool(false),
						UpdatedAt: &github.Timestamp{Time: mustParseRFC3339("2026-03-10T10:00:30Z")},
					},
				},
			})
		case "/repos/everr-labs/everr/actions/runs/123/jobs":
			writeJSONResponse(t, w, github.Jobs{
				Jobs: []*github.WorkflowJob{
					testWorkflowJob(101, "Lint"),
				},
			})
		case "/repos/everr-labs/everr/actions/artifacts/2/zip":
			w.Header().Set("Location", server.URL+"/downloads/2.zip")
			w.WriteHeader(http.StatusFound)
		case "/downloads/2.zip":
			writeZipArchive(t, w, map[string]string{
				"metadata.json": validMetadataJSON(101, "lint", "2026-03-10T10:00:00.000Z", "2026-03-10T10:00:10.000Z"),
				"samples.ndjson": strings.Join([]string{
					validSampleJSON(
						"2026-03-10T10:00:05.000Z",
						`[{"logicalNumber":0,"utilization":0.10},{"logicalNumber":1,"utilization":0.20}]`,
						250,
						750,
						0.25,
						400,
						1600,
						0.20,
						`[{"name":"eth0","receiveBytes":100,"transmitBytes":200},{"name":"eth1","receiveBytes":300,"transmitBytes":400}]`,
					),
					validSampleJSON(
						"2026-03-10T10:00:10.000Z",
						`[{"logicalNumber":0,"utilization":0.30},{"logicalNumber":1,"utilization":0.40}]`,
						300,
						700,
						0.30,
						500,
						1500,
						0.25,
						`[{"name":"eth0","receiveBytes":160,"transmitBytes":230},{"name":"eth1","receiveBytes":390,"transmitBytes":500}]`,
					),
				}, "\n"),
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := github.NewClient(server.Client())
	baseURL, err := urlpkg.Parse(server.URL + "/")
	require.NoError(t, err)
	client.BaseURL = baseURL

	metrics, err := eventToMetrics(
		context.Background(),
		testCompletedWorkflowRunEvent(),
		&Config{},
		client,
		zaptest.NewLogger(t),
	)
	require.NoError(t, err)
	require.NotNil(t, metrics)
	require.Equal(t, 1, metrics.ResourceMetrics().Len())

	resourceMetrics := metrics.ResourceMetrics().At(0)
	scopeMetrics := resourceMetrics.ScopeMetrics().At(0)
	assertResourceUsageMetrics(t, scopeMetrics.Metrics())

	resourceAttrs := resourceMetrics.Resource().Attributes()
	repository, ok := resourceAttrs.Get(string(conventions.VCSRepositoryNameKey))
	require.True(t, ok)
	require.Equal(t, "everr-labs/everr", repository.Str())

	workflowName, ok := resourceAttrs.Get(string(conventions.CICDPipelineNameKey))
	require.True(t, ok)
	require.Equal(t, "Build & Test Collector", workflowName.Str())

	runID, ok := resourceAttrs.Get(string(conventions.CICDPipelineRunIDKey))
	require.True(t, ok)
	require.EqualValues(t, 123, runID.Int())
	require.Equal(t, metadata.ScopeName, scopeMetrics.Scope().Name())
}

func TestAppendResourceUsageMetricsSelectsLatestArtifactPerCheckRun(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeZipArchive(t, w, map[string]string{
			"metadata.json": validMetadataJSON(101, "lint", "2026-03-10T10:00:00.000Z", "2026-03-10T10:00:10.000Z"),
			"samples.ndjson": validSampleJSON(
				"2026-03-10T10:00:05.000Z",
				`[{"logicalNumber":0,"utilization":0.10}]`,
				250,
				750,
				0.25,
				400,
				1600,
				0.20,
				`[{"name":"eth0","receiveBytes":100,"transmitBytes":200}]`,
			),
		})
	}))
	defer server.Close()

	scopeMetrics := pmetric.NewMetrics().ResourceMetrics().AppendEmpty().ScopeMetrics().AppendEmpty()
	api := &fakeWorkflowRunActionsAPI{
		artifacts: []*github.Artifact{
			{
				ID:        github.Int64(1),
				Name:      github.String("everr-resource-usage-v2-101"),
				UpdatedAt: &github.Timestamp{Time: mustParseRFC3339("2026-03-10T10:00:10Z")},
			},
			{
				ID:        github.Int64(2),
				Name:      github.String("everr-resource-usage-v2-101"),
				UpdatedAt: &github.Timestamp{Time: mustParseRFC3339("2026-03-10T10:00:20Z")},
			},
			{
				ID:      github.Int64(3),
				Name:    github.String("everr-resource-usage-v2-202"),
				Expired: github.Bool(true),
			},
		},
		jobs: []*github.WorkflowJob{
			testWorkflowJob(101, "Lint"),
		},
		downloadURLs: map[int64]string{
			1: server.URL,
			2: server.URL,
			3: server.URL,
		},
	}

	appended := appendResourceUsageMetrics(
		context.Background(),
		testCompletedWorkflowRunEvent(),
		api,
		server.Client(),
		zaptest.NewLogger(t),
		scopeMetrics,
	)
	require.True(t, appended)
	require.Equal(t, []int64{2}, api.downloadArtifactCalls)

	metrics := scopeMetrics.Metrics()
	require.Equal(t, 9, metrics.Len())
}

func TestAppendResourceUsageMetricsSkipsInvalidArtifacts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		files        map[string]string
		jobs         []*github.WorkflowJob
		wantAppended bool
	}{
		{
			name: "malformed metadata",
			files: map[string]string{
				"metadata.json":  "{not-json}",
				"samples.ndjson": validSampleJSON("2026-03-10T10:00:05.000Z", `[]`, 250, 750, 0.25, 400, 1600, 0.20, `[]`),
			},
			jobs: []*github.WorkflowJob{testWorkflowJob(101, "Lint")},
		},
		{
			name: "missing samples",
			files: map[string]string{
				"metadata.json": validMetadataJSON(101, "lint", "2026-03-10T10:00:00.000Z", "2026-03-10T10:00:10.000Z"),
			},
			jobs: []*github.WorkflowJob{testWorkflowJob(101, "Lint")},
		},
		{
			name: "malformed samples",
			files: map[string]string{
				"metadata.json":  validMetadataJSON(101, "lint", "2026-03-10T10:00:00.000Z", "2026-03-10T10:00:10.000Z"),
				"samples.ndjson": "not-json",
			},
			jobs: []*github.WorkflowJob{testWorkflowJob(101, "Lint")},
		},
		{
			name: "unmatched check run",
			files: map[string]string{
				"metadata.json":  validMetadataJSON(101, "lint", "2026-03-10T10:00:00.000Z", "2026-03-10T10:00:10.000Z"),
				"samples.ndjson": validSampleJSON("2026-03-10T10:00:05.000Z", `[]`, 250, 750, 0.25, 400, 1600, 0.20, `[]`),
			},
			jobs: nil,
		},
	}

	for _, testCase := range tests {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				writeZipArchive(t, w, testCase.files)
			}))
			defer server.Close()

			scopeMetrics := pmetric.NewMetrics().ResourceMetrics().AppendEmpty().ScopeMetrics().AppendEmpty()
			api := &fakeWorkflowRunActionsAPI{
				artifacts: []*github.Artifact{
					{
						ID:   github.Int64(2),
						Name: github.String("everr-resource-usage-v2-101"),
					},
				},
				jobs: testCase.jobs,
				downloadURLs: map[int64]string{
					2: server.URL,
				},
			}

			appended := appendResourceUsageMetrics(
				context.Background(),
				testCompletedWorkflowRunEvent(),
				api,
				server.Client(),
				zaptest.NewLogger(t),
				scopeMetrics,
			)
			require.Equal(t, testCase.wantAppended, appended)
			require.Equal(t, 0, scopeMetrics.Metrics().Len())
		})
	}
}

func TestEventToMetricsSkipsNonCompletedRun(t *testing.T) {
	t.Parallel()

	client := github.NewClient(http.DefaultClient)
	metrics, err := eventToMetrics(
		context.Background(),
		&github.WorkflowRunEvent{
			WorkflowRun: &github.WorkflowRun{Status: github.String("in_progress")},
		},
		&Config{},
		client,
		zaptest.NewLogger(t),
	)
	require.NoError(t, err)
	require.Nil(t, metrics)
}

func assertResourceUsageMetrics(t *testing.T, metrics pmetric.MetricSlice) {
	t.Helper()

	require.Equal(t, 9, metrics.Len())

	startTime := mustParseRFC3339("2026-03-10T10:00:00.000Z")
	firstSampleTime := mustParseRFC3339("2026-03-10T10:00:05.000Z")
	secondSampleTime := mustParseRFC3339("2026-03-10T10:00:10.000Z")

	cpuMetric := metricByName(t, metrics, systemCPUUtilizationMetricName)
	require.Equal(t, "1", cpuMetric.Unit())
	require.Equal(t, pmetric.MetricTypeGauge, cpuMetric.Type())
	cpuPoints := cpuMetric.Gauge().DataPoints()
	require.Equal(t, 4, cpuPoints.Len())
	require.Equal(t, startTime, cpuPoints.At(0).StartTimestamp().AsTime())
	require.Equal(t, firstSampleTime, cpuPoints.At(0).Timestamp().AsTime())
	require.Equal(t, 0.10, cpuPoints.At(0).DoubleValue())
	require.EqualValues(t, 0, mustIntAttr(t, cpuPoints.At(0).Attributes(), "cpu.logical_number"))
	require.EqualValues(t, 101, mustIntAttr(t, cpuPoints.At(0).Attributes(), semconv.EverrResourceUsageCheckRunID))
	require.Equal(t, "Lint", mustStringAttr(t, cpuPoints.At(0).Attributes(), string(conventions.CICDPipelineTaskNameKey)))
	require.Equal(t, "GitHub Actions 1", mustStringAttr(t, cpuPoints.At(0).Attributes(), string(conventions.CICDWorkerNameKey)))
	require.Equal(t, "Linux", mustStringAttr(t, cpuPoints.At(0).Attributes(), semconv.EverrResourceUsageRunnerOS))
	require.Equal(t, "X64", mustStringAttr(t, cpuPoints.At(0).Attributes(), semconv.EverrResourceUsageRunnerArch))
	require.Equal(t, "GitHub Actions", mustStringAttr(t, cpuPoints.At(0).Attributes(), semconv.CICDPipelineWorkerGroupName))
	require.Equal(t, "ubuntu-latest", mustStringAttr(t, cpuPoints.At(0).Attributes(), semconv.CICDPipelineWorkerLabels))
	require.EqualValues(t, 1, mustIntAttr(t, cpuPoints.At(1).Attributes(), "cpu.logical_number"))
	require.Equal(t, 0.40, cpuPoints.At(3).DoubleValue())
	require.Equal(t, secondSampleTime, cpuPoints.At(3).Timestamp().AsTime())

	memoryLimit := metricByName(t, metrics, systemMemoryLimitMetricName)
	require.Equal(t, pmetric.MetricTypeSum, memoryLimit.Type())
	require.Equal(t, pmetric.AggregationTemporalityCumulative, memoryLimit.Sum().AggregationTemporality())
	require.False(t, memoryLimit.Sum().IsMonotonic())
	require.EqualValues(t, 1000, memoryLimit.Sum().DataPoints().At(0).IntValue())

	memoryUsage := metricByName(t, metrics, systemMemoryUsageMetricName)
	require.Equal(t, "used", mustStringAttr(t, memoryUsage.Sum().DataPoints().At(0).Attributes(), "system.memory.state"))
	require.EqualValues(t, 250, memoryUsage.Sum().DataPoints().At(0).IntValue())
	require.EqualValues(t, 300, memoryUsage.Sum().DataPoints().At(1).IntValue())

	linuxAvailable := metricByName(t, metrics, systemLinuxMemoryAvailableMetricName)
	require.EqualValues(t, 750, linuxAvailable.Sum().DataPoints().At(0).IntValue())
	require.EqualValues(t, 700, linuxAvailable.Sum().DataPoints().At(1).IntValue())

	memoryUtilization := metricByName(t, metrics, systemMemoryUtilizationMetricName)
	require.Equal(t, 0.25, memoryUtilization.Gauge().DataPoints().At(0).DoubleValue())
	require.Equal(t, 0.30, memoryUtilization.Gauge().DataPoints().At(1).DoubleValue())

	filesystemLimit := metricByName(t, metrics, systemFilesystemLimitMetricName)
	require.EqualValues(t, 2000, filesystemLimit.Sum().DataPoints().At(0).IntValue())
	require.Equal(t, "/dev/root", mustStringAttr(t, filesystemLimit.Sum().DataPoints().At(0).Attributes(), "system.device"))
	require.Equal(t, "/", mustStringAttr(t, filesystemLimit.Sum().DataPoints().At(0).Attributes(), "system.filesystem.mountpoint"))
	require.Equal(t, "ext4", mustStringAttr(t, filesystemLimit.Sum().DataPoints().At(0).Attributes(), "system.filesystem.type"))

	filesystemUsage := metricByName(t, metrics, systemFilesystemUsageMetricName)
	require.Equal(t, 4, filesystemUsage.Sum().DataPoints().Len())
	require.EqualValues(t, 400, filesystemUsage.Sum().DataPoints().At(0).IntValue())
	require.Equal(t, "used", mustStringAttr(t, filesystemUsage.Sum().DataPoints().At(0).Attributes(), "system.filesystem.state"))
	require.EqualValues(t, 1600, filesystemUsage.Sum().DataPoints().At(1).IntValue())
	require.Equal(t, "free", mustStringAttr(t, filesystemUsage.Sum().DataPoints().At(1).Attributes(), "system.filesystem.state"))
	require.EqualValues(t, 500, filesystemUsage.Sum().DataPoints().At(2).IntValue())
	require.EqualValues(t, 1500, filesystemUsage.Sum().DataPoints().At(3).IntValue())

	filesystemUtilization := metricByName(t, metrics, systemFilesystemUtilizationMetricName)
	require.Equal(t, 0.20, filesystemUtilization.Gauge().DataPoints().At(0).DoubleValue())
	require.Equal(t, 0.25, filesystemUtilization.Gauge().DataPoints().At(1).DoubleValue())

	networkIO := metricByName(t, metrics, systemNetworkIOMetricName)
	require.Equal(t, pmetric.MetricTypeSum, networkIO.Type())
	require.Equal(t, pmetric.AggregationTemporalityCumulative, networkIO.Sum().AggregationTemporality())
	require.True(t, networkIO.Sum().IsMonotonic())
	networkPoints := networkIO.Sum().DataPoints()
	require.Equal(t, 8, networkPoints.Len())
	require.EqualValues(t, 0, networkPoints.At(0).IntValue())
	require.Equal(t, "eth0", mustStringAttr(t, networkPoints.At(0).Attributes(), "network.interface.name"))
	require.Equal(t, "receive", mustStringAttr(t, networkPoints.At(0).Attributes(), "network.io.direction"))
	require.EqualValues(t, 0, networkPoints.At(1).IntValue())
	require.Equal(t, "transmit", mustStringAttr(t, networkPoints.At(1).Attributes(), "network.io.direction"))
	require.EqualValues(t, 0, networkPoints.At(2).IntValue())
	require.Equal(t, "eth1", mustStringAttr(t, networkPoints.At(2).Attributes(), "network.interface.name"))
	require.EqualValues(t, 0, networkPoints.At(3).IntValue())
	require.EqualValues(t, 60, networkPoints.At(4).IntValue())
	require.EqualValues(t, 30, networkPoints.At(5).IntValue())
	require.EqualValues(t, 90, networkPoints.At(6).IntValue())
	require.EqualValues(t, 100, networkPoints.At(7).IntValue())

}

func metricByName(t *testing.T, metrics pmetric.MetricSlice, name string) pmetric.Metric {
	t.Helper()

	for index := 0; index < metrics.Len(); index += 1 {
		metric := metrics.At(index)
		if metric.Name() == name {
			return metric
		}
	}

	t.Fatalf("metric %q not found", name)
	return pmetric.NewMetric()
}

func mustStringAttr(t *testing.T, attrs pcommon.Map, key string) string {
	t.Helper()

	value, ok := attrs.Get(key)
	require.True(t, ok, "missing attribute %s", key)
	return value.Str()
}

func mustIntAttr(t *testing.T, attrs pcommon.Map, key string) int64 {
	t.Helper()

	value, ok := attrs.Get(key)
	require.True(t, ok, "missing attribute %s", key)
	return value.Int()
}

func testCompletedWorkflowRunEvent() *github.WorkflowRunEvent {
	return &github.WorkflowRunEvent{
		Repo: &github.Repository{
			Name:     github.String("everr"),
			FullName: github.String("everr-labs/everr"),
			Owner: &github.User{
				Login: github.String("everr-labs"),
			},
		},
		Sender: &github.User{
			Login: github.String("sender"),
		},
		Workflow: &github.Workflow{
			Path: github.String(".github/workflows/build-and-test-collector.yml"),
		},
		WorkflowRun: &github.WorkflowRun{
			ID:           github.Int64(123),
			Name:         github.String("Build & Test Collector"),
			Status:       github.String("completed"),
			Conclusion:   github.String("success"),
			RunAttempt:   github.Int(1),
			WorkflowID:   github.Int64(456),
			DisplayTitle: github.String("collector"),
			Event:        github.String("push"),
			HTMLURL:      github.String("https://github.com/everr-labs/everr/actions/runs/123"),
			CreatedAt:    &github.Timestamp{Time: mustParseRFC3339("2026-03-10T09:59:00Z")},
			UpdatedAt:    &github.Timestamp{Time: mustParseRFC3339("2026-03-10T10:00:30Z")},
			RunStartedAt: &github.Timestamp{Time: mustParseRFC3339("2026-03-10T10:00:00Z")},
			HeadBranch:   github.String("main"),
			HeadSHA:      github.String("abc123"),
			HeadCommit: &github.HeadCommit{
				Author: &github.CommitAuthor{
					Name:  github.String("Alice"),
					Email: github.String("alice@example.com"),
				},
				Committer: &github.CommitAuthor{
					Name:  github.String("Alice"),
					Email: github.String("alice@example.com"),
				},
				Message:   github.String("ship metrics"),
				Timestamp: &github.Timestamp{Time: mustParseRFC3339("2026-03-10T09:58:00Z")},
			},
			Actor: &github.User{
				Login: github.String("actor"),
			},
			TriggeringActor: &github.User{
				Login: github.String("actor"),
			},
		},
	}
}

func testWorkflowJob(checkRunID int64, name string) *github.WorkflowJob {
	return &github.WorkflowJob{
		Name:            github.String(name),
		RunnerName:      github.String("GitHub Actions 1"),
		RunnerGroupName: github.String("GitHub Actions"),
		Labels:          []string{"ubuntu-latest"},
		CheckRunURL:     github.String("https://api.github.com/repos/everr-labs/everr/check-runs/" + strconv.FormatInt(checkRunID, 10)),
		StartedAt:       &github.Timestamp{Time: mustParseRFC3339("2026-03-10T10:00:00Z")},
		CompletedAt:     &github.Timestamp{Time: mustParseRFC3339("2026-03-10T10:00:30Z")},
	}
}

func validMetadataJSON(checkRunID int64, githubJob string, startedAt string, completedAt string) string {
	return `{
  "schemaVersion": 2,
  "checkRunId": ` + strconv.FormatInt(checkRunID, 10) + `,
  "repo": "everr-labs/everr",
  "runId": 123,
  "runAttempt": 1,
  "githubJob": "` + githubJob + `",
  "startedAt": "` + startedAt + `",
  "completedAt": "` + completedAt + `",
  "runner": {
    "name": "GitHub Actions 1",
    "os": "Linux",
    "arch": "X64"
  },
  "filesystem": {
    "device": "/dev/root",
    "mountpoint": "/",
    "type": "ext4"
  }
}`
}

func validSampleJSON(
	timestamp string,
	cpuLogicalJSON string,
	memoryUsedBytes int64,
	memoryAvailableBytes int64,
	memoryUtilization float64,
	filesystemUsedBytes int64,
	filesystemFreeBytes int64,
	filesystemUtilization float64,
	networkInterfacesJSON string,
) string {
	return `{"timestamp":"` + timestamp + `","cpu":{"logical":` + cpuLogicalJSON + `},"memory":{"limitBytes":1000,"usedBytes":` + strconv.FormatInt(memoryUsedBytes, 10) + `,"availableBytes":` + strconv.FormatInt(memoryAvailableBytes, 10) + `,"utilization":` + strconv.FormatFloat(memoryUtilization, 'f', 2, 64) + `},"filesystem":{"device":"/dev/root","mountpoint":"/","type":"ext4","limitBytes":2000,"usedBytes":` + strconv.FormatInt(filesystemUsedBytes, 10) + `,"freeBytes":` + strconv.FormatInt(filesystemFreeBytes, 10) + `,"utilization":` + strconv.FormatFloat(filesystemUtilization, 'f', 2, 64) + `},"network":{"interfaces":` + networkInterfacesJSON + `}}`
}

func mustParseRFC3339(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		panic(err)
	}
	return parsed
}

func writeZipArchive(t *testing.T, w http.ResponseWriter, files map[string]string) {
	t.Helper()

	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, content := range files {
		fileWriter, err := writer.Create(name)
		require.NoError(t, err)
		_, err = fileWriter.Write([]byte(content))
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())

	_, err := w.Write(buffer.Bytes())
	require.NoError(t, err)
}

func writeJSONResponse(t *testing.T, w http.ResponseWriter, payload any) {
	t.Helper()

	w.Header().Set("Content-Type", "application/json")
	require.NoError(t, json.NewEncoder(w).Encode(payload))
}
