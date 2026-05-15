package sqlhttp

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// paramPrefix is the URL query string prefix for typed query parameters,
// mirroring the ClickHouse HTTP convention.
const paramPrefix = "param_"

var placeholderRE = regexp.MustCompile(`\{(\w+):([A-Za-z0-9()]+)\}`)

// substituteParams renders ClickHouse-style `{name:Type}` placeholders in sql
// using params. Values are JSON-encoded strings (e.g. `"foo"`, `42`, `["a","b"]`)
// to keep typing unambiguous on the wire.
func substituteParams(sql string, params map[string]string) (string, error) {
	var firstErr error
	out := placeholderRE.ReplaceAllStringFunc(sql, func(match string) string {
		if firstErr != nil {
			return match
		}
		sub := placeholderRE.FindStringSubmatch(match)
		name, typ := sub[1], sub[2]
		raw, ok := params[name]
		if !ok {
			firstErr = fmt.Errorf("missing parameter %s", name)
			return match
		}
		rendered, err := renderParam(typ, raw, name)
		if err != nil {
			firstErr = err
			return match
		}
		return rendered
	})
	if firstErr != nil {
		return "", firstErr
	}
	return out, nil
}

func renderParam(typ, raw, name string) (string, error) {
	switch typ {
	case "String":
		var s string
		if err := json.Unmarshal([]byte(raw), &s); err != nil {
			return "", fmt.Errorf("param %s: expected JSON string", name)
		}
		return quoteString(s), nil
	case "UInt32", "UInt64":
		u, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			return "", fmt.Errorf("param %s: %s expects a non-negative integer", name, typ)
		}
		return strconv.FormatUint(u, 10), nil
	case "Int32", "Int64":
		i, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return "", fmt.Errorf("param %s: %s expects an integer", name, typ)
		}
		return strconv.FormatInt(i, 10), nil
	case "Array(String)":
		var arr []string
		if err := json.Unmarshal([]byte(raw), &arr); err != nil {
			return "", fmt.Errorf("param %s: expected JSON array of strings", name)
		}
		parts := make([]string, len(arr))
		for i, v := range arr {
			parts[i] = quoteString(v)
		}
		return "[" + strings.Join(parts, ",") + "]", nil
	}
	return "", fmt.Errorf("unsupported parameter type %s for param %s", typ, name)
}

// quoteString applies ClickHouse's SQL string escape rules: backslash and
// single-quote are backslash-escaped; control characters are rendered as
// \xHH so binary content cannot break out of the literal.
func quoteString(s string) string {
	var b strings.Builder
	b.Grow(len(s) + 2)
	b.WriteByte('\'')
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '\\':
			b.WriteString(`\\`)
		case c == '\'':
			b.WriteString(`\'`)
		case c < 0x20 || c == 0x7f:
			fmt.Fprintf(&b, `\x%02x`, c)
		default:
			b.WriteByte(c)
		}
	}
	b.WriteByte('\'')
	return b.String()
}
