// Copyright The OpenTelemetry Authors
// Copyright 2026 Giordano Ricci (operating as "Everr Labs")
// SPDX-License-Identifier: Apache-2.0
//
// This file has been modified from its original version.

package githubactionsreceiver

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/everr-labs/everr/collector/receiver/githubactionsreceiver/internal/metadata"
	"github.com/everr-labs/everr/collector/semconv"
	"github.com/google/go-github/v67/github"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/config/confighttp"
	"go.opentelemetry.io/collector/config/confignet"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/consumer/consumertest"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/collector/receiver/receivertest"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest"
)

func int64Ptr(v int64) *int64 {
	return &v
}

func intPtr(v int) *int {
	return &v
}

func TestNewReceiver(t *testing.T) {
	defaultConfig := createDefaultConfig().(*Config)

	tests := []struct {
		desc     string
		config   Config
		consumer consumer.Logs
		err      error
	}{
		{
			desc:     "Default config succeeds",
			config:   *defaultConfig,
			consumer: consumertest.NewNop(),
			err:      nil,
		},
		{
			desc: "User defined config success",
			config: Config{
				ServerConfig: confighttp.ServerConfig{
					NetAddr: confignet.AddrConfig{
						Endpoint: "localhost:8080",
					},
				},
				Secret: "mysecret",
			},
			consumer: consumertest.NewNop(),
		},
	}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			rec, err := newReceiver(receivertest.NewNopSettings(metadata.Type), &test.config)
			if test.err == nil {
				require.NotNil(t, rec)
				require.NoError(t, rec.Shutdown(context.Background()))
			} else {
				require.ErrorIs(t, err, test.err)
				require.Nil(t, rec)
			}
		})
	}
}

func TestInstallationIDFromWebhookEvent(t *testing.T) {
	t.Run("WorkflowRunEvent", func(t *testing.T) {
		id, err := installationIDFromWebhookEvent(&github.WorkflowRunEvent{
			Installation: &github.Installation{ID: int64Ptr(12345)},
		})
		require.NoError(t, err)
		require.Equal(t, int64(12345), id)
	})

	t.Run("WorkflowJobEvent", func(t *testing.T) {
		id, err := installationIDFromWebhookEvent(&github.WorkflowJobEvent{
			Installation: &github.Installation{ID: int64Ptr(67890)},
		})
		require.NoError(t, err)
		require.Equal(t, int64(67890), id)
	})

	t.Run("Missing installation", func(t *testing.T) {
		_, err := installationIDFromWebhookEvent(&github.WorkflowRunEvent{})
		require.ErrorIs(t, err, errMissingInstallationIDFromEvent)
	})
}

func TestEventToTracesTraces(t *testing.T) {
	tests := []struct {
		desc            string
		payloadFilePath string
		eventType       string
		expectedError   error
		expectedSpans   int
	}{
		{
			desc:            "WorkflowJobEvent processing",
			payloadFilePath: "./testdata/completed/5_workflow_job_completed.json",
			eventType:       "workflow_job",
			expectedError:   nil,
			expectedSpans:   10, // 10 spans in the payload
		},
		{
			desc:            "WorkflowRunEvent processing",
			payloadFilePath: "./testdata/completed/8_workflow_run_completed.json",
			eventType:       "workflow_run",
			expectedError:   nil,
			expectedSpans:   1, // Root span
		},
	}

	logger := zaptest.NewLogger(t)
	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			payload, err := os.ReadFile(test.payloadFilePath)
			require.NoError(t, err)

			event, err := github.ParseWebHook(test.eventType, payload)
			require.NoError(t, err)

			traces, err := eventToTraces(event, &Config{}, logger)

			if test.expectedError != nil {
				require.Error(t, err)
				require.Equal(t, test.expectedError, err)
			} else {
				require.NoError(t, err)
			}

			require.Equal(t, test.expectedSpans, traces.SpanCount(), fmt.Sprintf("%s: unexpected number of spans", test.desc))
		})
	}
}

func TestProcessSteps(t *testing.T) {
	tests := []struct {
		desc             string
		givenSteps       []*github.TaskStep
		expectedSpans    int
		expectedStatuses []ptrace.StatusCode
	}{
		{
			desc: "Multiple steps with mixed status",

			givenSteps: []*github.TaskStep{
				{Name: getPtr("Checkout"), Status: getPtr("completed"), Conclusion: getPtr("success")},
				{Name: getPtr("Build"), Status: getPtr("completed"), Conclusion: getPtr("failure")},
				{Name: getPtr("Test"), Status: getPtr("completed"), Conclusion: getPtr("success")},
			},
			expectedSpans: 4, // Includes parent span
			expectedStatuses: []ptrace.StatusCode{
				ptrace.StatusCodeOk,
				ptrace.StatusCodeError,
				ptrace.StatusCodeOk,
			},
		},
		{
			desc:             "No steps",
			givenSteps:       []*github.TaskStep{},
			expectedSpans:    1, // Only the parent span should be created
			expectedStatuses: nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			logger := zap.NewNop()
			traces := ptrace.NewTraces()
			rs := traces.ResourceSpans().AppendEmpty()
			ss := rs.ScopeSpans().AppendEmpty()

			traceID, _ := generateTraceID(456, 123, 1)
			parentSpanID, err := createParentSpan(ss, &github.WorkflowJob{}, traceID, logger)
			require.NoError(t, err)

			processSteps(ss, tc.givenSteps, &github.WorkflowJob{}, traceID, parentSpanID, logger)

			startIdx := 1 // Skip the parent span if it's the first one
			if len(tc.expectedStatuses) == 0 {
				startIdx = 0 // No steps, only the parent span exists
			}

			require.Equal(t, tc.expectedSpans, ss.Spans().Len(), "Unexpected number of spans")
			for i, expectedStatusCode := range tc.expectedStatuses {
				span := ss.Spans().At(i + startIdx)
				statusCode := span.Status().Code()
				require.Equal(t, expectedStatusCode, statusCode, fmt.Sprintf("Unexpected status code for span #%d", i+startIdx))
			}
		})
	}
}

func TestResourceAndSpanAttributesCreation(t *testing.T) {
	tests := []struct {
		desc            string
		payloadFilePath string
		expectedSteps   []map[string]string
	}{
		{
			desc:            "WorkflowJobEvent Step Attributes",
			payloadFilePath: "./testdata/completed/5_workflow_job_completed.json",
			expectedSteps: []map[string]string{
				{string(conventions.CICDPipelineTaskNameKey): "Set up job", semconv.EverrGitHubWorkflowJobStepNumber: "1"},
				{string(conventions.CICDPipelineTaskNameKey): "Run actions/checkout@v3", semconv.EverrGitHubWorkflowJobStepNumber: "2"},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			logger := zaptest.NewLogger(t)

			payload, err := os.ReadFile(tc.payloadFilePath)
			require.NoError(t, err)

			event, err := github.ParseWebHook("workflow_job", payload)
			require.NoError(t, err)

			traces, err := eventToTraces(event, &Config{}, logger)
			require.NoError(t, err)

			rs := traces.ResourceSpans().At(0)
			ss := rs.ScopeSpans().At(0)

			for _, expectedStep := range tc.expectedSteps {
				stepFound := false

				for i := 0; i < ss.Spans().Len() && !stepFound; i++ {
					span := ss.Spans().At(i)
					attrs := span.Attributes()

					stepValue, found := attrs.Get(string(conventions.CICDPipelineTaskNameKey))
					stepName := stepValue.Str()

					if !found || stepName == "" { // Skip if the attribute is not found or name is empty
						continue
					}

					expectedStepName := expectedStep[string(conventions.CICDPipelineTaskNameKey)]

					if stepName == expectedStepName {
						stepFound = true
						for attrKey, expectedValue := range expectedStep {
							attrValue, found := attrs.Get(attrKey)
							if !found {
								require.Fail(t, fmt.Sprintf("Attribute '%s' not found in span for step '%s'", attrKey, stepName))
								continue
							}
							actualValue := attributeValueToString(attrValue)
							require.Equal(t, expectedValue, actualValue, "Attribute '%s' does not match expected value for step '%s'", attrKey, stepName)
						}
					}
				}

				require.True(t, stepFound, "Step '%s' not found in any span", expectedStep[string(conventions.CICDPipelineTaskNameKey)])
			}

		})
	}
}

// attributeValueToString converts an attribute value to a string regardless of its actual type
func attributeValueToString(attr pcommon.Value) string {
	switch attr.Type() {
	case pcommon.ValueTypeStr:
		return attr.Str()
	case pcommon.ValueTypeInt:
		return strconv.FormatInt(attr.Int(), 10)
	case pcommon.ValueTypeDouble:
		return strconv.FormatFloat(attr.Double(), 'f', -1, 64)
	case pcommon.ValueTypeBool:
		return strconv.FormatBool(attr.Bool())
	case pcommon.ValueTypeMap:
		return "<Map Value>"
	case pcommon.ValueTypeSlice:
		return "<Slice Value>"
	default:
		return "<Unknown Value Type>"
	}
}

func TestCorrectActionTimestamps(t *testing.T) {
	real1 := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	real2 := time.Date(2024, 1, 1, 13, 0, 0, 0, time.UTC)
	zero := time.Time{}

	tests := []struct {
		desc          string
		start, end    time.Time
		wantStart     time.Time
		wantEnd       time.Time
		wantZeroDelta bool
	}{
		{desc: "both valid", start: real1, end: real2, wantStart: real1, wantEnd: real2},
		{desc: "both zero", start: zero, end: zero, wantStart: zero, wantEnd: zero, wantZeroDelta: true},
		{desc: "start zero, end real", start: zero, end: real2, wantStart: real2, wantEnd: real2, wantZeroDelta: true},
		{desc: "start real, end zero", start: real1, end: zero, wantStart: real1, wantEnd: real1, wantZeroDelta: true},
		{desc: "end before start (reversed)", start: real2, end: real1, wantStart: real2, wantEnd: real2, wantZeroDelta: true},
	}

	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			gotStart, gotEnd := correctActionTimestamps(tc.start, tc.end)
			require.Equal(t, tc.wantStart, gotStart, "start mismatch")
			require.Equal(t, tc.wantEnd, gotEnd, "end mismatch")
			if tc.wantZeroDelta {
				require.Equal(t, gotStart, gotEnd, "expected zero-duration span")
			}
		})
	}
}

func TestCreateParentSpanZeroTimestamps(t *testing.T) {
	logger := zap.NewNop()

	tests := []struct {
		desc string
		job  *github.WorkflowJob
	}{
		{
			desc: "Both started_at and completed_at zero (skipped job)",
			job:  &github.WorkflowJob{},
		},
		{
			desc: "started_at set, completed_at zero",
			job: &github.WorkflowJob{
				StartedAt: &github.Timestamp{Time: time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)},
			},
		},
		{
			desc: "started_at zero, completed_at set (cancelled before starting)",
			job: &github.WorkflowJob{
				CompletedAt: &github.Timestamp{Time: time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			traces := ptrace.NewTraces()
			rs := traces.ResourceSpans().AppendEmpty()
			ss := rs.ScopeSpans().AppendEmpty()

			traceID, _ := generateTraceID(456, 123, 1)
			_, err := createParentSpan(ss, tc.job, traceID, logger)
			require.NoError(t, err)

			span := ss.Spans().At(0)
			start := span.StartTimestamp()
			end := span.EndTimestamp()
			duration := uint64(end) - uint64(start)

			// Duration must never exceed 24 hours — the uint64 underflow produces ~10^19
			require.LessOrEqual(t, duration, uint64(86400000000000),
				"Duration overflowed: got %d ns, likely a uint64 underflow from zero timestamps", duration)
		})
	}
}

func TestCreateRootSpanZeroTimestamps(t *testing.T) {
	logger := zap.NewNop()

	tests := []struct {
		desc  string
		event *github.WorkflowRunEvent
	}{
		{
			desc: "updated_at zero",
			event: &github.WorkflowRunEvent{
				WorkflowRun: &github.WorkflowRun{
					ID:           int64Ptr(123),
					RunAttempt:   intPtr(1),
					RunStartedAt: &github.Timestamp{Time: time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)},
				},
				Repo: &github.Repository{ID: int64Ptr(456)},
			},
		},
		{
			desc: "run_started_at zero",
			event: &github.WorkflowRunEvent{
				WorkflowRun: &github.WorkflowRun{
					ID:         int64Ptr(123),
					RunAttempt: intPtr(1),
					UpdatedAt:  &github.Timestamp{Time: time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)},
				},
				Repo: &github.Repository{ID: int64Ptr(456)},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.desc, func(t *testing.T) {
			traces := ptrace.NewTraces()
			rs := traces.ResourceSpans().AppendEmpty()

			traceID, _ := generateTraceID(456, 123, 1)
			_, err := createRootSpan(rs, tc.event, traceID, logger)
			require.NoError(t, err)

			ss := rs.ScopeSpans().At(0)
			span := ss.Spans().At(0)
			start := span.StartTimestamp()
			end := span.EndTimestamp()
			duration := uint64(end) - uint64(start)

			require.LessOrEqual(t, duration, uint64(86400000000000),
				"Duration overflowed: got %d ns, likely a uint64 underflow from zero timestamps", duration)
		})
	}
}

func getPtr(str string) *string {
	return &str
}
