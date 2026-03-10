// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package testlogstotraces

import (
	"context"
	"sort"
	"time"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/connector"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.uber.org/zap"

	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"

	"github.com/everr-labs/everr/collector/connector/testlogstotraces/gotest"
	"github.com/everr-labs/everr/collector/connector/testlogstotraces/rusttest"
	"github.com/everr-labs/everr/collector/connector/testlogstotraces/vitest"
	"github.com/everr-labs/everr/collector/semconv"
)

type testLogsToTracesConnector struct {
	logger         *zap.Logger
	tracesConsumer consumer.Traces
}

func newConnector(
	set connector.Settings,
	_ component.Config,
	traces consumer.Traces,
) (*testLogsToTracesConnector, error) {
	return &testLogsToTracesConnector{
		logger:         set.Logger,
		tracesConsumer: traces,
	}, nil
}

func (c *testLogsToTracesConnector) Capabilities() consumer.Capabilities {
	return consumer.Capabilities{MutatesData: false}
}

func (c *testLogsToTracesConnector) Start(_ context.Context, _ component.Host) error {
	return nil
}

func (c *testLogsToTracesConnector) Shutdown(_ context.Context) error {
	return nil
}

// ConsumeLogs processes incoming logs, detects supported test patterns, and emits traces.
func (c *testLogsToTracesConnector) ConsumeLogs(ctx context.Context, ld plog.Logs) error {
	var allTestTraces *ptrace.Traces

	for i := 0; i < ld.ResourceLogs().Len(); i++ {
		resourceLogs := ld.ResourceLogs().At(i)
		resourceAttrs := resourceLogs.Resource().Attributes()

		// Extract run ID and run attempt from resource attributes
		runIDVal, ok := resourceAttrs.Get(string(conventions.CICDPipelineRunIDKey))
		if !ok {
			continue
		}
		runID := runIDVal.Int()

		runAttemptVal, ok := resourceAttrs.Get(semconv.EverrGitHubWorkflowRunRunAttempt)
		if !ok {
			continue
		}
		runAttempt := int(runAttemptVal.Int())

		// Build resource attributes for test spans
		testResourceAttrs := pcommon.NewMap()
		resourceAttrs.CopyTo(testResourceAttrs)

		for j := 0; j < resourceLogs.ScopeLogs().Len(); j++ {
			scopeLogs := resourceLogs.ScopeLogs().At(j)

			// Extract job name from scope attributes
			jobNameVal, ok := scopeLogs.Scope().Attributes().Get(string(conventions.CICDPipelineTaskNameKey))
			if !ok {
				continue
			}
			jobName := jobNameVal.Str()

			// Group log records by step number
			stepLogs := make(map[int64][]logRecord)
			for k := 0; k < scopeLogs.LogRecords().Len(); k++ {
				record := scopeLogs.LogRecords().At(k)

				stepNumVal, ok := record.Attributes().Get(semconv.EverrGitHubWorkflowJobStepNumber)
				if !ok {
					continue
				}
				stepNum := stepNumVal.Int()

				stepLogs[stepNum] = append(stepLogs[stepNum], logRecord{
					body:      record.Body().Str(),
					timestamp: record.Timestamp().AsTime(),
					traceID:   record.TraceID(),
					spanID:    record.SpanID(),
				})
			}

			// Process each step's logs through the test parsers
			for stepNum, records := range stepLogs {
				if len(records) == 0 {
					continue
				}

				// Sort records by timestamp to ensure correct ordering
				sort.Slice(records, func(a, b int) bool {
					return records[a].timestamp.Before(records[b].timestamp)
				})

				// Use traceID and spanID from the first record in the step
				traceID := records[0].traceID
				spanID := records[0].spanID

				// Try Go test parser
				goCtx := gotest.NewParseContext(runID, runAttempt, jobName, stepNum, traceID, spanID)
				goParser := gotest.NewParser(goCtx, c.logger)

				// Try Vitest parser
				vitestCtx := gotest.NewParseContext(runID, runAttempt, jobName, stepNum, traceID, spanID)
				vitestParser := vitest.NewParser(vitestCtx, c.logger)

				// Try Rust test parser
				rustCtx := gotest.NewParseContext(runID, runAttempt, jobName, stepNum, traceID, spanID)
				rustParser := rusttest.NewParser(rustCtx, c.logger)

				for _, rec := range records {
					goParser.ProcessLine(rec.body, rec.timestamp)
					vitestParser.ProcessLine(rec.body, rec.timestamp)
					rustParser.ProcessLine(rec.body, rec.timestamp)
				}
				goParser.Finalize()
				vitestParser.Finalize()
				rustParser.Finalize()

				// Use whichever parser detected more tests.
				var spans *ptrace.Traces
				switch {
				case goCtx.TestCount() >= vitestCtx.TestCount() &&
					goCtx.TestCount() >= rustCtx.TestCount() &&
					goCtx.HasTests():
					spans = goCtx.GenerateSpans(testResourceAttrs)
				case vitestCtx.TestCount() >= rustCtx.TestCount() && vitestCtx.HasTests():
					spans = vitest.GenerateSpans(vitestCtx, testResourceAttrs)
				case rustCtx.HasTests():
					spans = rusttest.GenerateSpans(rustCtx, testResourceAttrs)
				}

				if spans != nil {
					if allTestTraces == nil {
						allTestTraces = spans
					} else {
						spans.ResourceSpans().MoveAndAppendTo(allTestTraces.ResourceSpans())
					}
				}
			}
		}
	}

	if allTestTraces != nil {
		c.logger.Debug("Generated test spans",
			zap.Int("span_count", allTestTraces.SpanCount()),
		)
		return c.tracesConsumer.ConsumeTraces(ctx, *allTestTraces)
	}

	return nil
}

// logRecord holds the relevant fields from a log record for test parsing.
type logRecord struct {
	body      string
	timestamp time.Time
	traceID   pcommon.TraceID
	spanID    pcommon.SpanID
}
