// Copyright The OpenTelemetry Authors
// Copyright 2026 Giordano Ricci (operating as "Everr Labs")
// SPDX-License-Identifier: Apache-2.0
//
// This file has been modified from its original version.

package githubactionsreceiver

import (
	"archive/zip"
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/go-github/v67/github"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/semconv"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
)

const maxLogArchiveSize = 256 * 1024 * 1024 // 256 MB

func eventToLogs(ctx context.Context, event interface{}, config *Config, ghClient *github.Client, logger *zap.Logger, withTraceInfo bool, jobNamesCache *jobNameCache, stepTimingsCache *stepTimingCache) (*plog.Logs, error) {
	e, ok := event.(*github.WorkflowRunEvent)
	if !ok {
		return nil, nil
	}

	if e.GetWorkflowRun().GetStatus() != "completed" {
		logger.Debug("Run not completed, skipping")
		return nil, nil
	}

	repositoryID, err := requireRepositoryID(e.GetRepo().GetID())
	if err != nil {
		logger.Error("Failed to determine repository ID", zap.Error(err))
		return nil, err
	}

	traceID, err := generateTraceID(repositoryID, e.GetWorkflowRun().GetID(), e.GetWorkflowRun().GetRunAttempt())
	if err != nil {
		logger.Error("Failed to generate trace ID", zap.Error(err))
		return nil, err
	}

	logs := plog.NewLogs()
	allLogs := logs.ResourceLogs().AppendEmpty()
	attrs := allLogs.Resource().Attributes()

	setWorkflowRunEventAttributes(attrs, e, config)

	url, _, err := ghClient.Actions.GetWorkflowRunAttemptLogs(ctx, e.GetRepo().GetOwner().GetLogin(), e.GetRepo().GetName(), e.GetWorkflowRun().GetID(), e.GetWorkflowRun().GetRunAttempt(), 10)

	if err != nil {
		logger.Error("Failed to get logs", zap.Error(err))
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url.String(), nil)
	if err != nil {
		logger.Error("Failed to create log download request", zap.Error(err))
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		logger.Error("Failed to get logs", zap.Error(err))
		return nil, err
	}
	defer resp.Body.Close()

	tmpFile, err := os.CreateTemp("", "tmpfile-")
	if err != nil {
		logger.Error("Failed to create temp file", zap.Error(err))
		return nil, err
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	// Copy the response into the temp file with a size limit
	_, err = io.Copy(tmpFile, io.LimitReader(resp.Body, maxLogArchiveSize))
	if err != nil {
		logger.Error("Failed to copy response to temp file", zap.Error(err))
		return nil, err
	}

	archive, err := zip.OpenReader(tmpFile.Name())
	if err != nil {
		logger.Error("Failed to open zip file", zap.Error(err))
		return nil, fmt.Errorf("failed to open zip file: %w", err)
	}
	defer archive.Close()

	if archive.File == nil {
		logger.Error("Archive is empty")
		return nil, fmt.Errorf("archive is empty")
	}

	// Classify zip entries: subdirectory files are per-step logs (normal format),
	// root-level files like "0_<job>.txt" are combined logs (compacted format).
	jobsSet := make(map[string]struct{})
	var stepFiles []*zip.File
	var combinedFiles []*zip.File

	for _, f := range archive.File {
		if f.FileInfo().IsDir() {
			continue
		}

		if idx := strings.Index(f.Name, "/"); idx > 0 {
			jobName := f.Name[:idx]
			fileName := f.Name[idx+1:]

			// Skip non-step files like "system.txt" — they don't have a
			// numeric prefix and contain no user-visible log content.
			prefix := strings.Split(fileName, "_")[0]
			if _, err := strconv.Atoi(prefix); err != nil {
				continue
			}

			jobsSet[jobName] = struct{}{}
			stepFiles = append(stepFiles, f)
		} else {
			// Root-level file (e.g. "0_CI.txt") — combined log
			combinedFiles = append(combinedFiles, f)
		}
	}

	// Determine format: if we have subdirectory step files, use them (normal path).
	// Otherwise fall back to combined files with step-timing splitting.
	if len(stepFiles) == 0 && len(combinedFiles) > 0 {
		logger.Debug("Archive contains combined logs only, using step-timing splitting",
			zap.Int("combined_file_count", len(combinedFiles)))

		key := runKey{
			repoID:     e.GetRepo().GetID(),
			runID:      e.GetWorkflowRun().GetID(),
			runAttempt: e.GetWorkflowRun().GetRunAttempt(),
		}
		cachedJobs := stepTimingsCache.GetSteps(key)
		if cachedJobs == nil {
			logger.Debug("Step timing cache miss, fetching from API")
			cachedJobs = fetchStepTimingsFromAPI(ctx, ghClient, e, logger)
		}
		if cachedJobs == nil {
			logger.Warn("No step timing data available, cannot split combined logs")
			return &logs, nil
		}
		stepTimingsCache.Delete(key)

		processCombinedLogs(combinedFiles, e, allLogs, traceID, withTraceInfo, cachedJobs, logger)
		return &logs, nil
	}

	// Normal format: per-step log files in subdirectories
	jobs := make([]string, 0, len(jobsSet))
	for job := range jobsSet {
		jobs = append(jobs, job)
	}

	logger.Debug("Extracted jobs from zip", zap.Strings("jobs", jobs), zap.Int("file_count", len(stepFiles)))

	// Resolve sanitized ZIP directory names to original job names.
	// GitHub sanitizes "/" to "_" in ZIP paths, causing span ID mismatches
	// for matrix/sharded jobs like "test (1/2)" → "test (1_2)".
	resolvedNames := resolveJobNames(ctx, jobs, jobNamesCache, ghClient, e, logger)

	for _, zipJobName := range jobs {
		// Use the original (unsanitized) name for scope attributes and span IDs.
		// The ZIP directory name is kept for file path matching.
		jobName := zipJobName
		if resolvedNames != nil {
			if resolved, ok := resolvedNames[zipJobName]; ok {
				jobName = resolved
			}
		}

		jobLogsScope := allLogs.ScopeLogs().AppendEmpty()
		jobLogsScope.Scope().Attributes().PutStr(string(conventions.CICDPipelineTaskNameKey), jobName)

		for _, logFile := range stepFiles {
			// File matching uses the ZIP directory name
			if !strings.HasPrefix(logFile.Name, zipJobName+"/") {
				continue
			}

			fileNameWithoutDir := strings.TrimPrefix(logFile.Name, zipJobName+"/")
			stepNumberStr := strings.Split(fileNameWithoutDir, "_")[0]
			stepNumber, err := strconv.Atoi(stepNumberStr)
			if err != nil {
				// Skip non-step files like "system.txt"
				continue
			}

			// Span ID uses the original name to match trace-side generation
			spanID, err := generateStepSpanID(e.GetWorkflowRun().GetID(), e.GetWorkflowRun().GetRunAttempt(), jobName, int64(stepNumber))
			if err != nil {
				logger.Error("Failed to generate span ID", zap.Error(err))
				continue
			}

			emitLogRecords(logFile, jobLogsScope, traceID, spanID, stepNumber, withTraceInfo, logger)
		}
	}

	return &logs, nil
}

// parsedLine is a single log line with its parsed timestamp.
type parsedLine struct {
	time time.Time
	body string
}

// scanLogFile reads a zip log file and calls emit for each parsed line.
func scanLogFile(f *zip.File, logger *zap.Logger, emit func(parsedLine)) {
	ff, err := f.Open()
	if err != nil {
		logger.Error("Failed to open file", zap.Error(err))
		return
	}
	defer ff.Close()

	scanner := bufio.NewScanner(ff)
	firstLine := true
	for scanner.Scan() {
		lineText := scanner.Text()
		if firstLine {
			lineText = strings.TrimPrefix(lineText, "\xEF\xBB\xBF")
			firstLine = false
		}
		if lineText == "" {
			continue
		}

		ts, line, ok := strings.Cut(lineText, " ")
		if !ok {
			logger.Error("Failed to cut log line", zap.String("body", lineText))
			continue
		}

		parsedTime, err := time.Parse(time.RFC3339, ts)
		if err != nil {
			logger.Error("Failed to parse timestamp", zap.String("timestamp", ts), zap.Error(err))
			continue
		}

		emit(parsedLine{time: parsedTime, body: line})
	}

	if err := scanner.Err(); err != nil {
		logger.Error("Error reading file", zap.Error(err))
	}
}

// emitLogRecords reads a zip log file and emits one log record per line.
func emitLogRecords(logFile *zip.File, scope plog.ScopeLogs, traceID pcommon.TraceID, spanID pcommon.SpanID, stepNumber int, withTraceInfo bool, logger *zap.Logger) {
	scanLogFile(logFile, logger, func(pl parsedLine) {
		record := scope.LogRecords().AppendEmpty()
		if withTraceInfo {
			record.SetSpanID(spanID)
			record.SetTraceID(traceID)
		}
		record.Attributes().PutInt(semconv.EverrGitHubWorkflowJobStepNumber, int64(stepNumber))
		record.SetTimestamp(pcommon.NewTimestampFromTime(pl.time))
		record.SetObservedTimestamp(pcommon.NewTimestampFromTime(time.Now()))
		record.Body().SetStr(pl.body)
	})
}

// processCombinedLogs handles the compacted log format where GitHub merges all
// step logs into a single root-level file per job (e.g. "0_CI.txt"). It uses
// step timing data from the cache (populated by workflow_job events) to assign
// each log line to the correct step based on its timestamp.
func processCombinedLogs(
	combinedFiles []*zip.File,
	e *github.WorkflowRunEvent,
	allLogs plog.ResourceLogs,
	traceID pcommon.TraceID,
	withTraceInfo bool,
	cachedJobs []jobStepTimings,
	logger *zap.Logger,
) {
	runID := e.GetWorkflowRun().GetID()
	runAttempt := e.GetWorkflowRun().GetRunAttempt()

	// Build a lookup from sanitized job name → jobStepTimings.
	// Combined file names are "0_<jobName>.txt" where jobName matches the
	// sanitized (slash→underscore) form used in ZIP directories.
	// The original (unsanitized) job name is preserved in jst.jobName for
	// scope attributes and span ID generation — no extra API call needed.
	timingsByZipName := make(map[string]jobStepTimings)
	for _, jst := range cachedJobs {
		sanitized := strings.ReplaceAll(jst.jobName, "/", "_")
		timingsByZipName[sanitized] = jst
	}

	for _, cf := range combinedFiles {
		// Parse "0_<jobName>.txt" → jobName
		jobZipName := parseCombinedFileName(cf.Name)
		if jobZipName == "" {
			logger.Debug("Skipping non-combined root file", zap.String("name", cf.Name))
			continue
		}

		jst, ok := timingsByZipName[jobZipName]
		if !ok {
			logger.Warn("No step timing data for combined log file", zap.String("file", cf.Name), zap.String("job", jobZipName))
			continue
		}

		// Use the original (unsanitized) job name for scope attributes and span IDs
		jobName := jst.jobName

		jobLogsScope := allLogs.ScopeLogs().AppendEmpty()
		jobLogsScope.Scope().Attributes().PutStr(string(conventions.CICDPipelineTaskNameKey), jobName)

		// Pre-generate span IDs for each step
		steps := make([]stepInfo, 0, len(jst.steps))
		for _, st := range jst.steps {
			spanID, err := generateStepSpanID(runID, runAttempt, jobName, st.Number)
			if err != nil {
				logger.Error("Failed to generate span ID for step", zap.Int64("step", st.Number), zap.Error(err))
				continue
			}
			steps = append(steps, stepInfo{
				number:  st.Number,
				spanID:  spanID,
				started: st.StartedAt,
				ended:   st.CompletedAt,
			})
		}

		scanLogFile(cf, logger, func(pl parsedLine) {
			// Find which step this line belongs to based on timestamp
			step := assignLineToStep(pl.time, steps)
			if step == nil {
				// Timestamp outside all step ranges — assign to nearest step
				step = nearestStep(pl.time, steps)
			}
			if step == nil {
				return
			}

			record := jobLogsScope.LogRecords().AppendEmpty()
			if withTraceInfo {
				record.SetSpanID(step.spanID)
				record.SetTraceID(traceID)
			}
			record.Attributes().PutInt(semconv.EverrGitHubWorkflowJobStepNumber, step.number)
			record.SetTimestamp(pcommon.NewTimestampFromTime(pl.time))
			record.SetObservedTimestamp(pcommon.NewTimestampFromTime(time.Now()))
			record.Body().SetStr(pl.body)
		})
	}

}

// parseCombinedFileName extracts the job name from a combined log filename.
// "0_CI.txt" → "CI", "0_Build and Test.txt" → "Build and Test".
// Returns "" if the filename doesn't match the combined format.
func parseCombinedFileName(name string) string {
	if !strings.HasSuffix(name, ".txt") {
		return ""
	}
	// Strip .txt
	name = strings.TrimSuffix(name, ".txt")
	// Must start with a number prefix followed by underscore
	idx := strings.Index(name, "_")
	if idx < 0 {
		return ""
	}
	prefix := name[:idx]
	if _, err := strconv.Atoi(prefix); err != nil {
		return ""
	}
	return name[idx+1:]
}

type stepInfo struct {
	number  int64
	spanID  pcommon.SpanID
	started time.Time
	ended   time.Time
}

// assignLineToStep finds the step whose time range contains the given timestamp.
// Returns nil if no step matches.
//
// GitHub's step timestamps have only second precision, but log lines have
// sub-second precision. A step reported as ending at 17:02:37Z actually ended
// somewhere in [17:02:37.000, 17:02:38.000). We extend the end boundary by
// 999ms so that log lines in the final sub-second of a step are correctly
// attributed. The first matching step wins, so earlier steps take precedence
// at shared boundaries.
func assignLineToStep(ts time.Time, steps []stepInfo) *stepInfo {
	for i := range steps {
		endWithMargin := steps[i].ended.Add(999 * time.Millisecond)
		if !ts.Before(steps[i].started) && !ts.After(endWithMargin) {
			return &steps[i]
		}
	}
	return nil
}

// nearestStep returns the step with the closest boundary to the given timestamp.
func nearestStep(ts time.Time, steps []stepInfo) *stepInfo {
	if len(steps) == 0 {
		return nil
	}

	best := &steps[0]
	bestDist := minDuration(absDuration(ts.Sub(best.started)), absDuration(ts.Sub(best.ended)))

	for i := 1; i < len(steps); i++ {
		dist := minDuration(absDuration(ts.Sub(steps[i].started)), absDuration(ts.Sub(steps[i].ended)))
		if dist < bestDist {
			best = &steps[i]
			bestDist = dist
		}
	}
	return best
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}

// fetchStepTimingsFromAPI calls the GitHub API to get step timing data
// when the cache doesn't have it.
func fetchStepTimingsFromAPI(ctx context.Context, ghClient *github.Client, e *github.WorkflowRunEvent, logger *zap.Logger) []jobStepTimings {
	owner := e.GetRepo().GetOwner().GetLogin()
	repo := e.GetRepo().GetName()
	runID := e.GetWorkflowRun().GetID()

	opts := &github.ListWorkflowJobsOptions{
		Filter:      "latest",
		ListOptions: github.ListOptions{PerPage: 100},
	}

	var result []jobStepTimings
	for {
		jobsResp, resp, err := ghClient.Actions.ListWorkflowJobs(ctx, owner, repo, runID, opts)
		if err != nil {
			logger.Warn("Failed to list workflow jobs for step timing", zap.Error(err))
			return nil
		}

		for _, job := range jobsResp.Jobs {
			if job.GetStatus() != "completed" {
				continue
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
			if len(timings) > 0 {
				result = append(result, jobStepTimings{
					jobName: job.GetName(),
					steps:   timings,
				})
			}
		}

		if resp == nil || resp.NextPage == 0 {
			break
		}
		opts.Page = resp.NextPage
	}

	return result
}

func resolveJobNames(ctx context.Context, zipJobNames []string, jobNamesCache *jobNameCache, ghClient *github.Client, e *github.WorkflowRunEvent, logger *zap.Logger) map[string]string {
	if jobNamesCache == nil {
		return nil
	}

	resolvedNames := make(map[string]string) // zipDirName → originalName

	key := runKey{
		repoID:     e.GetRepo().GetID(),
		runID:      e.GetWorkflowRun().GetID(),
		runAttempt: e.GetWorkflowRun().GetRunAttempt(),
	}
	originals := jobNamesCache.GetJobNames(key)

	if originals == nil {
		// Cache miss — check if any ZIP name looks sanitized before calling API
		needsAPI := false
		for _, zipName := range zipJobNames {
			if looksLikeSanitizedJobName(zipName) {
				needsAPI = true
				break
			}
		}
		if needsAPI {
			originals = listSanitizedJobNames(ctx, ghClient, e, logger)
		}
	}

	for _, original := range originals {
		sanitized := strings.ReplaceAll(original, "/", "_")
		for _, zipName := range zipJobNames {
			if zipName == sanitized {
				resolvedNames[zipName] = original
				break
			}
		}
	}

	// Clean up cache entry after consumption
	jobNamesCache.Delete(key)

	return resolvedNames
}

// looksLikeSanitizedJobName checks if a ZIP directory name contains "_"
// which could be a "/" sanitized by GitHub's ZIP archive builder.
func looksLikeSanitizedJobName(name string) bool {
	return strings.Contains(name, "_")
}

// listSanitizedJobNames calls the GitHub API to list workflow jobs and
// returns original names that contain "/" (i.e., names GitHub would sanitize).
func listSanitizedJobNames(ctx context.Context, ghClient *github.Client, e *github.WorkflowRunEvent, logger *zap.Logger) []string {
	owner := e.GetRepo().GetOwner().GetLogin()
	repo := e.GetRepo().GetName()
	runID := e.GetWorkflowRun().GetID()

	opts := &github.ListWorkflowJobsOptions{
		Filter:      "latest",
		ListOptions: github.ListOptions{PerPage: 100},
	}

	var originals []string
	for {
		jobsResp, resp, err := ghClient.Actions.ListWorkflowJobs(ctx, owner, repo, runID, opts)
		if err != nil {
			logger.Warn("Failed to list workflow jobs for name resolution", zap.Error(err))
			return nil
		}

		for _, job := range jobsResp.Jobs {
			name := job.GetName()
			if strings.Contains(name, "/") || strings.Contains(name, "_") {
				originals = append(originals, name)
			}
		}

		if resp == nil || resp.NextPage == 0 {
			break
		}
		opts.Page = resp.NextPage
	}

	return originals
}
