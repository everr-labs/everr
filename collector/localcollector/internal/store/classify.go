package store

import "strings"

type statementKind int

const (
	runLocally statementKind = iota
	accessControl
)

// Access control, which embedded chDB has no users or roles for, is GRANT,
// REVOKE, SET ROLE, SET DEFAULT ROLE, and CREATE, ALTER or DROP applied to
// USER, ROLE, ROW POLICY, POLICY, SETTINGS PROFILE, PROFILE or QUOTA.
func classify(statement string) statementKind {
	words := leadingWords(statement, 3)
	if len(words) == 0 {
		return runLocally
	}
	switch words[0] {
	case "GRANT", "REVOKE":
		return accessControl
	case "SET":
		if hasPrefix(words[1:], "ROLE") || hasPrefix(words[1:], "DEFAULT", "ROLE") {
			return accessControl
		}
	case "CREATE", "ALTER", "DROP":
		for _, entity := range [][]string{
			{"USER"}, {"ROLE"}, {"ROW", "POLICY"}, {"POLICY"},
			{"SETTINGS", "PROFILE"}, {"PROFILE"}, {"QUOTA"},
		} {
			if hasPrefix(words[1:], entity...) {
				return accessControl
			}
		}
	}
	return runLocally
}

func hasPrefix(words []string, prefix ...string) bool {
	if len(words) < len(prefix) {
		return false
	}
	for i, want := range prefix {
		if words[i] != want {
			return false
		}
	}
	return true
}

func leadingWords(statement string, limit int) []string {
	words := make([]string, 0, limit)
	rest := statement
	for len(words) < limit {
		rest = strings.TrimLeftFunc(rest, isSpace)
		if rest == "" {
			break
		}
		end := strings.IndexFunc(rest, isSpace)
		if end < 0 {
			end = len(rest)
		}
		words = append(words, strings.ToUpper(rest[:end]))
		rest = rest[end:]
	}
	return words
}

func isSpace(r rune) bool {
	return r == ' ' || r == '\t' || r == '\n' || r == '\r'
}
