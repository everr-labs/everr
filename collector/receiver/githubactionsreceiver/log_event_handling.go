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

func eventToLogs(ctx context.Context, event interface{}, config *Config, ghClient *github.Client, logger *zap.Logger, withTraceInfo bool, jobNamesCache *jobNameCache) (*plog.Logs, error) {
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

	// Extract job names from file paths and collect step files
	// GitHub's zip doesn't include explicit directory entries, so we parse job names from file paths
	jobsSet := make(map[string]struct{})
	var files = make([]*zip.File, 0)

	for _, f := range archive.File {
		if f.FileInfo().IsDir() {
			continue // Skip directory entries if they exist
		}

		// Extract job name from path (e.g., "Test/1_Set up job.txt" -> "Test")
		if idx := strings.Index(f.Name, "/"); idx > 0 {
			jobName := f.Name[:idx]
			jobsSet[jobName] = struct{}{}
			files = append(files, f)
		}
		// Skip root-level files (e.g., "0_Test.txt") as they are combined logs
	}

	// Convert set to slice
	jobs := make([]string, 0, len(jobsSet))
	for job := range jobsSet {
		jobs = append(jobs, job)
	}

	logger.Debug("Extracted jobs from zip", zap.Strings("jobs", jobs), zap.Int("file_count", len(files)))

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

		for _, logFile := range files {
			// File matching uses the ZIP directory name
			if !strings.HasPrefix(logFile.Name, zipJobName+"/") {
				continue
			}

			fileNameWithoutDir := strings.TrimPrefix(logFile.Name, zipJobName+"/")
			stepNumberStr := strings.Split(fileNameWithoutDir, "_")[0]
			stepNumber, err := strconv.Atoi(stepNumberStr)
			if err != nil {
				logger.Error("Invalid step number", zap.String("stepNumberStr", stepNumberStr), zap.Error(err))
				continue
			}

			// Span ID uses the original name to match trace-side generation
			spanID, err := generateStepSpanID(e.GetWorkflowRun().GetID(), e.GetWorkflowRun().GetRunAttempt(), jobName, int64(stepNumber))
			if err != nil {
				logger.Error("Failed to generate span ID", zap.Error(err))
				continue
			}

			ff, err := logFile.Open()
			if err != nil {
				logger.Error("Failed to open file", zap.Error(err))
				continue
			}

			scanner := bufio.NewScanner(ff)
			for scanner.Scan() {
				lineText := scanner.Text()
				if lineText == "" {
					logger.Debug("Skipping empty line")
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

				record := jobLogsScope.LogRecords().AppendEmpty()
				if withTraceInfo {
					record.SetSpanID(spanID)
					record.SetTraceID(traceID)
				}
				record.Attributes().PutInt(semconv.EverrGitHubWorkflowJobStepNumber, int64(stepNumber))
				record.SetTimestamp(pcommon.NewTimestampFromTime(parsedTime))
				record.SetObservedTimestamp(pcommon.NewTimestampFromTime(time.Now()))
				record.Body().SetStr(line)
			}

			if err := scanner.Err(); err != nil {
				logger.Error("Error reading file", zap.Error(err))
			}

			ff.Close()
		}
	}

	return &logs, nil
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
			if strings.Contains(name, "/") {
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
