package vitest

import (
	"path/filepath"
	"strings"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"

	"github.com/everr-labs/everr/collector/connector/testlogstotraces/gotest"
	"github.com/everr-labs/everr/collector/semconv"
)

const (
	testFramework      = "vitest"
	javascriptLanguage = "javascript"
	typescriptLanguage = "typescript"
)

// GenerateSpans creates OpenTelemetry spans from parsed Vitest test results.
// Returns a ptrace.Traces containing all test spans, or nil if no tests were detected.
func GenerateSpans(ctx *gotest.TestParseContext, resourceAttrs pcommon.Map) *ptrace.Traces {
	if !ctx.HasTests() {
		return nil
	}

	traces := ptrace.NewTraces()
	resourceSpans := traces.ResourceSpans().AppendEmpty()

	// Copy resource attributes from the parent traces
	traceResourceAttrs := resourceSpans.Resource().Attributes()
	resourceAttrs.CopyTo(traceResourceAttrs)
	traceResourceAttrs.PutStr(semconv.EverrTestFramework, testFramework)
	traceResourceAttrs.PutStr(semconv.EverrTestLanguage, detectTraceLanguage(ctx.RootTests))

	scopeSpans := resourceSpans.ScopeSpans().AppendEmpty()
	scopeSpans.Scope().SetName("vitest")

	// Create spans for all root tests (subtests are created recursively)
	for _, test := range ctx.RootTests {
		createTestSpan(ctx, scopeSpans, test, ctx.StepSpanID)
	}

	return &traces
}

// createTestSpan creates a span for a single test and recursively creates spans for subtests.
func createTestSpan(ctx *gotest.TestParseContext, scopeSpans ptrace.ScopeSpans, test *gotest.TestInfo, parentSpanID pcommon.SpanID) {
	span := scopeSpans.Spans().AppendEmpty()

	// Set identifiers
	span.SetTraceID(ctx.TraceID)
	span.SetParentSpanID(parentSpanID)
	span.SetSpanID(test.SpanID)

	// Set name — use the last segment of the " > " hierarchy for the span name
	// since the hierarchy is already expressed through the span tree
	spanName := test.Name
	if idx := strings.LastIndex(spanName, " > "); idx >= 0 {
		spanName = spanName[idx+3:]
	}
	span.SetName(spanName)
	span.SetKind(ptrace.SpanKindInternal)

	// Set timestamps
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(test.StartTime))
	if !test.EndTime.IsZero() {
		span.SetEndTimestamp(pcommon.NewTimestampFromTime(test.EndTime))
	} else {
		span.SetEndTimestamp(pcommon.NewTimestampFromTime(test.StartTime))
	}

	// Set status — only mark failures as errors; all other outcomes stay Unset.
	// The test outcome is carried by the everr.test.result attribute.
	if test.Result == gotest.TestResultFail {
		span.Status().SetCode(ptrace.StatusCodeError)
	}

	// Set attributes
	attrs := span.Attributes()
	attrs.PutStr(semconv.EverrTestName, test.Name)
	attrs.PutStr(semconv.EverrTestResult, string(test.Result))
	attrs.PutDouble(semconv.EverrTestDurationSeconds, test.Duration.Seconds())
	attrs.PutStr(semconv.EverrTestFramework, testFramework)
	attrs.PutStr(semconv.EverrTestLanguage, detectTestLanguage(test.Package))
	attrs.PutBool(semconv.EverrTestIsSubtest, test.IsSubtest())
	attrs.PutBool(semconv.EverrTestIsSuite, test.IsSuite())

	if test.Package != "" {
		attrs.PutStr(semconv.EverrTestPackage, test.Package)
	}

	if test.ParentTest != "" {
		attrs.PutStr(semconv.EverrTestParentTest, test.ParentTest)
	}

	// Recursively create spans for subtests
	for _, subtest := range test.Subtests {
		createTestSpan(ctx, scopeSpans, subtest, test.SpanID)
	}
}

func detectTraceLanguage(tests []*gotest.TestInfo) string {
	hasJavaScript := false
	hasTypeScript := false

	var visit func([]*gotest.TestInfo)
	visit = func(tests []*gotest.TestInfo) {
		for _, test := range tests {
			if detectTestLanguage(test.Package) == javascriptLanguage {
				hasJavaScript = true
			} else {
				hasTypeScript = true
			}

			visit(test.Subtests)
		}
	}

	visit(tests)
	if hasJavaScript && !hasTypeScript {
		return javascriptLanguage
	}

	return typescriptLanguage
}

func detectTestLanguage(testFile string) string {
	switch strings.ToLower(filepath.Ext(testFile)) {
	case ".js", ".jsx", ".mjs", ".cjs":
		return javascriptLanguage
	default:
		return typescriptLanguage
	}
}
