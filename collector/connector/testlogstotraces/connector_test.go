package testlogstotraces

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/connector/connectortest"
	"go.opentelemetry.io/collector/consumer/consumertest"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/ptrace"

	conventions "go.opentelemetry.io/otel/semconv/v1.38.0"

	"github.com/everr-labs/everr/collector/connector/testlogstotraces/internal/metadata"
	"github.com/everr-labs/everr/collector/semconv"
)

func buildTestLogs(lines []string, resourceAttrs map[string]any, jobName string, stepNumber int64, traceID pcommon.TraceID, spanID pcommon.SpanID) plog.Logs {
	logs := plog.NewLogs()
	rl := logs.ResourceLogs().AppendEmpty()

	for k, v := range resourceAttrs {
		switch val := v.(type) {
		case string:
			rl.Resource().Attributes().PutStr(k, val)
		case int64:
			rl.Resource().Attributes().PutInt(k, val)
		}
	}

	sl := rl.ScopeLogs().AppendEmpty()
	sl.Scope().Attributes().PutStr(string(conventions.CICDPipelineTaskNameKey), jobName)

	baseTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	for i, line := range lines {
		record := sl.LogRecords().AppendEmpty()
		record.Body().SetStr(line)
		record.SetTimestamp(pcommon.NewTimestampFromTime(baseTime.Add(time.Duration(i) * time.Millisecond)))
		record.Attributes().PutInt(semconv.EverrGitHubWorkflowJobStepNumber, stepNumber)
		record.SetTraceID(traceID)
		record.SetSpanID(spanID)
	}

	return logs
}

func TestConnectorGoTestPatterns(t *testing.T) {
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	logs := buildTestLogs(
		[]string{
			"=== RUN   TestFoo",
			"--- PASS: TestFoo (0.100s)",
			"=== RUN   TestBar",
			"--- FAIL: TestBar (0.200s)",
		},
		map[string]any{
			string(conventions.CICDPipelineRunIDKey): int64(123),
			semconv.EverrGitHubWorkflowRunRunAttempt: int64(1),
		},
		"test-job",
		1,
		traceID,
		spanID,
	)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)

	require.Equal(t, 2, tracesSink.SpanCount(), "should have produced 2 test spans")
	traces := tracesSink.AllTraces()
	require.Len(t, traces, 1)
	assert.Equal(t, 2, traces[0].SpanCount())

	// Verify spans
	spans := traces[0].ResourceSpans().At(0).ScopeSpans().At(0).Spans()
	require.Equal(t, 2, spans.Len())

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

	require.NotEqual(t, ptrace.Span{}, fooSpan, "TestFoo span not found")
	assert.Equal(t, traceID, fooSpan.TraceID())
	assert.Equal(t, spanID, fooSpan.ParentSpanID())
	assert.Equal(t, ptrace.StatusCodeUnset, fooSpan.Status().Code())

	framework, ok := fooSpan.Attributes().Get(semconv.EverrTestFramework)
	require.True(t, ok)
	assert.Equal(t, "go", framework.Str())

	language, ok := fooSpan.Attributes().Get(semconv.EverrTestLanguage)
	require.True(t, ok)
	assert.Equal(t, "go", language.Str())

	require.NotEqual(t, ptrace.Span{}, barSpan, "TestBar span not found")
	assert.Equal(t, ptrace.StatusCodeError, barSpan.Status().Code())
}

func TestConnectorVitestPatterns(t *testing.T) {
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	logs := buildTestLogs(
		[]string{
			" ✓ src/lib/formatting.test.ts > formatDuration > formats milliseconds 1ms",
			" × src/lib/formatting.test.ts > formatDuration > fails on negative 3ms",
			" ↓ src/lib/formatting.test.ts > formatDuration > is skipped",
		},
		map[string]any{
			string(conventions.CICDPipelineRunIDKey): int64(123),
			semconv.EverrGitHubWorkflowRunRunAttempt: int64(1),
		},
		"test-job",
		1,
		traceID,
		spanID,
	)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)

	// 1 describe block + 3 tests = 4 spans
	require.Equal(t, 4, tracesSink.SpanCount(), "should have produced 4 test spans")
	traces := tracesSink.AllTraces()
	require.Len(t, traces, 1)

	// Verify scope name is vitest
	scopeSpans := traces[0].ResourceSpans().At(0).ScopeSpans().At(0)
	assert.Equal(t, "vitest", scopeSpans.Scope().Name())

	// Find spans by name
	spans := scopeSpans.Spans()
	spanMap := make(map[string]ptrace.Span)
	for i := 0; i < spans.Len(); i++ {
		span := spans.At(i)
		spanMap[span.Name()] = span
	}

	// Verify individual test spans
	passSpan, ok := spanMap["formats milliseconds"]
	require.True(t, ok, "pass span not found")
	assert.Equal(t, ptrace.StatusCodeUnset, passSpan.Status().Code())

	failSpan, ok := spanMap["fails on negative"]
	require.True(t, ok, "fail span not found")
	assert.Equal(t, ptrace.StatusCodeError, failSpan.Status().Code())

	skipSpan, ok := spanMap["is skipped"]
	require.True(t, ok, "skip span not found")
	assert.Equal(t, ptrace.StatusCodeUnset, skipSpan.Status().Code())

	// Verify framework attribute is vitest
	framework, ok := passSpan.Attributes().Get(semconv.EverrTestFramework)
	require.True(t, ok)
	assert.Equal(t, "vitest", framework.Str())

	language, ok := passSpan.Attributes().Get(semconv.EverrTestLanguage)
	require.True(t, ok)
	assert.Equal(t, "typescript", language.Str())
}

func TestConnectorVitestPatternsWithWorkspacePrefixAndANSI(t *testing.T) {
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	logs := buildTestLogs(
		[]string{
			"packages/app test:  \x1b[32m✓\x1b[39m src/server/github-events/cdevents.test.ts\x1b[2m > \x1b[22mtransformToCDEventRows\x1b[2m > \x1b[22mformats Date values for ClickHouse DateTime64 input\x1b[32m 2\x1b[2mms\x1b[22m\x1b[39m",
			"packages/app test:  \x1b[31m×\x1b[39m src/server/github-events/cdevents.test.ts\x1b[2m > \x1b[22mtransformToCDEventRows\x1b[2m > \x1b[22mreports malformed payloads\x1b[31m 3\x1b[2mms\x1b[22m\x1b[39m",
		},
		map[string]any{
			string(conventions.CICDPipelineRunIDKey): int64(123),
			semconv.EverrGitHubWorkflowRunRunAttempt: int64(1),
		},
		"test-job",
		1,
		traceID,
		spanID,
	)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)

	require.Equal(t, 3, tracesSink.SpanCount(), "should have produced 3 spans")
}

func TestConnectorRustTestPatterns(t *testing.T) {
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	logs := buildTestLogs(
		[]string{
			"Running unittests src/lib.rs (target/debug/deps/everr_core-142b5ddf69d45992)",
			"running 2 tests",
			"test assistant::tests::assistant_instructions_use_requested_command_name ... ok <0.055s>",
			"test assistant::tests::sync_assistants_updates_only_selected_targets ... FAILED <0.250s>",
		},
		map[string]any{
			string(conventions.CICDPipelineRunIDKey): int64(123),
			semconv.EverrGitHubWorkflowRunRunAttempt: int64(1),
		},
		"test-job",
		1,
		traceID,
		spanID,
	)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)

	require.Equal(t, 4, tracesSink.SpanCount(), "should have produced 4 Rust test spans")
	traces := tracesSink.AllTraces()
	require.Len(t, traces, 1)

	scopeSpans := traces[0].ResourceSpans().At(0).ScopeSpans().At(0)
	assert.Equal(t, "rusttest", scopeSpans.Scope().Name())

	spans := scopeSpans.Spans()
	spanMap := make(map[string]ptrace.Span)
	for i := 0; i < spans.Len(); i++ {
		span := spans.At(i)
		spanMap[span.Name()] = span
	}

	passSpan, ok := spanMap["assistant_instructions_use_requested_command_name"]
	require.True(t, ok, "pass span not found")
	assert.Equal(t, ptrace.StatusCodeUnset, passSpan.Status().Code())

	failSpan, ok := spanMap["sync_assistants_updates_only_selected_targets"]
	require.True(t, ok, "fail span not found")
	assert.Equal(t, ptrace.StatusCodeError, failSpan.Status().Code())

	framework, ok := passSpan.Attributes().Get(semconv.EverrTestFramework)
	require.True(t, ok)
	assert.Equal(t, "rust", framework.Str())

	language, ok := passSpan.Attributes().Get(semconv.EverrTestLanguage)
	require.True(t, ok)
	assert.Equal(t, "rust", language.Str())

	duration, ok := passSpan.Attributes().Get(semconv.EverrTestDurationSeconds)
	require.True(t, ok)
	assert.InDelta(t, 0.055, duration.Double(), 0.0001)
}

func TestConnectorNoTestPatterns(t *testing.T) {
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	logs := buildTestLogs(
		[]string{
			"some random log line",
			"another log line",
			"no test patterns here",
		},
		map[string]any{
			string(conventions.CICDPipelineRunIDKey): int64(123),
			semconv.EverrGitHubWorkflowRunRunAttempt: int64(1),
		},
		"build-job",
		1,
		traceID,
		spanID,
	)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)

	assert.Equal(t, 0, tracesSink.SpanCount(), "should not produce spans for non-test logs")
}

func TestConnectorResourceAttributesPropagated(t *testing.T) {
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	logs := buildTestLogs(
		[]string{
			"=== RUN   TestFoo",
			"--- PASS: TestFoo (0.100s)",
		},
		map[string]any{
			string(conventions.CICDPipelineRunIDKey): int64(123),
			semconv.EverrGitHubWorkflowRunRunAttempt: int64(1),
			string(conventions.VCSProviderNameKey):   "github",
		},
		"test-job",
		1,
		traceID,
		spanID,
	)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)

	require.Equal(t, 1, tracesSink.SpanCount())
	traces := tracesSink.AllTraces()
	attrs := traces[0].ResourceSpans().At(0).Resource().Attributes()

	runID, ok := attrs.Get(string(conventions.CICDPipelineRunIDKey))
	require.True(t, ok)
	assert.Equal(t, int64(123), runID.Int())

	ciSystem, ok := attrs.Get(string(conventions.VCSProviderNameKey))
	require.True(t, ok)
	assert.Equal(t, "github", ciSystem.Str())

	framework, ok := attrs.Get(semconv.EverrTestFramework)
	require.True(t, ok)
	assert.Equal(t, "go", framework.Str())

	language, ok := attrs.Get(semconv.EverrTestLanguage)
	require.True(t, ok)
	assert.Equal(t, "go", language.Str())
}

func TestConnectorSubtestHierarchy(t *testing.T) {
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	logs := buildTestLogs(
		[]string{
			"=== RUN   TestParent",
			"=== RUN   TestParent/Child1",
			"    --- PASS: TestParent/Child1 (0.001s)",
			"=== RUN   TestParent/Child2",
			"    --- PASS: TestParent/Child2 (0.002s)",
			"--- PASS: TestParent (0.005s)",
		},
		map[string]any{
			string(conventions.CICDPipelineRunIDKey): int64(123),
			semconv.EverrGitHubWorkflowRunRunAttempt: int64(1),
		},
		"test-job",
		1,
		traceID,
		spanID,
	)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)

	require.Equal(t, 3, tracesSink.SpanCount(), "should have 3 spans (parent + 2 children)")

	traces := tracesSink.AllTraces()
	spans := traces[0].ResourceSpans().At(0).ScopeSpans().At(0).Spans()

	var parentSpan, child1Span, child2Span ptrace.Span
	for i := 0; i < spans.Len(); i++ {
		span := spans.At(i)
		switch span.Name() {
		case "TestParent":
			parentSpan = span
		case "Child1":
			child1Span = span
		case "Child2":
			child2Span = span
		}
	}

	require.NotEqual(t, ptrace.Span{}, parentSpan, "parent span not found")
	require.NotEqual(t, ptrace.Span{}, child1Span, "child1 span not found")
	require.NotEqual(t, ptrace.Span{}, child2Span, "child2 span not found")

	// Parent's parent should be the step span
	assert.Equal(t, spanID, parentSpan.ParentSpanID())

	// Children's parent should be the parent test span
	assert.Equal(t, parentSpan.SpanID(), child1Span.ParentSpanID())
	assert.Equal(t, parentSpan.SpanID(), child2Span.ParentSpanID())
}

func TestConnectorFactory(t *testing.T) {
	factory := NewFactory()
	assert.Equal(t, "testlogstotraces", factory.Type().String())

	cfg := factory.CreateDefaultConfig()
	require.NotNil(t, cfg)

	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	connector, err := factory.CreateLogsToTraces(context.Background(), set, cfg, tracesSink)
	require.NoError(t, err)
	require.NotNil(t, connector)
}

func TestConnectorMissingResourceAttributes(t *testing.T) {
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	// Logs without required resource attributes should be skipped
	logs := plog.NewLogs()
	rl := logs.ResourceLogs().AppendEmpty()
	sl := rl.ScopeLogs().AppendEmpty()
	sl.Scope().Attributes().PutStr(string(conventions.CICDPipelineTaskNameKey), "test-job")
	record := sl.LogRecords().AppendEmpty()
	record.Body().SetStr("=== RUN   TestFoo")
	record.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	record.Attributes().PutInt(semconv.EverrGitHubWorkflowJobStepNumber, 1)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)
	assert.Equal(t, 0, tracesSink.SpanCount(), "should not produce spans when resource attributes are missing")
}

func TestConnectorMixedRustAndVitestVerbose(t *testing.T) {
	// When both Rust and Vitest verbose output appear in the same step,
	// the parser with more tests should win.
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	logs := buildTestLogs(
		[]string{
			// Rust test output (2 tests)
			"Running unittests src/lib.rs (target/debug/deps/my_crate-abc123)",
			"running 2 tests",
			"test utils::tests::parses_config ... ok <0.010s>",
			"test utils::tests::handles_empty ... ok <0.005s>",
			// Vitest verbose output (3 tests) — should win
			" ✓ src/app.test.ts > App > renders title 5ms",
			" ✓ src/app.test.ts > App > handles click 3ms",
			" × src/app.test.ts > App > shows error 2ms",
		},
		map[string]any{
			string(conventions.CICDPipelineRunIDKey): int64(123),
			semconv.EverrGitHubWorkflowRunRunAttempt: int64(1),
		},
		"test-job",
		1,
		traceID,
		spanID,
	)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)

	traces := tracesSink.AllTraces()
	require.Len(t, traces, 1)

	// Vitest has 3 leaf tests + 1 describe block = 4 spans; Rust has 2 leaf + 1 module = 3 spans.
	// Vitest wins because vitestCtx.TestCount() > rustCtx.TestCount().
	scopeSpans := traces[0].ResourceSpans().At(0).ScopeSpans().At(0)
	assert.Equal(t, "vitest", scopeSpans.Scope().Name(), "Vitest should win when it has more tests")

	// Verify framework attribute
	spans := scopeSpans.Spans()
	for i := 0; i < spans.Len(); i++ {
		fw, ok := spans.At(i).Attributes().Get(semconv.EverrTestFramework)
		require.True(t, ok)
		assert.Equal(t, "vitest", fw.Str(), "all spans should be attributed to vitest")
	}
}

func TestConnectorMixedRustAndVitestDefaultReporter(t *testing.T) {
	// When Rust output and Vitest default reporter output appear in the same step,
	// the parser with more tests should win. Vitest default reporter lines must not
	// be misattributed to Rust.
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	logs := buildTestLogs(
		[]string{
			// Vitest default reporter (1 file summary + 2 slow tests = 3 spans)
			" ✓ src/utils.test.ts (5 tests) 120ms",
			"    ✓ parses input correctly  2097ms",
			"    × validates schema  1500ms",
			// Rust test output (1 test = 1 span)
			"Running unittests src/lib.rs (target/debug/deps/my_crate-abc123)",
			"test config::parse ... ok <0.010s>",
		},
		map[string]any{
			string(conventions.CICDPipelineRunIDKey): int64(123),
			semconv.EverrGitHubWorkflowRunRunAttempt: int64(1),
		},
		"test-job",
		1,
		traceID,
		spanID,
	)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)

	traces := tracesSink.AllTraces()
	require.Len(t, traces, 1)

	// Vitest: 1 file summary + 2 slow tests = 3 spans. Rust: 1 test = 1 span.
	// Vitest wins.
	scopeSpans := traces[0].ResourceSpans().At(0).ScopeSpans().At(0)
	assert.Equal(t, "vitest", scopeSpans.Scope().Name(), "Vitest should win with more tests")
}

func TestConnectorRustWinsOverVitestDefaultReporter(t *testing.T) {
	// When Rust has more tests than Vitest default reporter, Rust should win.
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	logs := buildTestLogs(
		[]string{
			// Vitest default reporter (1 file summary only)
			" ✓ src/utils.test.ts (5 tests) 120ms",
			// Rust test output (3 tests)
			"Running unittests src/lib.rs (target/debug/deps/my_crate-abc123)",
			"test config::parse ... ok <0.010s>",
			"test config::validate ... ok <0.020s>",
			"test config::serialize ... FAILED <0.030s>",
		},
		map[string]any{
			string(conventions.CICDPipelineRunIDKey): int64(123),
			semconv.EverrGitHubWorkflowRunRunAttempt: int64(1),
		},
		"test-job",
		1,
		traceID,
		spanID,
	)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)

	traces := tracesSink.AllTraces()
	require.Len(t, traces, 1)

	// Rust: 3 leaf tests + 1 module node = 4 spans. Vitest: 1 file summary = 1 span.
	// Rust wins.
	scopeSpans := traces[0].ResourceSpans().At(0).ScopeSpans().At(0)
	assert.Equal(t, "rusttest", scopeSpans.Scope().Name(), "Rust should win with more tests")
}

func TestConnectorMixedGoAndVitestDefaultReporter(t *testing.T) {
	// Go test output mixed with Vitest default reporter. Go should win when it has more tests.
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	logs := buildTestLogs(
		[]string{
			// Go test output (3 tests)
			"=== RUN   TestFoo",
			"--- PASS: TestFoo (0.100s)",
			"=== RUN   TestBar",
			"--- PASS: TestBar (0.200s)",
			"=== RUN   TestBaz",
			"--- FAIL: TestBaz (0.300s)",
			// Vitest default reporter (1 file summary)
			" ✓ src/utils.test.ts (5 tests) 120ms",
		},
		map[string]any{
			string(conventions.CICDPipelineRunIDKey): int64(123),
			semconv.EverrGitHubWorkflowRunRunAttempt: int64(1),
		},
		"test-job",
		1,
		traceID,
		spanID,
	)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)

	traces := tracesSink.AllTraces()
	require.Len(t, traces, 1)

	// Go has 3 tests, Vitest has 1 file summary. Go wins (goCtx >= vitestCtx && goCtx >= rustCtx).
	spans := traces[0].ResourceSpans().At(0).ScopeSpans().At(0).Spans()
	fw, ok := spans.At(0).Attributes().Get(semconv.EverrTestFramework)
	require.True(t, ok)
	assert.Equal(t, "go", fw.Str(), "Go should win with more tests")
}

func TestConnectorVitestDefaultReporterNoFalsePositivesFromBuildOutput(t *testing.T) {
	// Non-test output that contains checkmarks or similar characters should not
	// produce false positives in the Vitest parser.
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	logs := buildTestLogs(
		[]string{
			// Common build output that should NOT match any parser
			"✓ Compiled successfully in 1200ms",
			"✓ Build complete",
			"✓ Linting passed",
			"× ESLint found 2 errors",
			"✓ Dependencies installed 500ms",
			"✓ TypeScript check passed 3200ms",
			"Downloading artifact build-output 42ms",
			"Step completed with status: success",
		},
		map[string]any{
			string(conventions.CICDPipelineRunIDKey): int64(123),
			semconv.EverrGitHubWorkflowRunRunAttempt: int64(1),
		},
		"build-job",
		1,
		traceID,
		spanID,
	)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)

	assert.Equal(t, 0, tracesSink.SpanCount(), "build output with checkmarks should not produce test spans")
}

func TestConnectorVitestDefaultReporterNotConfusedByRustOutput(t *testing.T) {
	// Rust test lines must not be parsed as Vitest slow tests.
	// Rust format: "test name ... ok <0.010s>" — contains no checkmarks and uses "..." separator.
	// This verifies the Vitest slow test pattern doesn't match Rust output.
	tracesSink := &consumertest.TracesSink{}
	set := connectortest.NewNopSettings(metadata.Type)

	c, err := newConnector(set, &Config{}, tracesSink)
	require.NoError(t, err)

	traceID := pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8}

	logs := buildTestLogs(
		[]string{
			// Only Rust output — Vitest parser should detect 0 tests
			"Running unittests src/lib.rs (target/debug/deps/my_crate-abc123)",
			"running 3 tests",
			"test utils::parse ... ok <0.010s>",
			"test utils::validate ... ok <0.020s>",
			"test utils::serialize ... FAILED <0.030s>",
		},
		map[string]any{
			string(conventions.CICDPipelineRunIDKey): int64(123),
			semconv.EverrGitHubWorkflowRunRunAttempt: int64(1),
		},
		"test-job",
		1,
		traceID,
		spanID,
	)

	err = c.ConsumeLogs(context.Background(), logs)
	require.NoError(t, err)

	traces := tracesSink.AllTraces()
	require.Len(t, traces, 1)

	// Must be attributed to Rust, not Vitest
	scopeSpans := traces[0].ResourceSpans().At(0).ScopeSpans().At(0)
	assert.Equal(t, "rusttest", scopeSpans.Scope().Name(), "Rust output should be attributed to Rust parser")
}
