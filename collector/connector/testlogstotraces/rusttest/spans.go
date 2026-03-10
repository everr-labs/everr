// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package rusttest

import (
	"strings"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"

	"github.com/everr-labs/everr/collector/connector/testlogstotraces/gotest"
	"github.com/everr-labs/everr/collector/semconv"
)

// GenerateSpans creates OpenTelemetry spans from parsed Rust test results.
// Returns a ptrace.Traces containing all test spans, or nil if no tests were detected.
func GenerateSpans(ctx *gotest.TestParseContext, resourceAttrs pcommon.Map) *ptrace.Traces {
	if !ctx.HasTests() {
		return nil
	}

	traces := ptrace.NewTraces()
	resourceSpans := traces.ResourceSpans().AppendEmpty()

	resourceAttrs.CopyTo(resourceSpans.Resource().Attributes())

	scopeSpans := resourceSpans.ScopeSpans().AppendEmpty()
	scopeSpans.Scope().SetName("rusttest")

	for _, test := range ctx.RootTests {
		createTestSpan(ctx, scopeSpans, test, ctx.StepSpanID)
	}

	return &traces
}

func createTestSpan(ctx *gotest.TestParseContext, scopeSpans ptrace.ScopeSpans, test *gotest.TestInfo, parentSpanID pcommon.SpanID) {
	span := scopeSpans.Spans().AppendEmpty()

	span.SetTraceID(ctx.TraceID)
	span.SetParentSpanID(parentSpanID)
	span.SetSpanID(test.SpanID)

	spanName := test.Name
	if idx := strings.LastIndex(spanName, "::"); idx >= 0 {
		spanName = spanName[idx+2:]
	}
	span.SetName(spanName)
	span.SetKind(ptrace.SpanKindInternal)

	span.SetStartTimestamp(pcommon.NewTimestampFromTime(test.StartTime))
	if !test.EndTime.IsZero() {
		span.SetEndTimestamp(pcommon.NewTimestampFromTime(test.EndTime))
	} else {
		span.SetEndTimestamp(pcommon.NewTimestampFromTime(test.StartTime))
	}

	if test.Result == gotest.TestResultFail {
		span.Status().SetCode(ptrace.StatusCodeError)
	}

	attrs := span.Attributes()
	attrs.PutStr(semconv.EverrTestName, test.Name)
	attrs.PutStr(semconv.EverrTestResult, string(test.Result))
	attrs.PutDouble(semconv.EverrTestDurationSeconds, test.Duration.Seconds())
	attrs.PutStr(semconv.EverrTestFramework, "rust")
	attrs.PutBool(semconv.EverrTestIsSubtest, test.IsSubtest())
	attrs.PutBool(semconv.EverrTestIsSuite, test.IsSuite())

	if test.Package != "" {
		attrs.PutStr(semconv.EverrTestPackage, test.Package)
	}

	if test.ParentTest != "" {
		attrs.PutStr(semconv.EverrTestParentTest, test.ParentTest)
	}

	for _, subtest := range test.Subtests {
		createTestSpan(ctx, scopeSpans, subtest, test.SpanID)
	}
}
