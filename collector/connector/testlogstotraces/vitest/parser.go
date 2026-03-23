package vitest

import (
	"regexp"
	"strconv"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/connector/testlogstotraces/gotest"
)

var (
	// Vitest verbose reporter patterns (after ANSI stripping)
	// Pass: ✓ filepath > describe > test Nms
	// Also matches checkmark symbol (various Unicode representations)
	passPattern = regexp.MustCompile(`^[✓✔√]\s+(.+? > .+?)\s+(\d+)ms$`)
	// Fail: × filepath > describe > test Nms
	failPattern = regexp.MustCompile(`^[×✕✖xX]\s+(.+? > .+?)\s+(\d+)ms$`)
	// Skip: ↓ filepath > describe > test
	skipPattern = regexp.MustCompile(`^↓\s+(.+ > .+)$`)
	// ANSI escape code pattern for stripping color codes from CI output.
	ansiPattern = regexp.MustCompile(`\x1b\[[0-9;]*m`)
	// pnpm recursive output prefixes each line with "<package> <script>: ".
	workspaceTestPrefixPattern = regexp.MustCompile(`^\S+\s+\S+:\s+`)
)

// Parser processes Vitest verbose output and extracts test information.
type Parser struct {
	ctx    *gotest.TestParseContext
	logger *zap.Logger
}

// NewParser creates a new Parser for processing Vitest verbose output.
func NewParser(ctx *gotest.TestParseContext, logger *zap.Logger) *Parser {
	return &Parser{
		ctx:    ctx,
		logger: logger,
	}
}

// ProcessLine parses a single log line for Vitest verbose output.
func (p *Parser) ProcessLine(line string, timestamp time.Time) {
	trimmed := normalizeLine(line)

	if trimmed == "" {
		return
	}

	// Check for pass pattern: ✓ filepath > describe > test Nms
	if matches := passPattern.FindStringSubmatch(trimmed); matches != nil {
		fullName := strings.TrimSpace(matches[1])
		durationMs, _ := strconv.ParseFloat(matches[2], 64)
		p.addTest(fullName, gotest.TestResultPass, durationMs, timestamp)
		return
	}

	// Check for fail pattern: × filepath > describe > test Nms
	if matches := failPattern.FindStringSubmatch(trimmed); matches != nil {
		fullName := strings.TrimSpace(matches[1])
		durationMs, _ := strconv.ParseFloat(matches[2], 64)
		p.addTest(fullName, gotest.TestResultFail, durationMs, timestamp)
		return
	}

	// Check for skip pattern: ↓ filepath > describe > test
	if matches := skipPattern.FindStringSubmatch(trimmed); matches != nil {
		fullName := strings.TrimSpace(matches[1])
		p.addTest(fullName, gotest.TestResultSkip, 0, timestamp)
		return
	}
}

func normalizeLine(line string) string {
	cleaned := ansiPattern.ReplaceAllString(line, "")
	trimmed := strings.TrimSpace(cleaned)
	normalized := workspaceTestPrefixPattern.ReplaceAllString(trimmed, "")
	return strings.TrimSpace(normalized)
}

// addTest creates a TestInfo for a completed Vitest test line.
// In Vitest verbose output, each line is a complete test result (no separate start/end lines).
func (p *Parser) addTest(fullName string, result gotest.TestResult, durationMs float64, timestamp time.Time) {
	// Parse hierarchy from " > " separator
	// Example: "src/lib/formatting.test.ts > formatDuration > formats milliseconds under 1s"
	parts := splitTestName(fullName)

	duration := time.Duration(durationMs * float64(time.Millisecond))

	// Extract file path (first segment)
	var filePath string
	if len(parts) > 0 {
		filePath = parts[0]
	}

	// Build the full hierarchical name using " > " as separator (matching Vitest convention)
	testName := fullName

	// Determine parent test name
	parentTest := ""
	if len(parts) > 2 {
		// Parent is everything except the last segment
		parentTest = strings.Join(parts[:len(parts)-1], " > ")
	}

	test := &gotest.TestInfo{
		Name:       testName,
		Package:    filePath,
		ParentTest: parentTest,
		StartTime:  timestamp.Add(-duration),
		EndTime:    timestamp,
		Result:     result,
		Duration:   duration,
		Output:     make([]string, 0),
		Subtests:   make([]*gotest.TestInfo, 0),
	}

	test.SpanID = gotest.GenerateTestSpanID()

	// Build parent-child hierarchy
	p.insertIntoHierarchy(test, parts)

	p.logger.Debug("Parsed vitest test",
		zap.String("test", testName),
		zap.String("result", string(result)),
		zap.Duration("duration", duration),
		zap.String("package", filePath),
	)
}

// insertIntoHierarchy places a test into the correct position in the test tree.
// For Vitest, the hierarchy is: file > describe blocks > test name
// We create intermediate nodes for describe blocks that don't have their own test results.
func (p *Parser) insertIntoHierarchy(test *gotest.TestInfo, parts []string) {
	if len(parts) <= 2 {
		// Direct child of file (or just a file-level test) — add as root test
		p.ctx.RootTests = append(p.ctx.RootTests, test)
		return
	}

	// Find or create parent nodes for intermediate describe blocks
	// parts[0] = file, parts[1] = first describe, ..., parts[n-1] = test name
	// We need to ensure parents exist for parts[0] through parts[n-2]
	parentName := strings.Join(parts[:len(parts)-1], " > ")

	// Look for existing parent in root tests
	parent := p.findOrCreateParent(parts)
	if parent != nil {
		parent.Subtests = append(parent.Subtests, test)
	} else {
		p.logger.Debug("Could not find parent for test, adding as root",
			zap.String("test", test.Name),
			zap.String("parent", parentName),
		)
		p.ctx.RootTests = append(p.ctx.RootTests, test)
	}
}

// findOrCreateParent walks the hierarchy to find or create the parent node.
func (p *Parser) findOrCreateParent(parts []string) *gotest.TestInfo {
	if len(parts) < 2 {
		return nil
	}

	// Walk through the hierarchy creating nodes as needed
	// parts[0] = file path, parts[1..n-2] = describe blocks, parts[n-1] = test
	var currentParent *gotest.TestInfo

	for depth := 1; depth < len(parts)-1; depth++ {
		ancestorName := strings.Join(parts[:depth+1], " > ")

		if currentParent == nil {
			// Looking at root level
			found := false
			for _, root := range p.ctx.RootTests {
				if root.Name == ancestorName {
					currentParent = root
					found = true
					break
				}
			}
			if !found {
				// Create synthetic describe-block node
				node := &gotest.TestInfo{
					Name:     ancestorName,
					Package:  parts[0],
					Output:   make([]string, 0),
					Subtests: make([]*gotest.TestInfo, 0),
				}
				if depth > 1 {
					node.ParentTest = strings.Join(parts[:depth], " > ")
				}
				node.SpanID = gotest.GenerateTestSpanID()
				p.ctx.RootTests = append(p.ctx.RootTests, node)
				currentParent = node
			}
		} else {
			// Looking in children of currentParent
			found := false
			for _, child := range currentParent.Subtests {
				if child.Name == ancestorName {
					currentParent = child
					found = true
					break
				}
			}
			if !found {
				// Create synthetic describe-block node
				node := &gotest.TestInfo{
					Name:       ancestorName,
					Package:    parts[0],
					ParentTest: currentParent.Name,
					Output:     make([]string, 0),
					Subtests:   make([]*gotest.TestInfo, 0),
				}
				node.SpanID = gotest.GenerateTestSpanID()
				currentParent.Subtests = append(currentParent.Subtests, node)
				currentParent = node
			}
		}
	}

	return currentParent
}

// Finalize completes parsing and returns the context with all parsed tests.
func (p *Parser) Finalize() *gotest.TestParseContext {
	// Propagate results upward: set describe-block results based on children
	for _, root := range p.ctx.RootTests {
		propagateResults(root)
	}
	return p.ctx
}

// Context returns the current parse context.
func (p *Parser) Context() *gotest.TestParseContext {
	return p.ctx
}

// propagateResults sets the result of synthetic describe-block nodes based on their children.
func propagateResults(test *gotest.TestInfo) {
	if len(test.Subtests) == 0 {
		return
	}

	// First, recursively propagate for children
	for _, sub := range test.Subtests {
		propagateResults(sub)
	}

	// If this node has no result of its own (synthetic describe block), derive it
	if test.Result == "" {
		hasFailure := false
		allSkipped := true
		var earliest, latest time.Time

		for _, sub := range test.Subtests {
			if sub.Result == gotest.TestResultFail {
				hasFailure = true
			}
			if sub.Result != gotest.TestResultSkip {
				allSkipped = false
			}
			if earliest.IsZero() || (!sub.StartTime.IsZero() && sub.StartTime.Before(earliest)) {
				earliest = sub.StartTime
			}
			if sub.EndTime.After(latest) {
				latest = sub.EndTime
			}
		}

		if hasFailure {
			test.Result = gotest.TestResultFail
		} else if allSkipped {
			test.Result = gotest.TestResultSkip
		} else {
			test.Result = gotest.TestResultPass
		}

		// Set time bounds from children
		if !earliest.IsZero() {
			test.StartTime = earliest
		}
		if !latest.IsZero() {
			test.EndTime = latest
			test.Duration = latest.Sub(earliest)
		}
	}
}

// splitTestName splits a Vitest verbose test name by " > " separator.
// Example: "src/lib/formatting.test.ts > formatDuration > formats ms" ->
//
//	["src/lib/formatting.test.ts", "formatDuration", "formats ms"]
func splitTestName(fullName string) []string {
	parts := strings.Split(fullName, " > ")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
