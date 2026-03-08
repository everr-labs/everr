// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package gotest

import (
	"strings"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"

	"github.com/everr-labs/everr/collector/semconv"
)

// GenerateSpans creates OpenTelemetry spans from parsed test results.
// Returns a ptrace.Traces containing all test spans, or nil if no tests were detected.
// The resourceAttrs parameter provides resource-level attributes to copy to the test traces.
func (ctx *TestParseContext) GenerateSpans(resourceAttrs pcommon.Map) *ptrace.Traces {
	if !ctx.HasTests() {
		return nil
	}

	traces := ptrace.NewTraces()
	resourceSpans := traces.ResourceSpans().AppendEmpty()

	// Copy resource attributes from the parent traces
	resourceAttrs.CopyTo(resourceSpans.Resource().Attributes())

	scopeSpans := resourceSpans.ScopeSpans().AppendEmpty()
	scopeSpans.Scope().SetName("gotest")

	// Create spans for all root tests (subtests are created recursively)
	for _, test := range ctx.RootTests {
		ctx.createTestSpan(scopeSpans, test, ctx.StepSpanID)
	}

	return &traces
}

// createTestSpan creates a span for a single test and recursively creates spans for subtests.
func (ctx *TestParseContext) createTestSpan(scopeSpans ptrace.ScopeSpans, test *TestInfo, parentSpanID pcommon.SpanID) {
	span := scopeSpans.Spans().AppendEmpty()

	// Set identifiers
	span.SetTraceID(ctx.TraceID)
	span.SetParentSpanID(parentSpanID)
	span.SetSpanID(test.SpanID)

	// Set name and kind — for subtests, strip the parent prefix since
	// the hierarchy is already expressed through the span tree
	spanName := test.Name
	if idx := strings.LastIndex(spanName, "/"); idx >= 0 {
		spanName = spanName[idx+1:]
	}
	span.SetName(spanName)
	span.SetKind(ptrace.SpanKindInternal)

	// Set timestamps
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(test.StartTime))
	if !test.EndTime.IsZero() {
		span.SetEndTimestamp(pcommon.NewTimestampFromTime(test.EndTime))
	} else {
		// For incomplete tests, use start time as end time
		span.SetEndTimestamp(pcommon.NewTimestampFromTime(test.StartTime))
	}

	// Set status — only mark failures as errors; all other outcomes stay Unset.
	// The test outcome is carried by the everr.test.result attribute.
	if test.Result == TestResultFail {
		span.Status().SetCode(ptrace.StatusCodeError)
	}

	// Set attributes
	attrs := span.Attributes()
	attrs.PutStr(semconv.EverrTestName, test.Name)
	attrs.PutStr(semconv.EverrTestResult, string(test.Result))
	attrs.PutDouble(semconv.EverrTestDurationSeconds, test.Duration.Seconds())
	attrs.PutStr(semconv.EverrTestFramework, "go")
	attrs.PutBool(semconv.EverrTestIsSubtest, test.IsSubtest())

	if test.Package != "" {
		attrs.PutStr(semconv.EverrTestPackage, test.Package)
	}

	if test.ParentTest != "" {
		attrs.PutStr(semconv.EverrTestParentTest, test.ParentTest)
	}

	// Recursively create spans for subtests
	for _, subtest := range test.Subtests {
		ctx.createTestSpan(scopeSpans, subtest, test.SpanID)
	}
}
