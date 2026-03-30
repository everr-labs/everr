package githubactionsreceiver

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/go-github/v67/github"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.uber.org/zap/zaptest"

	"github.com/everr-labs/everr/collector/semconv"
)

func TestResolveJobNamesFromCache(t *testing.T) {
	cache := newJobNameCache(10, 30*60*1e9) // 30 min
	repoID := int64(42)
	runID := int64(100)
	runAttempt := 1

	cache.AddJobName(runKey{repoID: repoID, runID: runID, runAttempt: runAttempt}, "deploy (1/2)")
	cache.AddJobName(runKey{repoID: repoID, runID: runID, runAttempt: runAttempt}, "deploy (2/2)")

	zipJobNames := []string{"deploy (1_2)", "deploy (2_2)", "lint"}

	resolved := resolveJobNames(
		context.TODO(),
		zipJobNames,
		cache,
		nil, // ghClient not needed for cache hit
		makeTestWorkflowRunEvent(repoID, runID, runAttempt),
		nil, // logger not needed for cache hit
	)

	require.Equal(t, "deploy (1/2)", resolved["deploy (1_2)"])
	require.Equal(t, "deploy (2/2)", resolved["deploy (2_2)"])
	require.Empty(t, resolved["lint"])

	// Verify cache was cleaned up
	require.Nil(t, cache.GetJobNames(runKey{repoID: repoID, runID: runID, runAttempt: runAttempt}))
}

func TestResolveJobNamesNilCache(t *testing.T) {
	resolved := resolveJobNames(context.TODO(), []string{"job"}, nil, nil, nil, nil)
	require.Nil(t, resolved)
}

func TestResolveJobNamesCacheMissNoSanitizedNames(t *testing.T) {
	cache := newJobNameCache(10, 30*60*1e9)

	zipJobNames := []string{"lint", "test-rust"}

	resolved := resolveJobNames(
		context.TODO(),
		zipJobNames,
		cache,
		nil, // ghClient nil — should not be called since no names look sanitized
		makeTestWorkflowRunEvent(1, 1, 1),
		nil,
	)

	require.Empty(t, resolved)
}

func TestLooksLikeSanitizedJobName(t *testing.T) {
	require.True(t, looksLikeSanitizedJobName("deploy (1_2)"))
	require.True(t, looksLikeSanitizedJobName("build_deploy"))
	require.True(t, looksLikeSanitizedJobName("test_rust"))
	require.False(t, looksLikeSanitizedJobName("lint"))
	require.False(t, looksLikeSanitizedJobName("deploy"))
	require.False(t, looksLikeSanitizedJobName("test-rust"))
}

func TestSpanIDMatchesTraceGeneration(t *testing.T) {
	// Verify that using the resolved original name produces the same span ID
	// as the trace-side generation in trace_event_handling.go
	originalName := "deploy (1/2)"
	runID := int64(100)
	runAttempt := 1
	stepNumber := int64(1)

	// This is what trace_event_handling.go generates for the original name
	expectedSpanID, err := generateStepSpanID(runID, runAttempt, originalName, stepNumber)
	require.NoError(t, err)

	// This is what we'd get with the sanitized name (the bug)
	buggySpanID, err := generateStepSpanID(runID, runAttempt, "deploy (1_2)", stepNumber)
	require.NoError(t, err)

	// They should be different (proving the bug exists)
	require.NotEqual(t, expectedSpanID, buggySpanID)

	// After resolution, log_event_handling uses the original name, matching trace side
	resolvedSpanID, err := generateStepSpanID(runID, runAttempt, originalName, stepNumber)
	require.NoError(t, err)
	require.Equal(t, expectedSpanID, resolvedSpanID)
}

func TestParseCombinedFileName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"simple", "0_CI.txt", "CI"},
		{"with spaces", "0_Build and Test.txt", "Build and Test"},
		{"multi-digit prefix", "12_Deploy.txt", "Deploy"},
		{"not a combined file", "CI/1_Set up job.txt", ""},
		{"no prefix", "CI.txt", ""},
		{"no extension", "0_CI", ""},
		{"underscore in name", "0_build_deploy.txt", "build_deploy"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.expected, parseCombinedFileName(tc.input))
		})
	}
}

func TestAssignLineToStep(t *testing.T) {
	base := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	steps := []stepInfo{
		{number: 1, spanID: pcommon.SpanID{1}, started: base, ended: base.Add(10 * time.Second)},
		{number: 2, spanID: pcommon.SpanID{2}, started: base.Add(10 * time.Second), ended: base.Add(30 * time.Second)},
		{number: 3, spanID: pcommon.SpanID{3}, started: base.Add(30 * time.Second), ended: base.Add(60 * time.Second)},
	}

	t.Run("within first step", func(t *testing.T) {
		s := assignLineToStep(base.Add(5*time.Second), steps)
		require.NotNil(t, s)
		require.Equal(t, int64(1), s.number)
	})

	t.Run("at step boundary", func(t *testing.T) {
		s := assignLineToStep(base.Add(10*time.Second), steps)
		require.NotNil(t, s)
		// Both step 1 (ended) and step 2 (started) match — first wins
		require.Equal(t, int64(1), s.number)
	})

	t.Run("within last step", func(t *testing.T) {
		s := assignLineToStep(base.Add(45*time.Second), steps)
		require.NotNil(t, s)
		require.Equal(t, int64(3), s.number)
	})

	t.Run("outside all ranges", func(t *testing.T) {
		s := assignLineToStep(base.Add(90*time.Second), steps)
		require.Nil(t, s)
	})

	t.Run("sub-second after step end prefers current step", func(t *testing.T) {
		// GitHub reports second-precision timestamps. A step ending at :10
		// actually ended somewhere in [:10.000, :11.000). A log line at
		// :10.500 should still be attributed to the ending step, not the
		// next one that starts at :10.
		s := assignLineToStep(base.Add(10*time.Second+500*time.Millisecond), steps)
		require.NotNil(t, s)
		require.Equal(t, int64(1), s.number)
	})
}

func TestNearestStep(t *testing.T) {
	base := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	steps := []stepInfo{
		{number: 1, spanID: pcommon.SpanID{1}, started: base, ended: base.Add(10 * time.Second)},
		{number: 2, spanID: pcommon.SpanID{2}, started: base.Add(20 * time.Second), ended: base.Add(30 * time.Second)},
	}

	t.Run("closer to first step", func(t *testing.T) {
		s := nearestStep(base.Add(12*time.Second), steps)
		require.NotNil(t, s)
		require.Equal(t, int64(1), s.number)
	})

	t.Run("closer to second step", func(t *testing.T) {
		s := nearestStep(base.Add(18*time.Second), steps)
		require.NotNil(t, s)
		require.Equal(t, int64(2), s.number)
	})

	t.Run("before all steps", func(t *testing.T) {
		s := nearestStep(base.Add(-5*time.Second), steps)
		require.NotNil(t, s)
		require.Equal(t, int64(1), s.number)
	})

	t.Run("empty steps", func(t *testing.T) {
		s := nearestStep(base, nil)
		require.Nil(t, s)
	})
}

func TestStepTimingCache(t *testing.T) {
	cache := newStepTimingCache(10, 30*time.Minute)
	key := runKey{repoID: 1, runID: 100, runAttempt: 1}

	base := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	steps := []stepTiming{
		{Number: 1, Name: "Set up job", StartedAt: base, CompletedAt: base.Add(5 * time.Second)},
		{Number: 2, Name: "Build", StartedAt: base.Add(5 * time.Second), CompletedAt: base.Add(30 * time.Second)},
	}

	cache.AddJob(key, "build", steps)

	t.Run("cache hit", func(t *testing.T) {
		result := cache.GetSteps(key)
		require.Len(t, result, 1)
		require.Equal(t, "build", result[0].jobName)
		require.Len(t, result[0].steps, 2)
	})

	t.Run("multiple jobs same run", func(t *testing.T) {
		cache.AddJob(key, "test", []stepTiming{
			{Number: 1, Name: "Run tests", StartedAt: base, CompletedAt: base.Add(60 * time.Second)},
		})
		result := cache.GetSteps(key)
		require.Len(t, result, 2)
	})

	t.Run("delete", func(t *testing.T) {
		cache.Delete(key)
		require.Nil(t, cache.GetSteps(key))
	})

	t.Run("cache miss", func(t *testing.T) {
		result := cache.GetSteps(runKey{repoID: 99, runID: 99, runAttempt: 1})
		require.Nil(t, result)
	})
}

// createCombinedZip builds an in-memory zip archive in the compacted format
// GitHub produces after a run completes — a single root-level file per job
// (e.g. "0_pre-commit.txt") instead of per-step subdirectory files.
func createCombinedZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range files {
		f, err := w.Create(name)
		require.NoError(t, err)
		_, err = f.Write([]byte(content))
		require.NoError(t, err)
	}
	require.NoError(t, w.Close())
	return buf.Bytes()
}

// TestProcessCombinedLogsWithRealWebhook parses the real workflow_job webhook
// payload to populate the step timing cache, then verifies that a combined-format
// log archive is correctly split into step-level log records.
func TestProcessCombinedLogsWithRealWebhook(t *testing.T) {
	logger := zaptest.NewLogger(t)

	// Parse the real webhook payload
	jobPayload, err := os.ReadFile("./testdata/completed/5_workflow_job_completed.json")
	require.NoError(t, err)
	jobEvent, err := github.ParseWebHook("workflow_job", jobPayload)
	require.NoError(t, err)
	wje := jobEvent.(*github.WorkflowJobEvent)

	runPayload, err := os.ReadFile("./testdata/completed/8_workflow_run_completed.json")
	require.NoError(t, err)
	runEvent, err := github.ParseWebHook("workflow_run", runPayload)
	require.NoError(t, err)
	wre := runEvent.(*github.WorkflowRunEvent)

	// Populate step timing cache from the real workflow_job event — exactly
	// as receiver.go does.
	stCache := newStepTimingCache(100, 30*time.Minute)
	job := wje.GetWorkflowJob()
	key := runKey{
		repoID:     wje.GetRepo().GetID(),
		runID:      job.GetRunID(),
		runAttempt: int(job.GetRunAttempt()),
	}

	var timings []stepTiming
	for _, s := range job.Steps {
		if s.StartedAt == nil || s.CompletedAt == nil {
			continue
		}
		timings = append(timings, stepTiming{
			Number:      s.GetNumber(),
			Name:        s.GetName(),
			StartedAt:   s.GetStartedAt().Time,
			CompletedAt: s.GetCompletedAt().Time,
		})
	}
	stCache.AddJob(key, job.GetName(), timings)

	// Build a combined-format zip with log lines spanning multiple steps.
	// Steps from the real payload:
	//   1: Set up job        10:11:33 – 10:11:35
	//   2: checkout           10:11:35 – 10:11:36
	//   4: pip install        10:11:36 – 10:11:42
	combinedLog := "" +
		"2023-10-13T10:11:33Z Setting up the job\n" +
		"2023-10-13T10:11:34Z Preparing environment\n" +
		"2023-10-13T10:11:35Z Checking out code\n" +
		"2023-10-13T10:11:37Z Installing pip packages\n" +
		"2023-10-13T10:11:40Z Still installing...\n"

	zipData := createCombinedZip(t, map[string]string{
		"0_pre-commit.txt": combinedLog,
	})

	// Serve the zip over HTTP so eventToLogs can download it
	zipServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/zip")
		_, _ = w.Write(zipData)
	}))
	defer zipServer.Close()

	// Create a mock GitHub API server that returns the zip URL.
	// go-github prepends "/api/v3" for enterprise URLs.
	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Logf("API request: %s %s", r.Method, r.URL.Path)
		// Match the logs endpoint — go-github uses /api/v3/repos/... for enterprise
		expectedSuffix := fmt.Sprintf("/repos/%s/%s/actions/runs/%d/attempts/%d/logs",
			wre.GetRepo().GetOwner().GetLogin(),
			wre.GetRepo().GetName(),
			wre.GetWorkflowRun().GetID(),
			wre.GetWorkflowRun().GetRunAttempt())
		if r.URL.Path == expectedSuffix || r.URL.Path == "/api/v3"+expectedSuffix {
			http.Redirect(w, r, zipServer.URL, http.StatusFound)
			return
		}
		http.NotFound(w, r)
	}))
	defer apiServer.Close()

	ghClient, err := github.NewClient(nil).WithEnterpriseURLs(apiServer.URL+"/", apiServer.URL+"/")
	require.NoError(t, err)

	jnCache := newJobNameCache(100, 30*time.Minute)

	logs, err := eventToLogs(
		context.Background(),
		wre,
		&Config{},
		ghClient,
		logger,
		true, // withTraceInfo
		jnCache,
		stCache,
	)
	require.NoError(t, err)
	require.NotNil(t, logs)

	// Verify we got log records split across the correct steps
	rl := logs.ResourceLogs()
	require.Equal(t, 1, rl.Len())

	sl := rl.At(0).ScopeLogs()
	require.Equal(t, 1, sl.Len(), "expected one scope (one job)")

	scope := sl.At(0)
	scopeJobName, ok := scope.Scope().Attributes().Get(string("cicd.pipeline.task.name"))
	require.True(t, ok)
	require.Equal(t, "pre-commit", scopeJobName.Str())

	records := scope.LogRecords()
	require.Equal(t, 5, records.Len(), "expected 5 log lines")

	// Collect step numbers assigned to each log line
	stepNumbers := make([]int64, records.Len())
	for i := 0; i < records.Len(); i++ {
		sn, ok := records.At(i).Attributes().Get(semconv.EverrGitHubWorkflowJobStepNumber)
		require.True(t, ok, "log record %d missing step number", i)
		stepNumbers[i] = sn.Int()
	}

	// Lines at 10:11:33 and 10:11:34 → step 1 (Set up job: 10:11:33–10:11:35)
	require.Equal(t, int64(1), stepNumbers[0], "line at 10:11:33 should be step 1")
	require.Equal(t, int64(1), stepNumbers[1], "line at 10:11:34 should be step 1")

	// Line at 10:11:35 → step 1 or 2 (boundary — step 1 ends at 10:11:35, step 2 starts at 10:11:35)
	// assignLineToStep picks the first match, so step 1.
	require.Equal(t, int64(1), stepNumbers[2], "line at 10:11:35 should be step 1 (boundary)")

	// Lines at 10:11:37 and 10:11:40 → step 4 (pip install: 10:11:36–10:11:42)
	require.Equal(t, int64(4), stepNumbers[3], "line at 10:11:37 should be step 4")
	require.Equal(t, int64(4), stepNumbers[4], "line at 10:11:40 should be step 4")

	// Verify trace/span IDs are set
	for i := 0; i < records.Len(); i++ {
		require.False(t, records.At(i).TraceID().IsEmpty(), "log record %d should have trace ID", i)
		require.False(t, records.At(i).SpanID().IsEmpty(), "log record %d should have span ID", i)
	}

	// Verify span IDs match what trace_event_handling would generate
	expectedSpanID1, err := generateStepSpanID(
		wre.GetWorkflowRun().GetID(),
		wre.GetWorkflowRun().GetRunAttempt(),
		"pre-commit",
		1,
	)
	require.NoError(t, err)
	require.Equal(t, expectedSpanID1, records.At(0).SpanID(), "span ID should match trace-side generation")

	// Step timing cache should be cleaned up after use
	require.Nil(t, stCache.GetSteps(key), "step timing cache should be cleaned up after use")
}

// TestEventToLogsNormalFormatUnchanged verifies the normal (non-compacted) log
// format still works correctly with the new stepTimingsCache parameter.
func TestEventToLogsNormalFormatUnchanged(t *testing.T) {
	logger := zaptest.NewLogger(t)

	runPayload, err := os.ReadFile("./testdata/completed/8_workflow_run_completed.json")
	require.NoError(t, err)
	runEvent, err := github.ParseWebHook("workflow_run", runPayload)
	require.NoError(t, err)
	wre := runEvent.(*github.WorkflowRunEvent)

	// Create a normal-format zip (per-step files in subdirectories)
	normalLog := "2023-10-13T10:11:33Z Setting up the job\n"
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, err := w.Create("pre-commit/1_Set up job.txt")
	require.NoError(t, err)
	_, err = f.Write([]byte(normalLog))
	require.NoError(t, err)
	require.NoError(t, w.Close())
	zipData := buf.Bytes()

	zipServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/zip")
		_, _ = w.Write(zipData)
	}))
	defer zipServer.Close()

	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expectedSuffix := fmt.Sprintf("/repos/%s/%s/actions/runs/%d/attempts/%d/logs",
			wre.GetRepo().GetOwner().GetLogin(),
			wre.GetRepo().GetName(),
			wre.GetWorkflowRun().GetID(),
			wre.GetWorkflowRun().GetRunAttempt())
		if r.URL.Path == expectedSuffix || r.URL.Path == "/api/v3"+expectedSuffix {
			http.Redirect(w, r, zipServer.URL, http.StatusFound)
			return
		}
		http.NotFound(w, r)
	}))
	defer apiServer.Close()

	ghClient, err := github.NewClient(nil).WithEnterpriseURLs(apiServer.URL+"/", apiServer.URL+"/")
	require.NoError(t, err)

	jnCache := newJobNameCache(100, 30*time.Minute)
	stCache := newStepTimingCache(100, 30*time.Minute)

	logs, err := eventToLogs(
		context.Background(),
		wre,
		&Config{},
		ghClient,
		logger,
		true,
		jnCache,
		stCache,
	)
	require.NoError(t, err)
	require.NotNil(t, logs)

	// Should have used the normal path (subdirectory step files)
	rl := logs.ResourceLogs()
	require.Equal(t, 1, rl.Len())
	sl := rl.At(0).ScopeLogs()
	require.Equal(t, 1, sl.Len())

	records := sl.At(0).LogRecords()
	require.Equal(t, 1, records.Len())

	sn, ok := records.At(0).Attributes().Get(semconv.EverrGitHubWorkflowJobStepNumber)
	require.True(t, ok)
	require.Equal(t, int64(1), sn.Int())
}

func makeTestWorkflowRunEvent(repoID, runID int64, runAttempt int) *github.WorkflowRunEvent {
	return &github.WorkflowRunEvent{
		Repo: &github.Repository{
			ID:    &repoID,
			Owner: &github.User{Login: getPtr("owner")},
			Name:  getPtr("repo"),
		},
		WorkflowRun: &github.WorkflowRun{
			ID:         &runID,
			RunAttempt: &runAttempt,
			Status:     getPtr("completed"),
		},
	}
}
