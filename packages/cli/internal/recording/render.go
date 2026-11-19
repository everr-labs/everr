package recording

// The text `recording show` prints: one header line, then the page. A value
// from a browser is quoted on one line with control and invisible characters
// removed, so an element is always one line and a terminal shows what the
// page had.

import (
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

// Quoted text and attribute values stop here, in code points.
const (
	textCap = 80
	urlCap  = 120
)

// jsSpace is JavaScript's `\s`.
func jsSpace(c rune) bool {
	switch {
	case c >= 0x09 && c <= 0x0D, c == 0x20, c == 0xA0, c == 0x1680,
		c >= 0x2000 && c <= 0x200A, c == 0x2028, c == 0x2029, c == 0x202F,
		c == 0x205F, c == 0x3000, c == 0xFEFF:
		return true
	}
	return false
}

// invisible: C0 controls other than whitespace, DEL and C1 controls, soft
// hyphen, the Arabic letter mark, zero-width and bidi controls, invisible
// operators, the byte order mark, interlinear annotations, Unicode tag
// characters, and the supplementary variation selectors used to hide data.
func invisible(c rune) bool {
	switch {
	case c <= 0x08, c >= 0x0E && c <= 0x1F, c >= 0x7F && c <= 0x9F, c == 0xAD,
		c == 0x61C, c == 0x180E, c >= 0x200B && c <= 0x200F, c >= 0x202A && c <= 0x202E,
		c >= 0x2060 && c <= 0x2064, c >= 0x2066 && c <= 0x2069, c == 0xFEFF,
		c >= 0xFFF9 && c <= 0xFFFB, c >= 0xE0000 && c <= 0xE007F, c >= 0xE0100 && c <= 0xE01EF:
		return true
	}
	return false
}

func visible(raw string) string {
	return strings.Map(func(c rune) rune {
		if invisible(c) {
			return -1
		}
		return c
	}, raw)
}

// collapse gives whitespace runs as one space, trimmed: JavaScript's
// `text.replace(/\s+/g, " ").trim()`.
func collapse(text string) string {
	return strings.Join(strings.FieldsFunc(text, jsSpace), " ")
}

// q is the JSON string literal of raw: nothing invisible, whitespace
// collapsed, at most max code points.
func q(raw string, max int) string {
	text := collapse(visible(raw))
	if utf8.RuneCountInString(text) > max {
		text = string([]rune(text)[:max-3]) + "..."
	}
	return quote(text)
}

// quote writes text as a JSON string literal.
func quote(text string) string {
	var out strings.Builder
	out.WriteByte('"')
	for _, c := range text {
		switch c {
		case '"':
			out.WriteString(`\"`)
		case '\\':
			out.WriteString(`\\`)
		case '\n':
			out.WriteString(`\n`)
		case '\r':
			out.WriteString(`\r`)
		case '\t':
			out.WriteString(`\t`)
		case '\b':
			out.WriteString(`\b`)
		case '\f':
			out.WriteString(`\f`)
		default:
			if c < 0x20 {
				fmt.Fprintf(&out, `\u%04x`, c)
			} else {
				out.WriteRune(c)
			}
		}
	}
	out.WriteByte('"')
	return out.String()
}

// pathOf is the path of a page URL, quoted: no origin, query (reset tokens,
// ids), or fragment. A URL that does not parse prints as empty, because its
// text can hold the host and credentials.
func pathOf(raw string) string {
	if cut := strings.IndexAny(raw, "?#"); cut >= 0 {
		raw = raw[:cut]
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return q("", urlCap)
	}
	path := raw
	switch {
	case parsed.Opaque != "":
		path = parsed.Opaque
	case parsed.Scheme != "" || parsed.Host != "":
		path = parsed.EscapedPath()
		if path == "" {
			path = "/"
		}
	}
	return q(path, urlCap)
}

// pageText is `page <time> (--at +<offset>) url=<path>`, the notes that
// qualify the page (`text masked`, `coverage incomplete`), then one line per
// element.
func pageText(readMs, atMs int64, pageURL string, view pageView, complete bool) string {
	var out strings.Builder
	fmt.Fprintf(&out, "page %s (--at %s) url=%s", iso(readMs), offset(readMs-atMs), pathOf(pageURL))
	if view.masked {
		out.WriteString(" text masked")
	}
	if !complete {
		out.WriteString(" coverage incomplete")
	}
	out.WriteByte('\n')
	if len(view.lines) == 0 {
		out.WriteString("(empty: no full snapshot before this moment)\n")
	}
	for _, line := range view.lines {
		// An HTML line holds page text as recorded: keep it one visible line.
		out.WriteString(strings.Map(func(c rune) rune {
			switch {
			case c >= 0x0A && c <= 0x0D, c == 0x2028, c == 0x2029:
				return ' '
			}
			return c
		}, visible(line)))
		out.WriteByte('\n')
	}
	return out.String()
}

func iso(ms int64) string {
	return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

// offset gives milliseconds as signed seconds to two places: `+0.75s`.
func offset(ms int64) string {
	sign := '+'
	abs := uint64(ms)
	if ms < 0 {
		sign = '-'
		abs = uint64(-ms)
	}
	hundredths := (abs + 5) / 10
	return fmt.Sprintf("%c%d.%02ds", sign, hundredths/100, hundredths%100)
}
