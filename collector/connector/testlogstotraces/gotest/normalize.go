package gotest

import (
	"regexp"
	"strings"
)

var (
	ansiPattern                = regexp.MustCompile(`\x1b\[[0-9;]*m`)
	workspaceTestPrefixPattern = regexp.MustCompile(`^[^:]+\s+test:\s+`)
)

// NormalizeLine strips CI formatting that is unrelated to the underlying test output.
func NormalizeLine(line string) string {
	cleaned := ansiPattern.ReplaceAllString(line, "")
	trimmed := strings.TrimSpace(cleaned)
	normalized := workspaceTestPrefixPattern.ReplaceAllString(trimmed, "")
	return strings.TrimSpace(normalized)
}
