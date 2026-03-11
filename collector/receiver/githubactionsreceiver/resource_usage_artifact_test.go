package githubactionsreceiver

import (
	"archive/zip"
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	urlpkg "net/url"
	"strconv"
	"testing"
	"time"

	"github.com/google/go-github/v67/github"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.uber.org/zap/zaptest"

	"github.com/everr-labs/everr/collector/semconv"
)

type fakeWorkflowRunActionsAPI struct {
	artifacts           []*github.Artifact
	jobs                []*github.WorkflowJob
	downloadURL         string
	listArtifactsErr    error
	downloadArtifactErr error
	listJobsErr         error
}

func (f *fakeWorkflowRunActionsAPI) ListWorkflowRunArtifacts(_ context.Context, _, _ string, _ int64, _ *github.ListOptions) (*github.ArtifactList, *github.Response, error) {
	if f.listArtifactsErr != nil {
		return nil, nil, f.listArtifactsErr
	}
	return &github.ArtifactList{Artifacts: f.artifacts}, nil, nil
}

func (f *fakeWorkflowRunActionsAPI) DownloadArtifact(_ context.Context, _, _ string, _ int64, _ int) (*urlpkg.URL, *github.Response, error) {
	if f.downloadArtifactErr != nil {
		return nil, nil, f.downloadArtifactErr
	}
	parsed, err := urlpkg.Parse(f.downloadURL)
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

func TestAppendResourceUsageLogsSkipsWhenArtifactMissingOrExpired(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		artifacts []*github.Artifact
	}{
		{
			name:      "missing artifact",
			artifacts: nil,
		},
		{
			name: "expired artifact",
			artifacts: []*github.Artifact{
				{
					ID:      github.Int64(1),
					Name:    github.String(resourceUsageArtifactName),
					Expired: github.Bool(true),
				},
			},
		},
	}

	for _, testCase := range tests {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			logs := plog.NewLogs()
			resourceLogs := logs.ResourceLogs().AppendEmpty()

			appendResourceUsageLogs(
				context.Background(),
				testWorkflowRunEvent(),
				&fakeWorkflowRunActionsAPI{artifacts: testCase.artifacts},
				http.DefaultClient,
				zaptest.NewLogger(t),
				resourceLogs,
				mustTraceID(t, 123, 1),
				true,
			)

			require.Equal(t, 0, resourceLogs.ScopeLogs().Len())
		})
	}
}

func TestAppendResourceUsageLogsSkipsMalformedManifest(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeZipArchive(t, w, map[string]string{
			"manifest.json": "{not valid json}",
		})
	}))
	defer server.Close()

	logs := plog.NewLogs()
	resourceLogs := logs.ResourceLogs().AppendEmpty()

	appendResourceUsageLogs(
		context.Background(),
		testWorkflowRunEvent(),
		&fakeWorkflowRunActionsAPI{
			artifacts: []*github.Artifact{
				{
					ID:   github.Int64(1),
					Name: github.String(resourceUsageArtifactName),
				},
			},
			downloadURL: server.URL,
		},
		server.Client(),
		zaptest.NewLogger(t),
		resourceLogs,
		mustTraceID(t, 123, 1),
		true,
	)

	require.Equal(t, 0, resourceLogs.ScopeLogs().Len())
}

func TestAppendResourceUsageLogsHandlesMalformedNDJSONAndUnmatchedJobs(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeZipArchive(t, w, map[string]string{
			"manifest.json": `{
  "schemaVersion": 1,
  "repo": "everr-labs/everr",
  "runId": 123,
  "runAttempt": 1,
  "sampleIntervalSeconds": 5,
  "generatedAt": "2026-03-10T10:00:00.000Z",
  "jobs": [
    {
      "checkRunId": 101,
      "sampleCount": 1,
      "summaryPath": "jobs/101/summary.json",
      "samplesPath": "jobs/101/samples.ndjson"
    },
    {
      "checkRunId": 999,
      "sampleCount": 1,
      "summaryPath": "jobs/999/summary.json",
      "samplesPath": "jobs/999/samples.ndjson"
    }
  ]
}`,
			"jobs/101/summary.json": `{
  "schemaVersion": 1,
  "checkRunId": 101,
  "repo": "everr-labs/everr",
  "runId": 123,
  "runAttempt": 1,
  "githubJob": "lint",
  "sampleIntervalSeconds": 5,
  "startedAt": "2026-03-10T10:00:00.000Z",
  "completedAt": "2026-03-10T10:00:10.000Z",
  "runner": { "name": "GitHub Actions 1", "os": "Linux", "arch": "X64" },
  "sampleCount": 1,
  "durationMs": 10000,
  "cpu": { "avgPct": 10, "p95Pct": 10, "maxPct": 10 },
  "memory": { "avgUsedBytes": 100, "maxUsedBytes": 100 },
  "disk": { "peakUsedBytes": 50, "peakUtilizationPct": 5 },
  "load1": { "max": 0.2 }
}`,
			"jobs/101/samples.ndjson": `not-json`,
			"jobs/999/summary.json": `{
  "schemaVersion": 1,
  "checkRunId": 999,
  "repo": "everr-labs/everr",
  "runId": 123,
  "runAttempt": 1,
  "githubJob": "ghost",
  "sampleIntervalSeconds": 5,
  "startedAt": "2026-03-10T10:00:00.000Z",
  "completedAt": "2026-03-10T10:00:05.000Z",
  "runner": { "name": "GitHub Actions 1", "os": "Linux", "arch": "X64" },
  "sampleCount": 1,
  "durationMs": 5000,
  "cpu": { "avgPct": 10, "p95Pct": 10, "maxPct": 10 },
  "memory": { "avgUsedBytes": 100, "maxUsedBytes": 100 },
  "disk": { "peakUsedBytes": 50, "peakUtilizationPct": 5 },
  "load1": { "max": 0.2 }
}`,
			"jobs/999/samples.ndjson": `{"timestamp":"2026-03-10T10:00:05.000Z","cpuUtilizationPct":10,"memoryUsedBytes":100,"memoryAvailableBytes":900,"diskUsedBytes":50,"diskAvailableBytes":950,"diskUtilizationPct":5,"load1":0.2}`,
		})
	}))
	defer server.Close()

	logs := plog.NewLogs()
	resourceLogs := logs.ResourceLogs().AppendEmpty()

	appendResourceUsageLogs(
		context.Background(),
		testWorkflowRunEvent(),
		&fakeWorkflowRunActionsAPI{
			artifacts: []*github.Artifact{
				{
					ID:   github.Int64(1),
					Name: github.String(resourceUsageArtifactName),
				},
			},
			downloadURL: server.URL,
			jobs: []*github.WorkflowJob{
				testWorkflowJob(101, "lint"),
			},
		},
		server.Client(),
		zaptest.NewLogger(t),
		resourceLogs,
		mustTraceID(t, 123, 1),
		true,
	)

	require.Equal(t, 1, resourceLogs.ScopeLogs().Len())
	scopeLogs := resourceLogs.ScopeLogs().At(0)
	require.Equal(t, 1, scopeLogs.LogRecords().Len())

	record := scopeLogs.LogRecords().At(0)
	recordKind, ok := record.Attributes().Get(semconv.EverrResourceUsageRecordKind)
	require.True(t, ok)
	require.Equal(t, semconv.EverrResourceUsageRecordKindJobSummary, recordKind.Str())
}

func TestAppendResourceUsageLogsCorrelatesValidArtifactRecords(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeZipArchive(t, w, map[string]string{
			"manifest.json": `{
  "schemaVersion": 1,
  "repo": "everr-labs/everr",
  "runId": 123,
  "runAttempt": 1,
  "sampleIntervalSeconds": 5,
  "generatedAt": "2026-03-10T10:00:00.000Z",
  "jobs": [
    {
      "checkRunId": 101,
      "sampleCount": 1,
      "summaryPath": "jobs/101/summary.json",
      "samplesPath": "jobs/101/samples.ndjson"
    },
    {
      "checkRunId": 202,
      "sampleCount": 1,
      "summaryPath": "jobs/202/summary.json",
      "samplesPath": "jobs/202/samples.ndjson"
    }
  ]
}`,
			"jobs/101/summary.json":   validSummaryJSON(101, "lint", "2026-03-10T10:00:10.000Z"),
			"jobs/101/samples.ndjson": `{"timestamp":"2026-03-10T10:00:05.000Z","cpuUtilizationPct":10,"memoryUsedBytes":100,"memoryAvailableBytes":900,"diskUsedBytes":50,"diskAvailableBytes":950,"diskUtilizationPct":5,"load1":0.2}`,
			"jobs/202/summary.json":   validSummaryJSON(202, "test", "2026-03-10T10:00:20.000Z"),
			"jobs/202/samples.ndjson": `{"timestamp":"2026-03-10T10:00:15.000Z","cpuUtilizationPct":40,"memoryUsedBytes":200,"memoryAvailableBytes":800,"diskUsedBytes":150,"diskAvailableBytes":850,"diskUtilizationPct":15,"load1":0.7}`,
		})
	}))
	defer server.Close()

	logs := plog.NewLogs()
	resourceLogs := logs.ResourceLogs().AppendEmpty()
	traceID := mustTraceID(t, 123, 1)

	appendResourceUsageLogs(
		context.Background(),
		testWorkflowRunEvent(),
		&fakeWorkflowRunActionsAPI{
			artifacts: []*github.Artifact{
				{
					ID:   github.Int64(1),
					Name: github.String(resourceUsageArtifactName),
				},
			},
			downloadURL: server.URL,
			jobs: []*github.WorkflowJob{
				testWorkflowJob(101, "lint"),
				testWorkflowJob(202, "test"),
			},
		},
		server.Client(),
		zaptest.NewLogger(t),
		resourceLogs,
		traceID,
		true,
	)

	require.Equal(t, 2, resourceLogs.ScopeLogs().Len())

	lintLogs := resourceLogs.ScopeLogs().At(0)
	testLogs := resourceLogs.ScopeLogs().At(1)
	require.Equal(t, 2, lintLogs.LogRecords().Len())
	require.Equal(t, 2, testLogs.LogRecords().Len())

	expectedLintSpanID, err := generateJobSpanID(123, 1, "lint")
	require.NoError(t, err)
	expectedTestSpanID, err := generateJobSpanID(123, 1, "test")
	require.NoError(t, err)

	firstLintRecord := lintLogs.LogRecords().At(0)
	secondTestRecord := testLogs.LogRecords().At(1)

	require.Equal(t, traceID, firstLintRecord.TraceID())
	require.Equal(t, expectedLintSpanID, firstLintRecord.SpanID())
	require.Equal(t, traceID, secondTestRecord.TraceID())
	require.Equal(t, expectedTestSpanID, secondTestRecord.SpanID())

	checkRunID, ok := firstLintRecord.Attributes().Get(semconv.EverrResourceUsageCheckRunID)
	require.True(t, ok)
	require.EqualValues(t, 101, checkRunID.Int())

	cpuValue, ok := secondTestRecord.Attributes().Get(semconv.EverrResourceUsageCPUUtilizationPct)
	require.True(t, ok)
	require.Equal(t, 40.0, cpuValue.Double())
}

func testWorkflowRunEvent() *github.WorkflowRunEvent {
	return &github.WorkflowRunEvent{
		Repo: &github.Repository{
			Name: github.String("everr"),
			Owner: &github.User{
				Login: github.String("everr-labs"),
			},
		},
		WorkflowRun: &github.WorkflowRun{
			ID:         github.Int64(123),
			RunAttempt: github.Int(1),
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
		CompletedAt:     &github.Timestamp{Time: time.Date(2026, 3, 10, 10, 0, 30, 0, time.UTC)},
	}
}

func mustTraceID(t *testing.T, runID int64, runAttempt int) pcommon.TraceID {
	t.Helper()

	traceID, err := generateTraceID(runID, runAttempt)
	require.NoError(t, err)
	return traceID
}

func validSummaryJSON(checkRunID int64, githubJob string, completedAt string) string {
	return `{
  "schemaVersion": 1,
  "checkRunId": ` + strconv.FormatInt(checkRunID, 10) + `,
  "repo": "everr-labs/everr",
  "runId": 123,
  "runAttempt": 1,
  "githubJob": "` + githubJob + `",
  "sampleIntervalSeconds": 5,
  "startedAt": "2026-03-10T10:00:00.000Z",
  "completedAt": "` + completedAt + `",
  "runner": { "name": "GitHub Actions 1", "os": "Linux", "arch": "X64" },
  "sampleCount": 1,
  "durationMs": 10000,
  "cpu": { "avgPct": 10, "p95Pct": 10, "maxPct": 10 },
  "memory": { "avgUsedBytes": 100, "maxUsedBytes": 100 },
  "disk": { "peakUsedBytes": 50, "peakUtilizationPct": 5 },
  "load1": { "max": 0.2 }
}`
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
