// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package gotest

import (
	"testing"
	"time"

	"github.com/get-citric/citric/collector/semconv"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
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
				"=== RUN   TestFoo",
				"--- PASS: TestFoo (0.001s)",
			},
			expectedTests:  1,
			expectedPassed: 1,
		},
		{
			name: "single failing test",
			lines: []string{
				"=== RUN   TestBar",
				"    bar_test.go:10: assertion failed",
				"--- FAIL: TestBar (0.002s)",
			},
			expectedTests:  1,
			expectedFailed: 1,
		},
		{
			name: "single skipped test",
			lines: []string{
				"=== RUN   TestSkipped",
				"--- SKIP: TestSkipped (0.000s)",
			},
			expectedTests:   1,
			expectedSkipped: 1,
		},
		{
			name: "multiple tests",
			lines: []string{
				"=== RUN   TestOne",
				"--- PASS: TestOne (0.001s)",
				"=== RUN   TestTwo",
				"--- FAIL: TestTwo (0.002s)",
				"=== RUN   TestThree",
				"--- SKIP: TestThree (0.000s)",
			},
			expectedTests:   3,
			expectedPassed:  1,
			expectedFailed:  1,
			expectedSkipped: 1,
		},
		{
			name: "nested subtests",
			lines: []string{
				"=== RUN   TestParent",
				"=== RUN   TestParent/SubTest1",
				"    --- PASS: TestParent/SubTest1 (0.001s)",
				"=== RUN   TestParent/SubTest2",
				"    --- PASS: TestParent/SubTest2 (0.002s)",
				"--- PASS: TestParent (0.005s)",
			},
			expectedTests:  3, // 1 parent + 2 subtests
			expectedPassed: 3,
		},
		{
			name: "deeply nested subtests",
			lines: []string{
				"=== RUN   TestRoot",
				"=== RUN   TestRoot/Level1",
				"=== RUN   TestRoot/Level1/Level2",
				"        --- PASS: TestRoot/Level1/Level2 (0.001s)",
				"    --- PASS: TestRoot/Level1 (0.002s)",
				"--- PASS: TestRoot (0.003s)",
			},
			expectedTests:  3,
			expectedPassed: 3,
		},
		{
			name: "no test output",
			lines: []string{
				"some random log line",
				"another log line",
			},
			expectedTests: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
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
	ctx := NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
	parser := NewParser(ctx, logger)

	lines := []string{
		"=== RUN   TestParent",
		"=== RUN   TestParent/Child1",
		"    --- PASS: TestParent/Child1 (0.001s)",
		"=== RUN   TestParent/Child2",
		"    --- PASS: TestParent/Child2 (0.002s)",
		"--- PASS: TestParent (0.005s)",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	require.Len(t, ctx.RootTests, 1, "should have 1 root test")
	parent := ctx.RootTests[0]
	assert.Equal(t, "TestParent", parent.Name)
	assert.False(t, parent.IsSubtest())
	require.Len(t, parent.Subtests, 2, "parent should have 2 subtests")

	child1 := parent.Subtests[0]
	assert.Equal(t, "TestParent/Child1", child1.Name)
	assert.Equal(t, "TestParent", child1.ParentTest)
	assert.True(t, child1.IsSubtest())

	child2 := parent.Subtests[1]
	assert.Equal(t, "TestParent/Child2", child2.Name)
	assert.Equal(t, "TestParent", child2.ParentTest)
	assert.True(t, child2.IsSubtest())
}

func TestSpanGeneration(t *testing.T) {
	logger := zap.NewNop()
	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	stepSpanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	ctx := NewParseContext(123, 1, "test-job", 1, traceID, stepSpanID)
	parser := NewParser(ctx, logger)

	lines := []string{
		"=== RUN   TestFoo",
		"--- PASS: TestFoo (0.100s)",
		"=== RUN   TestBar",
		"--- FAIL: TestBar (0.200s)",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	resourceAttrs := pcommon.NewMap()
	resourceAttrs.PutInt(string(conventions.CICDPipelineRunIDKey), 123)
	traces := ctx.GenerateSpans(resourceAttrs)
	require.NotNil(t, traces)
	assert.Equal(t, 2, traces.SpanCount())

	// Verify span structure
	resourceSpans := traces.ResourceSpans()
	require.Equal(t, 1, resourceSpans.Len())

	scopeSpans := resourceSpans.At(0).ScopeSpans()
	require.Equal(t, 1, scopeSpans.Len())

	spans := scopeSpans.At(0).Spans()
	require.Equal(t, 2, spans.Len())

	// Find spans by name
	var fooSpan, barSpan ptrace.Span
	for i := 0; i < spans.Len(); i++ {
		span := spans.At(i)
		switch span.Name() {
		case "TestFoo":
			fooSpan = span
		case "TestBar":
			barSpan = span
		}
	}

	// Verify TestFoo span
	require.NotEqual(t, ptrace.Span{}, fooSpan, "TestFoo span not found")
	assert.Equal(t, traceID, fooSpan.TraceID())
	assert.Equal(t, stepSpanID, fooSpan.ParentSpanID())
	assert.Equal(t, ptrace.StatusCodeUnset, fooSpan.Status().Code())

	// Verify attributes
	fooAttrs := fooSpan.Attributes()
	testName, ok := fooAttrs.Get(semconv.CitricTestName)
	require.True(t, ok)
	assert.Equal(t, "TestFoo", testName.Str())

	result, ok := fooAttrs.Get(semconv.CitricTestResult)
	require.True(t, ok)
	assert.Equal(t, "pass", result.Str())

	framework, ok := fooAttrs.Get(semconv.CitricTestFramework)
	require.True(t, ok)
	assert.Equal(t, "go", framework.Str())

	// Verify TestBar span (failed)
	require.NotEqual(t, ptrace.Span{}, barSpan, "TestBar span not found")
	assert.Equal(t, ptrace.StatusCodeError, barSpan.Status().Code())
}

func TestSpanGenerationWithSubtests(t *testing.T) {
	logger := zap.NewNop()
	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	stepSpanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	ctx := NewParseContext(123, 1, "test-job", 1, traceID, stepSpanID)
	parser := NewParser(ctx, logger)

	lines := []string{
		"=== RUN   TestParent",
		"=== RUN   TestParent/Child",
		"    --- PASS: TestParent/Child (0.001s)",
		"--- PASS: TestParent (0.002s)",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	resourceAttrs := pcommon.NewMap()
	resourceAttrs.PutInt(string(conventions.CICDPipelineRunIDKey), 123)
	traces := ctx.GenerateSpans(resourceAttrs)
	require.NotNil(t, traces)
	assert.Equal(t, 2, traces.SpanCount())

	// Verify parent-child relationship
	spans := traces.ResourceSpans().At(0).ScopeSpans().At(0).Spans()

	var parentSpan, childSpan ptrace.Span
	for i := 0; i < spans.Len(); i++ {
		span := spans.At(i)
		switch span.Name() {
		case "TestParent":
			parentSpan = span
		case "Child":
			childSpan = span
		}
	}

	require.NotEqual(t, ptrace.Span{}, parentSpan)
	require.NotEqual(t, ptrace.Span{}, childSpan)

	// Parent's parent should be step span
	assert.Equal(t, stepSpanID, parentSpan.ParentSpanID())

	// Child's parent should be parent test span
	assert.Equal(t, parentSpan.SpanID(), childSpan.ParentSpanID())

	// Verify is_subtest attribute
	isSubtest, ok := childSpan.Attributes().Get(semconv.CitricTestIsSubtest)
	require.True(t, ok)
	assert.True(t, isSubtest.Bool())

	isSubtest, ok = parentSpan.Attributes().Get(semconv.CitricTestIsSubtest)
	require.True(t, ok)
	assert.False(t, isSubtest.Bool())
}

func TestPackageParsing(t *testing.T) {
	logger := zap.NewNop()

	t.Run("sets package from ok summary line", func(t *testing.T) {
		ctx := NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
		parser := NewParser(ctx, logger)

		lines := []string{
			"=== RUN   TestFoo",
			"--- PASS: TestFoo (0.001s)",
			"=== RUN   TestBar",
			"--- PASS: TestBar (0.002s)",
			"ok  \tgithub.com/foo/bar/pkg\t0.005s",
		}

		baseTime := time.Now()
		for i, line := range lines {
			parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
		}
		parser.Finalize()

		require.Len(t, ctx.RootTests, 2)
		assert.Equal(t, "github.com/foo/bar/pkg", ctx.RootTests[0].Package)
		assert.Equal(t, "github.com/foo/bar/pkg", ctx.RootTests[1].Package)
	})

	t.Run("sets package from FAIL summary line", func(t *testing.T) {
		ctx := NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
		parser := NewParser(ctx, logger)

		lines := []string{
			"=== RUN   TestBroken",
			"--- FAIL: TestBroken (0.010s)",
			"FAIL\tgithub.com/foo/bar/other\t0.012s",
		}

		baseTime := time.Now()
		for i, line := range lines {
			parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
		}
		parser.Finalize()

		require.Len(t, ctx.RootTests, 1)
		assert.Equal(t, "github.com/foo/bar/other", ctx.RootTests[0].Package)
	})

	t.Run("sets package on subtests", func(t *testing.T) {
		ctx := NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
		parser := NewParser(ctx, logger)

		lines := []string{
			"=== RUN   TestParent",
			"=== RUN   TestParent/Child",
			"    --- PASS: TestParent/Child (0.001s)",
			"--- PASS: TestParent (0.002s)",
			"ok  \tgithub.com/example/mypkg\t0.005s",
		}

		baseTime := time.Now()
		for i, line := range lines {
			parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
		}
		parser.Finalize()

		require.Len(t, ctx.RootTests, 1)
		assert.Equal(t, "github.com/example/mypkg", ctx.RootTests[0].Package)
		require.Len(t, ctx.RootTests[0].Subtests, 1)
		assert.Equal(t, "github.com/example/mypkg", ctx.RootTests[0].Subtests[0].Package)
	})

	t.Run("generates span with package attribute", func(t *testing.T) {
		traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
		stepSpanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

		ctx := NewParseContext(123, 1, "test-job", 1, traceID, stepSpanID)
		parser := NewParser(ctx, logger)

		lines := []string{
			"=== RUN   TestFoo",
			"--- PASS: TestFoo (0.100s)",
			"ok  \tgithub.com/foo/bar\t0.105s",
		}

		baseTime := time.Now()
		for i, line := range lines {
			parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
		}
		parser.Finalize()

		resourceAttrs := pcommon.NewMap()
		traces := ctx.GenerateSpans(resourceAttrs)
		require.NotNil(t, traces)

		span := traces.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0)
		pkg, ok := span.Attributes().Get(semconv.CitricTestPackage)
		require.True(t, ok, "package attribute should be present")
		assert.Equal(t, "github.com/foo/bar", pkg.Str())
	})
}

func TestNoTestsGeneratesNilSpans(t *testing.T) {
	ctx := NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
	parser := NewParser(ctx, zap.NewNop())

	parser.ProcessLine("some random log output", time.Now())
	parser.Finalize()

	resourceAttrs := pcommon.NewMap()
	traces := ctx.GenerateSpans(resourceAttrs)
	assert.Nil(t, traces)
}

func TestResourceAttributesCopied(t *testing.T) {
	logger := zap.NewNop()
	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	stepSpanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	ctx := NewParseContext(123, 1, "test-job", 1, traceID, stepSpanID)
	parser := NewParser(ctx, logger)

	lines := []string{
		"=== RUN   TestFoo",
		"--- PASS: TestFoo (0.100s)",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	// Create resource attributes like the log handler does
	resourceAttrs := pcommon.NewMap()
	resourceAttrs.PutInt(string(conventions.CICDPipelineRunIDKey), 12345)
	resourceAttrs.PutStr("service.name", "test-service")
	resourceAttrs.PutStr(string(conventions.VCSProviderNameKey), "github")

	traces := ctx.GenerateSpans(resourceAttrs)
	require.NotNil(t, traces)

	// Verify resource attributes are copied
	resourceSpans := traces.ResourceSpans()
	require.Equal(t, 1, resourceSpans.Len())

	attrs := resourceSpans.At(0).Resource().Attributes()

	runID, ok := attrs.Get(string(conventions.CICDPipelineRunIDKey))
	require.True(t, ok, "run_id attribute should be present")
	assert.Equal(t, int64(12345), runID.Int())

	serviceName, ok := attrs.Get("service.name")
	require.True(t, ok, "service.name attribute should be present")
	assert.Equal(t, "test-service", serviceName.Str())

	ciSystem, ok := attrs.Get(string(conventions.VCSProviderNameKey))
	require.True(t, ok, "vcs.provider.name attribute should be present")
	assert.Equal(t, "github", ciSystem.Str())
}

func TestRandomSpanIDs(t *testing.T) {
	// Each call should produce a non-empty span ID
	id1 := GenerateTestSpanID()
	id2 := GenerateTestSpanID()
	assert.NotEqual(t, pcommon.SpanID{}, id1, "span ID should not be empty")
	assert.NotEqual(t, pcommon.SpanID{}, id2, "span ID should not be empty")

	// Each call should produce a unique span ID
	assert.NotEqual(t, id1, id2, "span IDs should be unique")
}

func TestExtractParentTest(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"TestFoo", ""},
		{"TestParent/Child", "TestParent"},
		{"TestParent/Child/Grandchild", "TestParent/Child"},
		{"Test/A/B/C", "Test/A/B"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := extractParentTest(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestTestInfoIsSubtest(t *testing.T) {
	root := &TestInfo{Name: "TestRoot", ParentTest: ""}
	assert.False(t, root.IsSubtest())

	child := &TestInfo{Name: "TestRoot/Child", ParentTest: "TestRoot"}
	assert.True(t, child.IsSubtest())
}

// countResults recursively counts pass/fail/skip results
func countResults(tests []*TestInfo) (passed, failed, skipped int) {
	for _, test := range tests {
		switch test.Result {
		case TestResultPass:
			passed++
		case TestResultFail:
			failed++
		case TestResultSkip:
			skipped++
		}
		p, f, s := countResults(test.Subtests)
		passed += p
		failed += f
		skipped += s
	}
	return
}
