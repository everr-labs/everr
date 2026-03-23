package rusttest

import (
	"regexp"
	"strconv"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/everr-labs/everr/collector/connector/testlogstotraces/gotest"
)

var (
	testResultPattern    = regexp.MustCompile(`^test\s+(.+?)\s+\.\.\.\s+(ok|FAILED(?:\s+\([^)]+\))?|ignored(?:,.*)?)(?:\s+<([0-9.]+)s>)?$`)
	runningTargetPattern = regexp.MustCompile(`^Running\s+.+?\s+\((.+)\)$`)
	docTestsPattern      = regexp.MustCompile(`^Doc-tests\s+(\S+)$`)
	ansiPattern          = regexp.MustCompile(`\x1b\[[0-9;]*m`)
)

// Parser processes cargo test output and extracts Rust test information.
type Parser struct {
	ctx            *gotest.TestParseContext
	logger         *zap.Logger
	currentPackage string
}

// NewParser creates a new Parser for processing cargo test output.
func NewParser(ctx *gotest.TestParseContext, logger *zap.Logger) *Parser {
	return &Parser{
		ctx:    ctx,
		logger: logger,
	}
}

// ProcessLine parses a single log line for Rust test output.
func (p *Parser) ProcessLine(line string, timestamp time.Time) {
	trimmed := normalizeLine(line)
	if trimmed == "" {
		return
	}

	if matches := runningTargetPattern.FindStringSubmatch(trimmed); matches != nil {
		p.currentPackage = extractTargetName(matches[1])
		return
	}

	if matches := docTestsPattern.FindStringSubmatch(trimmed); matches != nil {
		p.currentPackage = matches[1]
		return
	}

	if matches := testResultPattern.FindStringSubmatch(trimmed); matches != nil {
		fullName := strings.TrimSpace(matches[1])
		result := parseResult(matches[2])
		duration := parseDuration(matches[3])
		p.addTest(fullName, result, duration, timestamp)
	}
}

func normalizeLine(line string) string {
	cleaned := ansiPattern.ReplaceAllString(line, "")
	return strings.TrimSpace(cleaned)
}

func parseResult(raw string) gotest.TestResult {
	switch {
	case raw == "ok":
		return gotest.TestResultPass
	case strings.HasPrefix(raw, "FAILED"):
		return gotest.TestResultFail
	case strings.HasPrefix(raw, "ignored"):
		return gotest.TestResultSkip
	default:
		return gotest.TestResultPass
	}
}

func parseDuration(raw string) time.Duration {
	if raw == "" {
		return 0
	}

	seconds, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0
	}

	return time.Duration(seconds * float64(time.Second))
}

func (p *Parser) addTest(fullName string, result gotest.TestResult, duration time.Duration, timestamp time.Time) {
	parts := splitTestName(fullName)
	parentTest := ""
	if len(parts) > 1 {
		parentTest = strings.Join(parts[:len(parts)-1], "::")
	}

	test := &gotest.TestInfo{
		Name:       fullName,
		Package:    p.currentPackage,
		ParentTest: parentTest,
		StartTime:  timestamp.Add(-duration),
		EndTime:    timestamp,
		Result:     result,
		Duration:   duration,
		Output:     make([]string, 0),
		Subtests:   make([]*gotest.TestInfo, 0),
	}
	test.SpanID = gotest.GenerateTestSpanID()

	p.insertIntoHierarchy(test, parts)

	p.logger.Debug("Parsed rust test",
		zap.String("test", fullName),
		zap.String("result", string(result)),
		zap.Duration("duration", duration),
		zap.String("package", p.currentPackage),
	)
}

func (p *Parser) insertIntoHierarchy(test *gotest.TestInfo, parts []string) {
	if len(parts) <= 1 {
		p.ctx.RootTests = append(p.ctx.RootTests, test)
		return
	}

	parent := p.findOrCreateParent(parts, test.Package)
	if parent != nil {
		parent.Subtests = append(parent.Subtests, test)
		return
	}

	p.ctx.RootTests = append(p.ctx.RootTests, test)
}

func (p *Parser) findOrCreateParent(parts []string, pkg string) *gotest.TestInfo {
	if len(parts) < 2 {
		return nil
	}

	var currentParent *gotest.TestInfo

	for depth := 1; depth < len(parts); depth++ {
		ancestorName := strings.Join(parts[:depth], "::")

		if currentParent == nil {
			found := false
			for _, root := range p.ctx.RootTests {
				if root.Name == ancestorName && root.Package == pkg {
					currentParent = root
					found = true
					break
				}
			}
			if !found {
				node := &gotest.TestInfo{
					Name:     ancestorName,
					Package:  pkg,
					Output:   make([]string, 0),
					Subtests: make([]*gotest.TestInfo, 0),
				}
				node.SpanID = gotest.GenerateTestSpanID()
				p.ctx.RootTests = append(p.ctx.RootTests, node)
				currentParent = node
			}
			continue
		}

		found := false
		for _, child := range currentParent.Subtests {
			if child.Name == ancestorName && child.Package == pkg {
				currentParent = child
				found = true
				break
			}
		}
		if found {
			continue
		}

		node := &gotest.TestInfo{
			Name:       ancestorName,
			Package:    pkg,
			ParentTest: currentParent.Name,
			Output:     make([]string, 0),
			Subtests:   make([]*gotest.TestInfo, 0),
		}
		node.SpanID = gotest.GenerateTestSpanID()
		currentParent.Subtests = append(currentParent.Subtests, node)
		currentParent = node
	}

	return currentParent
}

// Finalize completes parsing and returns the context with all parsed tests.
func (p *Parser) Finalize() *gotest.TestParseContext {
	for _, root := range p.ctx.RootTests {
		propagateResults(root)
	}
	return p.ctx
}

// Context returns the current parse context.
func (p *Parser) Context() *gotest.TestParseContext {
	return p.ctx
}

func propagateResults(test *gotest.TestInfo) {
	if len(test.Subtests) == 0 {
		return
	}

	var earliest, latest time.Time
	hasFail := false
	hasNonSkip := false

	for _, sub := range test.Subtests {
		propagateResults(sub)
		if sub.Result == gotest.TestResultFail {
			hasFail = true
		}
		if sub.Result != gotest.TestResultSkip {
			hasNonSkip = true
		}
		if earliest.IsZero() || (!sub.StartTime.IsZero() && sub.StartTime.Before(earliest)) {
			earliest = sub.StartTime
		}
		if sub.EndTime.After(latest) {
			latest = sub.EndTime
		}
	}

	switch {
	case hasFail:
		test.Result = gotest.TestResultFail
	case !hasNonSkip:
		test.Result = gotest.TestResultSkip
	default:
		test.Result = gotest.TestResultPass
	}

	if !earliest.IsZero() {
		test.StartTime = earliest
	}
	if !latest.IsZero() {
		test.EndTime = latest
		test.Duration = latest.Sub(earliest)
	}
}

func splitTestName(name string) []string {
	return strings.Split(name, "::")
}

func extractTargetName(executablePath string) string {
	base := executablePath
	if idx := strings.LastIndexAny(base, `/\`); idx >= 0 && idx < len(base)-1 {
		base = base[idx+1:]
	}

	base = strings.TrimSuffix(base, ".exe")
	if idx := strings.LastIndex(base, "-"); idx > 0 {
		return base[:idx]
	}
	return base
}
