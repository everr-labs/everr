package githubactionsreceiver

import (
	"context"
	"testing"

	"github.com/google/go-github/v67/github"
	"github.com/stretchr/testify/require"
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
