// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package gotest

import (
	"crypto/rand"
	"regexp"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.uber.org/zap"
)

var (
	// Verbose format patterns for go test -v output
	runPattern  = regexp.MustCompile(`^=== RUN\s+(\S+)`)
	passPattern = regexp.MustCompile(`^---\s*PASS:\s*(\S+)\s*\(([0-9.]+)s\)`)
	failPattern = regexp.MustCompile(`^---\s*FAIL:\s*(\S+)\s*\(([0-9.]+)s\)`)
	skipPattern = regexp.MustCompile(`^---\s*SKIP:\s*(\S+)\s*\(([0-9.]+)s\)`)

	// Package summary lines emitted after all tests in a package complete:
	//   ok      github.com/foo/bar   0.005s
	//   FAIL    github.com/foo/bar   1.234s
	pkgPattern = regexp.MustCompile(`^(?:ok|FAIL)\s+(\S+)\s+[0-9.]+s`)
)

// Parser processes Go test verbose output and extracts test information.
type Parser struct {
	ctx    *TestParseContext
	logger *zap.Logger
}

// NewParser creates a new Parser for processing Go test output.
func NewParser(ctx *TestParseContext, logger *zap.Logger) *Parser {
	return &Parser{
		ctx:    ctx,
		logger: logger,
	}
}

// ProcessLine parses a single log line for Go test output.
func (p *Parser) ProcessLine(line string, timestamp time.Time) {
	// Trim leading whitespace for pattern matching but preserve original for output capture.
	trimmed := strings.TrimLeft(line, " \t")

	// Check for RUN (test start)
	if matches := runPattern.FindStringSubmatch(trimmed); matches != nil {
		testName := matches[1]
		p.startTest(testName, timestamp)
		return
	}

	// Check for PASS
	if matches := passPattern.FindStringSubmatch(trimmed); matches != nil {
		testName := matches[1]
		elapsed, _ := strconv.ParseFloat(matches[2], 64)
		p.endTest(testName, TestResultPass, elapsed, timestamp)
		return
	}

	// Check for FAIL
	if matches := failPattern.FindStringSubmatch(trimmed); matches != nil {
		testName := matches[1]
		elapsed, _ := strconv.ParseFloat(matches[2], 64)
		p.endTest(testName, TestResultFail, elapsed, timestamp)
		return
	}

	// Check for SKIP
	if matches := skipPattern.FindStringSubmatch(trimmed); matches != nil {
		testName := matches[1]
		elapsed, _ := strconv.ParseFloat(matches[2], 64)
		p.endTest(testName, TestResultSkip, elapsed, timestamp)
		return
	}

	// Check for package summary line (ok/FAIL <package> <duration>)
	if matches := pkgPattern.FindStringSubmatch(trimmed); matches != nil {
		p.setPackage(matches[1])
		return
	}

	// Capture output for active tests (the most recently started test)
	p.captureOutput(line)
}

// startTest handles a === RUN line.
func (p *Parser) startTest(testName string, timestamp time.Time) {
	parentName := extractParentTest(testName)

	test := &TestInfo{
		Name:       testName,
		ParentTest: parentName,
		StartTime:  timestamp,
		Output:     make([]string, 0),
		Subtests:   make([]*TestInfo, 0),
	}

	test.SpanID = GenerateTestSpanID()

	p.ctx.ActiveTests[testName] = test

	// Link to parent if this is a subtest
	if parentName != "" {
		if parent, ok := p.ctx.ActiveTests[parentName]; ok {
			parent.Subtests = append(parent.Subtests, test)
		}
	}

	p.logger.Debug("Started test",
		zap.String("test", testName),
		zap.String("parent", parentName),
		zap.Time("timestamp", timestamp),
	)
}

// endTest handles a --- PASS/FAIL/SKIP line.
func (p *Parser) endTest(testName string, result TestResult, elapsed float64, timestamp time.Time) {
	test, ok := p.ctx.ActiveTests[testName]
	if !ok {
		// Test started before we began parsing, create minimal record
		p.logger.Debug("Test ended without matching RUN, creating minimal record",
			zap.String("test", testName),
		)
		test = &TestInfo{
			Name:       testName,
			ParentTest: extractParentTest(testName),
			StartTime:  timestamp.Add(-time.Duration(elapsed * float64(time.Second))),
			Output:     make([]string, 0),
			Subtests:   make([]*TestInfo, 0),
		}
		test.SpanID = GenerateTestSpanID()
	}

	test.Result = result
	test.Duration = time.Duration(elapsed * float64(time.Second))
	test.EndTime = test.StartTime.Add(test.Duration)

	delete(p.ctx.ActiveTests, testName)

	// Add to root tests if not a subtest
	if test.ParentTest == "" {
		p.ctx.RootTests = append(p.ctx.RootTests, test)
	}

	p.logger.Debug("Ended test",
		zap.String("test", testName),
		zap.String("result", string(result)),
		zap.Duration("duration", test.Duration),
	)
}

// setPackage assigns the package path to all completed root tests that don't
// already have one. Go test emits the package summary line after all tests in
// that package have finished, so at this point every root test (and its
// subtests) belongs to this package.
func (p *Parser) setPackage(pkg string) {
	var setOnTests func([]*TestInfo)
	setOnTests = func(tests []*TestInfo) {
		for _, t := range tests {
			if t.Package == "" {
				t.Package = pkg
			}
			setOnTests(t.Subtests)
		}
	}
	setOnTests(p.ctx.RootTests)

	p.logger.Debug("Set package on tests",
		zap.String("package", pkg),
	)
}

// captureOutput captures a line of output for active tests.
func (p *Parser) captureOutput(line string) {
	// Capture output for the most recently started test
	// In Go test output, indented lines belong to the current test
	for _, test := range p.ctx.ActiveTests {
		test.Output = append(test.Output, line)
	}
}

// Finalize completes parsing and returns the context with all parsed tests.
// Any tests still in ActiveTests are considered incomplete and are finalized.
func (p *Parser) Finalize() *TestParseContext {
	// Handle any tests that started but didn't have a result line
	for testName, test := range p.ctx.ActiveTests {
		p.logger.Warn("Test started but never completed",
			zap.String("test", testName),
		)
		// Add incomplete tests to root tests if they're not subtests
		if test.ParentTest == "" {
			p.ctx.RootTests = append(p.ctx.RootTests, test)
		}
	}
	p.ctx.ActiveTests = make(map[string]*TestInfo)
	return p.ctx
}

// Context returns the current parse context.
func (p *Parser) Context() *TestParseContext {
	return p.ctx
}

// extractParentTest extracts parent test name from subtest name.
// "TestParent/SubTest1" -> "TestParent"
// "TestParent/Sub/Nested" -> "TestParent/Sub"
func extractParentTest(testName string) string {
	if idx := strings.LastIndex(testName, "/"); idx > 0 {
		return testName[:idx]
	}
	return ""
}

// GenerateTestSpanID creates a random span ID for a test.
// Random IDs avoid collisions when tests have duplicate names (e.g. table-driven tests).
func GenerateTestSpanID() pcommon.SpanID {
	var spanID pcommon.SpanID
	_, _ = rand.Read(spanID[:])
	return spanID
}
