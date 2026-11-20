package recording

import (
	"math"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// maxDepth is the deepest JSON a Body may nest. An rrweb node takes two
// levels (the node and its `childNodes`), so this allows pages about 2000
// elements deep.
const maxDepth = 4096

// maxValues is the most values (every scalar, array and object) a read may
// parse, over all its Bodies. A value takes about 80 bytes here against 2 in
// the text, so this, not the size of the Bodies, bounds the memory of a read.
const maxValues = 4_000_000

// linearKeys: objects longer than this find repeated keys through an index.
const linearKeys = 16

type kind uint8

const (
	jsonNull kind = iota
	jsonBool
	jsonNum
	jsonStr
	jsonArr
	jsonObj
)

// Json is a JSON value as JavaScript's JSON.parse gives it: object keys in
// their order, a repeated key keeping its first place and its last value.
type Json struct {
	kind kind
	b    bool
	n    float64
	s    string
	// The elements of an array (keys empty) or the entries of an object.
	items []member
}

type member struct {
	key   string
	value Json
}

func jsonString(s string) Json { return Json{kind: jsonStr, s: s} }

// get is the value of key in an object, or nil.
func (j *Json) get(key string) *Json {
	if j == nil || j.kind != jsonObj {
		return nil
	}
	for i := range j.items {
		if j.items[i].key == key {
			return &j.items[i].value
		}
	}
	return nil
}

// take moves the value of key out of an object, leaving null in its place.
func (j *Json) take(key string) (Json, bool) {
	value := j.get(key)
	if value == nil {
		return Json{}, false
	}
	out := *value
	*value = Json{}
	return out, true
}

func (j *Json) str() (string, bool) {
	if j == nil || j.kind != jsonStr {
		return "", false
	}
	return j.s, true
}

func (j *Json) num() (float64, bool) {
	if j == nil || j.kind != jsonNum {
		return 0, false
	}
	return j.n, true
}

// id is an rrweb node id: a whole number.
func (j *Json) id() (int64, bool) {
	n, ok := j.num()
	if !ok || n != math.Trunc(n) || math.Abs(n) >= 1<<53 {
		return 0, false
	}
	return int64(n), true
}

// jsString is JavaScript's `String(value)`.
func (j *Json) jsString() string {
	switch j.kind {
	case jsonNull:
		return "null"
	case jsonBool:
		return strconv.FormatBool(j.b)
	case jsonNum:
		return jsNumber(j.n)
	case jsonStr:
		return j.s
	case jsonArr:
		parts := make([]string, len(j.items))
		for i := range j.items {
			if item := &j.items[i].value; item.kind != jsonNull {
				parts[i] = item.jsString()
			}
		}
		return strings.Join(parts, ",")
	default:
		return "[object Object]"
	}
}

// jsNumber is JavaScript's Number#toString.
func jsNumber(n float64) string {
	switch {
	case n == 0:
		return "0"
	case math.IsInf(n, 1):
		return "Infinity"
	case math.IsInf(n, -1):
		return "-Infinity"
	}
	if abs := math.Abs(n); abs >= 1e-6 && abs < 1e21 {
		return strconv.FormatFloat(n, 'f', -1, 64)
	}
	// 1.5e-07 → 1.5e-7, 1e+21 stays.
	mantissa, exponent, _ := strings.Cut(strconv.FormatFloat(n, 'e', -1, 64), "e")
	sign, digits := exponent[:1], strings.TrimLeft(exponent[1:], "0")
	return mantissa + "e" + sign + digits
}

// parseJSON reads one JSON value, or reports false when the text is not JSON,
// nests deeper than maxDepth, or holds more values than are left in budget.
// Each value read takes one from budget, so one budget spans a whole read.
// Strings come out as JavaScript would show them: a lone surrogate escape and
// each invalid UTF-8 byte become U+FFFD. They never share memory with data.
func parseJSON(data string, budget *int) (Json, bool) {
	p := parser{data: data, budget: budget, shared: map[string]string{}}
	p.space()
	value, ok := p.value()
	if !ok {
		return Json{}, false
	}
	p.space()
	return value, p.pos == len(p.data)
}

// A Body repeats the same few keys and short values (`type`, `td`, a run of
// asterisks) hundreds of thousands of times: up to sharedCount of them, of up
// to sharedLen bytes, are stored once.
const (
	sharedLen   = 32
	sharedCount = 4096
)

type parser struct {
	data  string
	pos   int
	depth int
	// How many more values may be read.
	budget *int
	// The items of the arrays and objects being read, innermost last. Each
	// takes an exactly sized copy when it closes.
	open   []member
	shared map[string]string
}

// close gives the items read since start, in a slice of their own.
func (p *parser) close(start int) []member {
	items := make([]member, len(p.open)-start)
	copy(items, p.open[start:])
	clear(p.open[start:])
	p.open = p.open[:start]
	return items
}

func (p *parser) space() {
	for p.pos < len(p.data) {
		switch p.data[p.pos] {
		case ' ', '\t', '\n', '\r':
			p.pos++
		default:
			return
		}
	}
}

func (p *parser) literal(word string) bool {
	if !strings.HasPrefix(p.data[p.pos:], word) {
		return false
	}
	p.pos += len(word)
	return true
}

func (p *parser) value() (Json, bool) {
	if p.pos >= len(p.data) || *p.budget == 0 {
		return Json{}, false
	}
	*p.budget--
	switch c := p.data[p.pos]; {
	case c == '{':
		return p.object()
	case c == '[':
		return p.array()
	case c == '"':
		s, ok := p.string()
		return jsonString(s), ok
	case c == 't':
		return Json{kind: jsonBool, b: true}, p.literal("true")
	case c == 'f':
		return Json{kind: jsonBool}, p.literal("false")
	case c == 'n':
		return Json{}, p.literal("null")
	case c == '-' || (c >= '0' && c <= '9'):
		return p.number()
	default:
		return Json{}, false
	}
}

func (p *parser) enter() bool {
	p.depth++
	p.pos++
	p.space()
	return p.depth <= maxDepth
}

func (p *parser) array() (Json, bool) {
	if !p.enter() {
		return Json{}, false
	}
	if p.pos < len(p.data) && p.data[p.pos] == ']' {
		p.pos++
		p.depth--
		return Json{kind: jsonArr, items: []member{}}, true
	}
	start := len(p.open)
	for {
		item, ok := p.value()
		if !ok {
			return Json{}, false
		}
		p.open = append(p.open, member{value: item})
		p.space()
		if p.pos >= len(p.data) {
			return Json{}, false
		}
		switch p.data[p.pos] {
		case ',':
			p.pos++
			p.space()
		case ']':
			p.pos++
			p.depth--
			return Json{kind: jsonArr, items: p.close(start)}, true
		default:
			return Json{}, false
		}
	}
}

func (p *parser) object() (Json, bool) {
	if !p.enter() {
		return Json{}, false
	}
	if p.pos < len(p.data) && p.data[p.pos] == '}' {
		p.pos++
		p.depth--
		return Json{kind: jsonObj, items: []member{}}, true
	}
	start := len(p.open)
	// Positions in p.open[start:], once the object outgrows a linear search.
	var index map[string]int
	for {
		if p.pos >= len(p.data) || p.data[p.pos] != '"' {
			return Json{}, false
		}
		key, ok := p.string()
		if !ok {
			return Json{}, false
		}
		p.space()
		if p.pos >= len(p.data) || p.data[p.pos] != ':' {
			return Json{}, false
		}
		p.pos++
		p.space()
		value, ok := p.value()
		if !ok {
			return Json{}, false
		}
		items := p.open[start:]
		found := -1
		if index != nil {
			if at, ok := index[key]; ok {
				found = at
			}
		} else {
			for at := range items {
				if items[at].key == key {
					found = at
					break
				}
			}
		}
		if found >= 0 {
			items[found].value = value
		} else {
			if index != nil {
				index[key] = len(items)
			}
			p.open = append(p.open, member{key: key, value: value})
			if items = p.open[start:]; index == nil && len(items) > linearKeys {
				index = make(map[string]int, len(items))
				for at, entry := range items {
					index[entry.key] = at
				}
			}
		}
		p.space()
		if p.pos >= len(p.data) {
			return Json{}, false
		}
		switch p.data[p.pos] {
		case ',':
			p.pos++
			p.space()
		case '}':
			p.pos++
			p.depth--
			return Json{kind: jsonObj, items: p.close(start)}, true
		default:
			return Json{}, false
		}
	}
}

func (p *parser) string() (string, bool) {
	p.pos++ // the opening quote
	start := p.pos
	// Most strings have no escape and are valid UTF-8: slice them whole.
	for p.pos < len(p.data) {
		c := p.data[p.pos]
		if c == '"' {
			raw := p.data[start:p.pos]
			p.pos++
			if utf8.ValidString(raw) {
				return p.share(raw), true
			}
			p.pos = start
			break
		}
		if c == '\\' || c < 0x20 {
			p.pos = start
			break
		}
		p.pos++
	}
	if p.pos != start {
		return "", false
	}
	var out strings.Builder
	for p.pos < len(p.data) {
		c := p.data[p.pos]
		switch {
		case c == '"':
			p.pos++
			return out.String(), true
		case c < 0x20:
			return "", false
		case c == '\\':
			if !p.escape(&out) {
				return "", false
			}
		case c < utf8.RuneSelf:
			out.WriteByte(c)
			p.pos++
		default:
			r, size := utf8.DecodeRuneInString(p.data[p.pos:])
			out.WriteRune(r) // an invalid byte decodes as U+FFFD, size 1
			p.pos += size
		}
	}
	return "", false
}

// share copies raw out of the parsed text, once when it is short.
func (p *parser) share(raw string) string {
	if len(raw) > sharedLen {
		return strings.Clone(raw)
	}
	if s, ok := p.shared[raw]; ok {
		return s
	}
	s := strings.Clone(raw)
	if len(p.shared) < sharedCount {
		p.shared[s] = s
	}
	return s
}

func (p *parser) escape(out *strings.Builder) bool {
	if p.pos+1 >= len(p.data) {
		return false
	}
	c := p.data[p.pos+1]
	p.pos += 2
	switch c {
	case '"', '\\', '/':
		out.WriteByte(c)
	case 'b':
		out.WriteByte('\b')
	case 'f':
		out.WriteByte('\f')
	case 'n':
		out.WriteByte('\n')
	case 'r':
		out.WriteByte('\r')
	case 't':
		out.WriteByte('\t')
	case 'u':
		unit, ok := p.hex4()
		if !ok {
			return false
		}
		r := rune(unit)
		if utf16.IsSurrogate(r) {
			// A high surrogate is whole with a low one right after it; any
			// other surrogate shows as U+FFFD, as it would on the page.
			r = utf8.RuneError
			if unit < 0xDC00 && p.pos+1 < len(p.data) && p.data[p.pos] == '\\' && p.data[p.pos+1] == 'u' {
				saved := p.pos
				p.pos += 2
				low, ok := p.hex4()
				if ok && low >= 0xDC00 && low < 0xE000 {
					r = utf16.DecodeRune(rune(unit), rune(low))
				} else {
					p.pos = saved
				}
			}
		}
		out.WriteRune(r)
	default:
		return false
	}
	return true
}

func (p *parser) hex4() (uint16, bool) {
	if p.pos+4 > len(p.data) {
		return 0, false
	}
	value, err := strconv.ParseUint(p.data[p.pos:p.pos+4], 16, 16)
	if err != nil {
		return 0, false
	}
	p.pos += 4
	return uint16(value), true
}

func (p *parser) number() (Json, bool) {
	start := p.pos
	digits := func() int {
		from := p.pos
		for p.pos < len(p.data) && p.data[p.pos] >= '0' && p.data[p.pos] <= '9' {
			p.pos++
		}
		return p.pos - from
	}
	if p.data[p.pos] == '-' {
		p.pos++
	}
	if p.pos < len(p.data) && p.data[p.pos] == '0' {
		p.pos++
	} else if digits() == 0 {
		return Json{}, false
	}
	if p.pos < len(p.data) && p.data[p.pos] == '.' {
		p.pos++
		if digits() == 0 {
			return Json{}, false
		}
	}
	if p.pos < len(p.data) && (p.data[p.pos] == 'e' || p.data[p.pos] == 'E') {
		p.pos++
		if p.pos < len(p.data) && (p.data[p.pos] == '+' || p.data[p.pos] == '-') {
			p.pos++
		}
		if digits() == 0 {
			return Json{}, false
		}
	}
	// Out of range reads as JavaScript does: ±Infinity or 0.
	n, _ := strconv.ParseFloat(p.data[start:p.pos], 64)
	return Json{kind: jsonNum, n: n}, true
}
