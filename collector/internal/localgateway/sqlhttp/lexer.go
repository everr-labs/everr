package sqlhttp

import (
	"errors"
	"strings"
)

var (
	ErrEmpty          = errors.New("sqlhttp: empty query")
	ErrNotReadOnly    = errors.New("sqlhttp: only SELECT/WITH/EXPLAIN/DESCRIBE/DESC/SHOW allowed")
	ErrMultiStatement = errors.New("sqlhttp: multi-statement queries are not allowed")
)

var allowedFirstTokens = map[string]struct{}{
	"SELECT":   {},
	"WITH":     {},
	"EXPLAIN":  {},
	"DESCRIBE": {},
	"DESC":     {},
	"SHOW":     {},
}

func ValidateReadOnly(sql string) error {
	l := lexer{src: sql}
	l.skipWhitespaceAndComments()

	for l.peek() == '(' {
		l.pos++
		l.skipWhitespaceAndComments()
	}

	word := l.readWord()
	if word == "" {
		return ErrEmpty
	}
	if _, ok := allowedFirstTokens[strings.ToUpper(word)]; !ok {
		return ErrNotReadOnly
	}

	for l.pos < len(l.src) {
		if err := l.step(); err != nil {
			return err
		}
	}

	return nil
}

type lexer struct {
	src string
	pos int
}

func (l *lexer) peek() byte {
	if l.pos >= len(l.src) {
		return 0
	}
	return l.src[l.pos]
}

func (l *lexer) readWord() string {
	start := l.pos
	for l.pos < len(l.src) {
		c := l.src[l.pos]
		if !isWordChar(c) {
			break
		}
		l.pos++
	}
	return l.src[start:l.pos]
}

func (l *lexer) step() error {
	switch {
	case l.skipWhitespace():
		return nil
	case strings.HasPrefix(l.src[l.pos:], "--"):
		l.skipLineComment()
		return nil
	case strings.HasPrefix(l.src[l.pos:], "/*"):
		l.skipBlockComment()
		return nil
	case l.peek() == '\'':
		l.skipSingleQuoted()
		return nil
	case l.peek() == '"':
		l.skipDelimited('"')
		return nil
	case l.peek() == '`':
		l.skipDelimited('`')
		return nil
	case l.peek() == ';':
		l.pos++
		save := l.pos
		l.skipWhitespaceAndComments()
		if l.pos >= len(l.src) {
			return nil
		}
		l.pos = save
		return ErrMultiStatement
	default:
		l.pos++
		return nil
	}
}

func (l *lexer) skipWhitespaceAndComments() {
	for {
		switch {
		case l.skipWhitespace():
		case l.pos < len(l.src) && strings.HasPrefix(l.src[l.pos:], "--"):
			l.skipLineComment()
		case l.pos < len(l.src) && strings.HasPrefix(l.src[l.pos:], "/*"):
			l.skipBlockComment()
		default:
			return
		}
	}
}

func (l *lexer) skipWhitespace() bool {
	start := l.pos
	for l.pos < len(l.src) {
		switch l.src[l.pos] {
		case ' ', '\t', '\n', '\r', '\f', '\v':
			l.pos++
		default:
			return l.pos != start
		}
	}
	return l.pos != start
}

func (l *lexer) skipLineComment() {
	for l.pos < len(l.src) && l.src[l.pos] != '\n' {
		l.pos++
	}
}

func (l *lexer) skipBlockComment() {
	l.pos += 2
	for l.pos+1 < len(l.src) {
		if l.src[l.pos] == '*' && l.src[l.pos+1] == '/' {
			l.pos += 2
			return
		}
		l.pos++
	}
	l.pos = len(l.src)
}

func (l *lexer) skipSingleQuoted() {
	l.pos++
	for l.pos < len(l.src) {
		switch l.src[l.pos] {
		case '\\':
			if l.pos+1 < len(l.src) {
				l.pos += 2
				continue
			}
			l.pos++
		case '\'':
			if l.pos+1 < len(l.src) && l.src[l.pos+1] == '\'' {
				l.pos += 2
				continue
			}
			l.pos++
			return
		default:
			l.pos++
		}
	}
}

func (l *lexer) skipDelimited(delim byte) {
	l.pos++
	for l.pos < len(l.src) {
		if l.src[l.pos] == '\\' && l.pos+1 < len(l.src) {
			l.pos += 2
			continue
		}
		if l.src[l.pos] == delim {
			l.pos++
			return
		}
		l.pos++
	}
}

func isWordChar(c byte) bool {
	return c == '_' ||
		(c >= 'a' && c <= 'z') ||
		(c >= 'A' && c <= 'Z') ||
		(c >= '0' && c <= '9')
}
