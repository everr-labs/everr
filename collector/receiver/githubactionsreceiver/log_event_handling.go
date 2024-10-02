// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package githubactionsreceiver

import (
	"archive/zip"
	"bufio"
	"context"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/go-github/v61/github"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.uber.org/zap"
)

func eventToLogs(event interface{}, config *Config, ghClient *github.Client, logger *zap.Logger, withTraceInfo bool) (*plog.Logs, error) {
	e, ok := event.(*github.WorkflowRunEvent)
	if !ok {
		logger.Debug("Invalid event type, skipping")
		return nil, nil
	}

	if e.GetWorkflowRun().GetStatus() != "completed" {
		logger.Debug("Run not completed, skipping")
		return nil, nil
	}

	traceID, _ := generateTraceID(e.GetWorkflowRun().GetID(), e.GetWorkflowRun().GetRunAttempt())

	logs := plog.NewLogs()
	allLogs := logs.ResourceLogs().AppendEmpty()
	attrs := allLogs.Resource().Attributes()

	setWorkflowRunEventAttributes(attrs, e, config)

	url, _, err := ghClient.Actions.GetWorkflowRunAttemptLogs(context.Background(), e.GetRepo().GetOwner().GetLogin(), e.GetRepo().GetName(), e.GetWorkflowRun().GetID(), e.GetWorkflowRun().GetRunAttempt(), 10)

	if err != nil {
		logger.Error("Failed to get logs", zap.Error(err))
		return nil, err
	}

	out, err := os.CreateTemp("", "tmpfile-")
	if err != nil {
		logger.Error("Failed to create temp file", zap.Error(err))
		return nil, err
	}
	defer out.Close()
	defer os.Remove(out.Name())

	resp, err := http.Get(url.String())
	if err != nil {
		logger.Error("Failed to get logs", zap.Error(err))
		return nil, err
	}
	defer resp.Body.Close()

	// Copy the response into the temp file
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		logger.Error("Failed to copy response to temp file", zap.Error(err))
		return nil, err
	}

	archive, _ := zip.OpenReader(out.Name())
	defer archive.Close()

	// steps is a map of job names to a map of step numbers to file names
	var jobs = make([]string, 0)
	var files = make([]*zip.File, 0)

	// first we get all the directories. each directory is a job
	for _, f := range archive.File {
		if f.FileInfo().IsDir() {
			// if the file is a directory, then it's a job. each file in this directory is a step
			jobs = append(jobs, f.Name[:len(f.Name)-1])
		} else {
			files = append(files, f)
		}
	}

	for _, jobName := range jobs {
		jobLogsScope := allLogs.ScopeLogs().AppendEmpty()
		jobLogsScope.Scope().Attributes().PutStr("ci.github.workflow.job.name", jobName)

		for _, logFile := range files {
			if !strings.HasPrefix(logFile.Name, jobName) {
				continue
			}

			fileNameWithoutDir := strings.TrimPrefix(logFile.Name, jobName+"/")
			stepNumberStr := strings.Split(fileNameWithoutDir, "_")[0]
			stepNumber, err := strconv.Atoi(stepNumberStr)
			if err != nil {
				logger.Error("Invalid step number", zap.String("stepNumberStr", stepNumberStr), zap.Error(err))
				continue
			}

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
			defer ff.Close()

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
				record.Attributes().PutInt("ci.github.workflow.job.step.number", int64(stepNumber))
				record.SetTimestamp(pcommon.NewTimestampFromTime(parsedTime))
				record.SetObservedTimestamp(pcommon.NewTimestampFromTime(time.Now()))
				record.Body().SetStr(line)
			}

			if err := scanner.Err(); err != nil {
				logger.Error("Error reading file", zap.Error(err))
			}
		}
	}

	return &logs, nil
}
