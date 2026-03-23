package gotest

import (
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
)

// TestResult represents the outcome of a test.
type TestResult string

const (
	TestResultPass TestResult = "pass"
	TestResultFail TestResult = "fail"
	TestResultSkip TestResult = "skip"
)

// TestInfo tracks state for a test during and after parsing.
type TestInfo struct {
	Name       string         // Full test name (e.g., "TestParent/SubTest1")
	Package    string         // Go package path (if available)
	ParentTest string         // Parent test name (empty for root tests)
	StartTime  time.Time      // When the test started
	EndTime    time.Time      // When the test completed
	Result     TestResult     // pass, fail, skip
	Duration   time.Duration  // Test duration
	Output     []string       // Captured output lines
	Subtests   []*TestInfo    // Child tests
	SpanID     pcommon.SpanID // Generated span ID for this test
}

// IsSubtest returns true if this test has a parent test.
func (t *TestInfo) IsSubtest() bool {
	return t.ParentTest != ""
}

// IsSuite returns true if this test contains child tests.
func (t *TestInfo) IsSuite() bool {
	return len(t.Subtests) > 0
}

// TestParseContext holds state during log parsing for a single step.
type TestParseContext struct {
	// Identifiers for span generation
	RunID      int64
	RunAttempt int
	JobName    string
	StepNumber int64
	TraceID    pcommon.TraceID
	StepSpanID pcommon.SpanID

	// State tracking during parsing
	ActiveTests map[string]*TestInfo // Key: full test name
	RootTests   []*TestInfo          // Top-level tests (completed)
}

// NewParseContext creates a new TestParseContext for parsing test output.
func NewParseContext(runID int64, runAttempt int, jobName string, stepNumber int64, traceID pcommon.TraceID, stepSpanID pcommon.SpanID) *TestParseContext {
	return &TestParseContext{
		RunID:       runID,
		RunAttempt:  runAttempt,
		JobName:     jobName,
		StepNumber:  stepNumber,
		TraceID:     traceID,
		StepSpanID:  stepSpanID,
		ActiveTests: make(map[string]*TestInfo),
		RootTests:   make([]*TestInfo, 0),
	}
}

// HasTests returns true if any tests were detected.
func (ctx *TestParseContext) HasTests() bool {
	return len(ctx.RootTests) > 0
}

// TestCount returns the total number of tests (including subtests).
func (ctx *TestParseContext) TestCount() int {
	count := 0
	var countTests func([]*TestInfo)
	countTests = func(tests []*TestInfo) {
		for _, t := range tests {
			count++
			countTests(t.Subtests)
		}
	}
	countTests(ctx.RootTests)
	return count
}
