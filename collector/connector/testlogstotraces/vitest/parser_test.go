// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package vitest

import (
	"testing"
	"time"

	"github.com/everr-labs/everr/collector/connector/testlogstotraces/gotest"
	"github.com/everr-labs/everr/collector/semconv"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.uber.org/zap"
)

func TestParseVerboseOutput(t *testing.T) {
	logger := zap.NewNop()

	tests := []struct {
		name            string
		lines           []string
		expectedTests   int
		expectedPassed  int
		expectedFailed  int
		expectedSkipped int
	}{
		{
			name: "single passing test",
			lines: []string{
				" ✓ src/lib/formatting.test.ts > formatDuration > formats milliseconds 1ms",
			},
			expectedTests:  2, // 1 describe block + 1 test
			expectedPassed: 2,
		},
		{
			name: "single failing test",
			lines: []string{
				" × src/lib/formatting.test.ts > formatDuration > formats milliseconds 3ms",
			},
			expectedTests:  2,
			expectedFailed: 2,
		},
		{
			name: "single skipped test",
			lines: []string{
				" ↓ src/lib/formatting.test.ts > formatDuration > is skipped",
			},
			expectedTests:   2,
			expectedSkipped: 2,
		},
		{
			name: "multiple tests in same describe block",
			lines: []string{
				" ✓ src/lib/formatting.test.ts > formatDuration > formats milliseconds 1ms",
				" ✓ src/lib/formatting.test.ts > formatDuration > formats seconds 0ms",
				" × src/lib/formatting.test.ts > formatDuration > fails on negative 2ms",
			},
			expectedTests:  4, // 1 describe block + 3 tests
			expectedPassed: 2,
			expectedFailed: 2, // 1 test + 1 describe block (has a failing child)
		},
		{
			name: "tests across different files",
			lines: []string{
				" ✓ src/lib/formatting.test.ts > formatDuration > formats milliseconds 1ms",
				" ✓ src/lib/utils.test.ts > parseDate > parses ISO dates 2ms",
			},
			expectedTests:  4, // 2 describe blocks + 2 tests
			expectedPassed: 4,
		},
		{
			name: "file-level test (no describe block)",
			lines: []string{
				" ✓ src/lib/simple.test.ts > works correctly 1ms",
			},
			expectedTests:  1,
			expectedPassed: 1,
		},
		{
			name: "deeply nested test",
			lines: []string{
				" ✓ src/lib/formatting.test.ts > formatDuration > edge cases > handles zero 1ms",
			},
			expectedTests:  3, // 2 describe blocks + 1 test
			expectedPassed: 3,
		},
		{
			name: "ANSI codes stripped",
			lines: []string{
				" \x1b[32m✓\x1b[39m \x1b[2msrc/lib/formatting.test.ts > formatDuration > formats milliseconds\x1b[22m \x1b[2m1ms\x1b[22m",
			},
			expectedTests:  2,
			expectedPassed: 2,
		},
		{
			name: "no test output",
			lines: []string{
				"some random log line",
				"another log line",
				" RUN  v2.2.3 /Users/user/project",
			},
			expectedTests: 0,
		},
		{
			name: "mixed results",
			lines: []string{
				" ✓ src/test.ts > group > passes 1ms",
				" × src/test.ts > group > fails 2ms",
				" ↓ src/test.ts > group > skipped",
			},
			expectedTests:   4, // 1 describe block + 3 tests
			expectedPassed:  1,
			expectedFailed:  2, // 1 test + 1 describe block (has a failing child)
			expectedSkipped: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := gotest.NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
			parser := NewParser(ctx, logger)

			baseTime := time.Now()
			for i, line := range tt.lines {
				parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
			}
			parser.Finalize()

			assert.Equal(t, tt.expectedTests, ctx.TestCount(), "test count mismatch")

			passed, failed, skipped := countResults(ctx.RootTests)
			assert.Equal(t, tt.expectedPassed, passed, "passed count mismatch")
			assert.Equal(t, tt.expectedFailed, failed, "failed count mismatch")
			assert.Equal(t, tt.expectedSkipped, skipped, "skipped count mismatch")
		})
	}
}

func TestSubtestHierarchy(t *testing.T) {
	logger := zap.NewNop()
	ctx := gotest.NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
	parser := NewParser(ctx, logger)

	lines := []string{
		" ✓ src/lib/formatting.test.ts > formatDuration > formats milliseconds 1ms",
		" ✓ src/lib/formatting.test.ts > formatDuration > formats seconds 2ms",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	// Should have 1 root test (the describe block)
	require.Len(t, ctx.RootTests, 1, "should have 1 root test (describe block)")
	describeBlock := ctx.RootTests[0]
	assert.Equal(t, "src/lib/formatting.test.ts > formatDuration", describeBlock.Name)
	assert.Equal(t, "src/lib/formatting.test.ts", describeBlock.Package)
	assert.False(t, describeBlock.IsSubtest(), "describe block should not be a subtest")

	// Describe block should have 2 children
	require.Len(t, describeBlock.Subtests, 2, "describe block should have 2 subtests")

	child1 := describeBlock.Subtests[0]
	assert.Equal(t, "src/lib/formatting.test.ts > formatDuration > formats milliseconds", child1.Name)
	assert.Equal(t, "src/lib/formatting.test.ts > formatDuration", child1.ParentTest)
	assert.True(t, child1.IsSubtest())
	assert.Equal(t, gotest.TestResultPass, child1.Result)

	child2 := describeBlock.Subtests[1]
	assert.Equal(t, "src/lib/formatting.test.ts > formatDuration > formats seconds", child2.Name)
	assert.True(t, child2.IsSubtest())
}

func TestDeeplyNestedHierarchy(t *testing.T) {
	logger := zap.NewNop()
	ctx := gotest.NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
	parser := NewParser(ctx, logger)

	lines := []string{
		" ✓ src/test.ts > level1 > level2 > test name 1ms",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	// Root should be the first describe block
	require.Len(t, ctx.RootTests, 1)
	level1 := ctx.RootTests[0]
	assert.Equal(t, "src/test.ts > level1", level1.Name)

	require.Len(t, level1.Subtests, 1)
	level2 := level1.Subtests[0]
	assert.Equal(t, "src/test.ts > level1 > level2", level2.Name)
	assert.Equal(t, "src/test.ts > level1", level2.ParentTest)

	require.Len(t, level2.Subtests, 1)
	test := level2.Subtests[0]
	assert.Equal(t, "src/test.ts > level1 > level2 > test name", test.Name)
	assert.Equal(t, "src/test.ts > level1 > level2", test.ParentTest)
	assert.Equal(t, gotest.TestResultPass, test.Result)
}

func TestSpanGeneration(t *testing.T) {
	logger := zap.NewNop()
	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	stepSpanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	ctx := gotest.NewParseContext(123, 1, "test-job", 1, traceID, stepSpanID)
	parser := NewParser(ctx, logger)

	lines := []string{
		" ✓ src/lib/formatting.test.ts > formatDuration > formats milliseconds 1ms",
		" × src/lib/formatting.test.ts > formatDuration > fails on negative 3ms",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	resourceAttrs := pcommon.NewMap()
	resourceAttrs.PutInt("ci.pipeline.run.id", 123)
	traces := GenerateSpans(ctx, resourceAttrs)
	require.NotNil(t, traces)
	assert.Equal(t, 3, traces.SpanCount()) // 1 describe block + 2 tests

	// Verify span structure
	resourceSpans := traces.ResourceSpans()
	require.Equal(t, 1, resourceSpans.Len())

	scopeSpans := resourceSpans.At(0).ScopeSpans()
	require.Equal(t, 1, scopeSpans.Len())
	assert.Equal(t, "vitest", scopeSpans.At(0).Scope().Name())

	spans := scopeSpans.At(0).Spans()

	// Find spans by name
	spanMap := make(map[string]ptrace.Span)
	for i := 0; i < spans.Len(); i++ {
		span := spans.At(i)
		spanMap[span.Name()] = span
	}

	// The describe block span should be named "formatDuration" (last segment)
	describeSpan, ok := spanMap["formatDuration"]
	require.True(t, ok, "formatDuration span not found, got: %v", spanNames(spans))
	assert.Equal(t, traceID, describeSpan.TraceID())
	assert.Equal(t, stepSpanID, describeSpan.ParentSpanID())

	// The pass span
	passSpan, ok := spanMap["formats milliseconds"]
	require.True(t, ok, "formats milliseconds span not found")
	assert.Equal(t, ptrace.StatusCodeUnset, passSpan.Status().Code())
	assert.Equal(t, describeSpan.SpanID(), passSpan.ParentSpanID())

	// Verify framework attribute
	framework, ok := passSpan.Attributes().Get(semconv.EverrTestFramework)
	require.True(t, ok)
	assert.Equal(t, "vitest", framework.Str())

	// The fail span
	failSpan, ok := spanMap["fails on negative"]
	require.True(t, ok, "fails on negative span not found")
	assert.Equal(t, ptrace.StatusCodeError, failSpan.Status().Code())
}

func TestSpanGenerationFileLevelTest(t *testing.T) {
	logger := zap.NewNop()
	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	stepSpanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	ctx := gotest.NewParseContext(123, 1, "test-job", 1, traceID, stepSpanID)
	parser := NewParser(ctx, logger)

	// File-level test (only file > test, no describe block)
	lines := []string{
		" ✓ src/simple.test.ts > works 1ms",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	resourceAttrs := pcommon.NewMap()
	traces := GenerateSpans(ctx, resourceAttrs)
	require.NotNil(t, traces)
	assert.Equal(t, 1, traces.SpanCount())

	span := traces.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0)
	assert.Equal(t, "works", span.Name())
	assert.Equal(t, stepSpanID, span.ParentSpanID())

	// Verify package attribute
	pkg, ok := span.Attributes().Get(semconv.EverrTestPackage)
	require.True(t, ok)
	assert.Equal(t, "src/simple.test.ts", pkg.Str())
}

func TestNoTestsGeneratesNilSpans(t *testing.T) {
	ctx := gotest.NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
	parser := NewParser(ctx, zap.NewNop())

	parser.ProcessLine("some random log output", time.Now())
	parser.Finalize()

	resourceAttrs := pcommon.NewMap()
	traces := GenerateSpans(ctx, resourceAttrs)
	assert.Nil(t, traces)
}

func TestSplitTestName(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{
			"src/lib/formatting.test.ts > formatDuration > formats milliseconds",
			[]string{"src/lib/formatting.test.ts", "formatDuration", "formats milliseconds"},
		},
		{
			"src/simple.test.ts > works",
			[]string{"src/simple.test.ts", "works"},
		},
		{
			"src/test.ts > level1 > level2 > level3 > test",
			[]string{"src/test.ts", "level1", "level2", "level3", "test"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := splitTestName(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestUniqueSpanIDs(t *testing.T) {
	logger := zap.NewNop()

	lines := []string{
		" ✓ src/test.ts > group > test name 1ms",
	}

	ctx := gotest.NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
	parser := NewParser(ctx, logger)
	for _, line := range lines {
		parser.ProcessLine(line, time.Now())
	}
	parser.Finalize()

	// All span IDs should be non-empty
	require.Len(t, ctx.RootTests, 1)
	assert.NotEqual(t, pcommon.SpanID{}, ctx.RootTests[0].SpanID, "describe block span ID should not be empty")

	require.Len(t, ctx.RootTests[0].Subtests, 1)
	assert.NotEqual(t, pcommon.SpanID{}, ctx.RootTests[0].Subtests[0].SpanID, "test span ID should not be empty")

	// Describe block and test should have different span IDs
	assert.NotEqual(t, ctx.RootTests[0].SpanID, ctx.RootTests[0].Subtests[0].SpanID, "span IDs should be unique")
}

func TestResultPropagation(t *testing.T) {
	logger := zap.NewNop()
	ctx := gotest.NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
	parser := NewParser(ctx, logger)

	// One passing, one failing in the same describe block
	lines := []string{
		" ✓ src/test.ts > group > passes 1ms",
		" × src/test.ts > group > fails 2ms",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	// The describe block should be marked as failed since one child failed
	require.Len(t, ctx.RootTests, 1)
	assert.Equal(t, gotest.TestResultFail, ctx.RootTests[0].Result)
}

func TestAllSkippedPropagation(t *testing.T) {
	logger := zap.NewNop()
	ctx := gotest.NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
	parser := NewParser(ctx, logger)

	lines := []string{
		" ↓ src/test.ts > group > skip1",
		" ↓ src/test.ts > group > skip2",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	// The describe block should be marked as skipped since all children are skipped
	require.Len(t, ctx.RootTests, 1)
	assert.Equal(t, gotest.TestResultSkip, ctx.RootTests[0].Result)
}

// Helper functions

func countResults(tests []*gotest.TestInfo) (passed, failed, skipped int) {
	for _, test := range tests {
		switch test.Result {
		case gotest.TestResultPass:
			passed++
		case gotest.TestResultFail:
			failed++
		case gotest.TestResultSkip:
			skipped++
		}
		p, f, s := countResults(test.Subtests)
		passed += p
		failed += f
		skipped += s
	}
	return
}

func spanNames(spans ptrace.SpanSlice) []string {
	names := make([]string, spans.Len())
	for i := 0; i < spans.Len(); i++ {
		names[i] = spans.At(i).Name()
	}
	return names
}
