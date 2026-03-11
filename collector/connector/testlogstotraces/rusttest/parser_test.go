// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package rusttest

import (
	"testing"
	"time"

	"github.com/everr-labs/everr/collector/connector/testlogstotraces/gotest"
	"github.com/everr-labs/everr/collector/semconv"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"
	"go.uber.org/zap"
)

func TestParseCargoTestOutputBuildsModuleHierarchy(t *testing.T) {
	logger := zap.NewNop()
	ctx := gotest.NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
	parser := NewParser(ctx, logger)

	lines := []string{
		"Running unittests src/lib.rs (target/debug/deps/everr_core-142b5ddf69d45992)",
		"running 2 tests",
		"test assistant::tests::assistant_instructions_use_requested_command_name ... ok <0.055s>",
		"test assistant::tests::sync_assistants_updates_only_selected_targets ... FAILED <0.250s>",
		"test auth::tests::session_namespace_is_fixed ... ignored <0.000s>",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	require.Len(t, ctx.RootTests, 2)

	assistant := ctx.RootTests[0]
	assert.Equal(t, "assistant", assistant.Name)
	assert.Equal(t, "everr_core", assistant.Package)
	assert.True(t, assistant.IsSuite())
	assert.False(t, assistant.IsSubtest())
	assert.Equal(t, gotest.TestResultFail, assistant.Result)
	require.Len(t, assistant.Subtests, 1)

	testsNode := assistant.Subtests[0]
	assert.Equal(t, "assistant::tests", testsNode.Name)
	assert.Equal(t, "assistant", testsNode.ParentTest)
	assert.True(t, testsNode.IsSuite())
	assert.True(t, testsNode.IsSubtest())
	assert.Equal(t, gotest.TestResultFail, testsNode.Result)
	require.Len(t, testsNode.Subtests, 2)

	firstLeaf := testsNode.Subtests[0]
	assert.Equal(
		t,
		"assistant::tests::assistant_instructions_use_requested_command_name",
		firstLeaf.Name,
	)
	assert.Equal(t, "assistant::tests", firstLeaf.ParentTest)
	assert.Equal(t, gotest.TestResultPass, firstLeaf.Result)
	assert.Equal(t, "everr_core", firstLeaf.Package)
	assert.Equal(t, 55*time.Millisecond, firstLeaf.Duration)

	secondLeaf := testsNode.Subtests[1]
	assert.Equal(
		t,
		"assistant::tests::sync_assistants_updates_only_selected_targets",
		secondLeaf.Name,
	)
	assert.Equal(t, gotest.TestResultFail, secondLeaf.Result)
	assert.Equal(t, 250*time.Millisecond, secondLeaf.Duration)

	auth := ctx.RootTests[1]
	assert.Equal(t, "auth", auth.Name)
	assert.Equal(t, "everr_core", auth.Package)
	assert.Equal(t, gotest.TestResultSkip, auth.Result)
	assert.Equal(t, 0*time.Millisecond, auth.Duration)

	assert.Equal(t, 250*time.Millisecond, testsNode.Duration)
	assert.Equal(t, 250*time.Millisecond, assistant.Duration)
}

func TestParseCargoTestOutputKeepsTargetsSeparated(t *testing.T) {
	logger := zap.NewNop()
	ctx := gotest.NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
	parser := NewParser(ctx, logger)

	lines := []string{
		"Running unittests src/main.rs (target/debug/deps/everr-71929bf80392215c)",
		"test cli::tests::parses_top_level_commands ... ok",
		"Running tests/help_output.rs (target/debug/deps/help_output-a35decf66b9a54f9)",
		"test root_help_lists_main_commands ... ok",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	require.Len(t, ctx.RootTests, 2)
	assert.Equal(t, "cli", ctx.RootTests[0].Name)
	assert.Equal(t, "everr", ctx.RootTests[0].Package)
	assert.Equal(t, "root_help_lists_main_commands", ctx.RootTests[1].Name)
	assert.Equal(t, "help_output", ctx.RootTests[1].Package)
}

func TestParseDocTestsUsesCrateNameAsPackage(t *testing.T) {
	logger := zap.NewNop()
	ctx := gotest.NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
	parser := NewParser(ctx, logger)

	lines := []string{
		"Doc-tests everr_core",
		"running 1 test",
		"test src/lib.rs - some_docs_example (line 42) ... ok <0.120s>",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	require.Len(t, ctx.RootTests, 1)
	assert.Equal(t, "src/lib.rs - some_docs_example (line 42)", ctx.RootTests[0].Name)
	assert.Equal(t, "everr_core", ctx.RootTests[0].Package)
	assert.Equal(t, gotest.TestResultPass, ctx.RootTests[0].Result)
	assert.Equal(t, 120*time.Millisecond, ctx.RootTests[0].Duration)
}

func TestParseCargoTestOutputHandlesPlainAndTimedFormats(t *testing.T) {
	logger := zap.NewNop()
	ctx := gotest.NewParseContext(123, 1, "test-job", 1, pcommon.TraceID{}, pcommon.SpanID{})
	parser := NewParser(ctx, logger)

	lines := []string{
		"Running unittests src/lib.rs (target/debug/deps/everr_core-142b5ddf69d45992)",
		"test assistant::tests::plain_output ... ok",
		"test assistant::tests::timed_output ... ok <0.333s>",
		"\x1b[31mtest assistant::tests::time_limited ... FAILED (time limit exceeded) <1.500s>\x1b[0m",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	require.Len(t, ctx.RootTests, 1)
	testsNode := ctx.RootTests[0].Subtests[0]
	require.Len(t, testsNode.Subtests, 3)

	assert.Equal(t, gotest.TestResultPass, testsNode.Subtests[0].Result)
	assert.Equal(t, 0*time.Millisecond, testsNode.Subtests[0].Duration)

	assert.Equal(t, gotest.TestResultPass, testsNode.Subtests[1].Result)
	assert.Equal(t, 333*time.Millisecond, testsNode.Subtests[1].Duration)

	assert.Equal(t, gotest.TestResultFail, testsNode.Subtests[2].Result)
	assert.Equal(t, 1500*time.Millisecond, testsNode.Subtests[2].Duration)
}

func TestSpanGeneration(t *testing.T) {
	logger := zap.NewNop()
	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	stepSpanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	ctx := gotest.NewParseContext(123, 1, "test-job", 1, traceID, stepSpanID)
	parser := NewParser(ctx, logger)

	lines := []string{
		"Running unittests src/lib.rs (target/debug/deps/everr_core-142b5ddf69d45992)",
		"test assistant::tests::assistant_instructions_use_requested_command_name ... ok <0.055s>",
		"test assistant::tests::sync_assistants_updates_only_selected_targets ... FAILED <0.250s>",
	}

	baseTime := time.Now()
	for i, line := range lines {
		parser.ProcessLine(line, baseTime.Add(time.Duration(i)*time.Millisecond))
	}
	parser.Finalize()

	resourceAttrs := pcommon.NewMap()
	resourceAttrs.PutInt(string(conventions.CICDPipelineRunIDKey), 123)
	traces := GenerateSpans(ctx, resourceAttrs)
	require.NotNil(t, traces)
	assert.Equal(t, 4, traces.SpanCount())

	resourceSpans := traces.ResourceSpans()
	require.Equal(t, 1, resourceSpans.Len())

	scopeSpans := resourceSpans.At(0).ScopeSpans()
	require.Equal(t, 1, scopeSpans.Len())
	assert.Equal(t, "rusttest", scopeSpans.At(0).Scope().Name())

	spans := scopeSpans.At(0).Spans()
	var passSpan, failSpan ptrace.Span
	for i := 0; i < spans.Len(); i++ {
		span := spans.At(i)
		switch span.Name() {
		case "assistant_instructions_use_requested_command_name":
			passSpan = span
		case "sync_assistants_updates_only_selected_targets":
			failSpan = span
		}
	}

	require.NotEqual(t, ptrace.Span{}, passSpan, "pass span not found")
	assert.Equal(t, traceID, passSpan.TraceID())
	assert.Equal(t, ptrace.StatusCodeUnset, passSpan.Status().Code())

	traceResourceAttrs := traces.ResourceSpans().At(0).Resource().Attributes()
	resourceFramework, ok := traceResourceAttrs.Get(semconv.EverrTestFramework)
	require.True(t, ok)
	assert.Equal(t, "rust", resourceFramework.Str())

	resourceLanguage, ok := traceResourceAttrs.Get(semconv.EverrTestLanguage)
	require.True(t, ok)
	assert.Equal(t, "rust", resourceLanguage.Str())

	attrs := passSpan.Attributes()
	testName, ok := attrs.Get(semconv.EverrTestName)
	require.True(t, ok)
	assert.Equal(
		t,
		"assistant::tests::assistant_instructions_use_requested_command_name",
		testName.Str(),
	)

	framework, ok := attrs.Get(semconv.EverrTestFramework)
	require.True(t, ok)
	assert.Equal(t, "rust", framework.Str())

	language, ok := attrs.Get(semconv.EverrTestLanguage)
	require.True(t, ok)
	assert.Equal(t, "rust", language.Str())

	pkg, ok := attrs.Get(semconv.EverrTestPackage)
	require.True(t, ok)
	assert.Equal(t, "everr_core", pkg.Str())

	duration, ok := attrs.Get(semconv.EverrTestDurationSeconds)
	require.True(t, ok)
	assert.InDelta(t, 0.055, duration.Double(), 0.0001)

	require.NotEqual(t, ptrace.Span{}, failSpan, "fail span not found")
	assert.Equal(t, ptrace.StatusCodeError, failSpan.Status().Code())
}
