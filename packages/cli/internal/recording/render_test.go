package recording

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

var hostile = []string{
	`a" injected="yes`,
	"\x1b[31mred\x1b[0m\x1b]0;title\x07",
	"\u202Eevil\u202C and \u2066isolate\u2069 \u200F",
	"zero\u200Bwidth\u200D\uFEFF\u2060",
	"tag\U000E0041\U000E0042\U000E007Fchars",
	"line\u2028sep\u2029para\r\nnext",
	"c1\u0085control\u009b",
	"vt\vform\ffeed",
}

func invisibleOrControl(c rune) bool {
	switch {
	case c <= 0x1F, c >= 0x7F && c <= 0x9F, c == 0x61C, c >= 0x200B && c <= 0x200F,
		c >= 0x202A && c <= 0x202E, c == 0x2028, c == 0x2029, c >= 0x2060 && c <= 0x2064,
		c >= 0x2066 && c <= 0x2069, c == 0xFEFF, c >= 0xE0000 && c <= 0xE007F:
		return true
	}
	return false
}

func TestQMakesEachHostileValueOneVisibleQuotedValue(t *testing.T) {
	for _, raw := range append(hostile, strings.Repeat("x", 10_000)) {
		value := q(raw, 80)
		var text string
		if err := json.Unmarshal([]byte(value), &text); err != nil {
			t.Fatalf("%s: %v", value, err)
		}
		if strings.ContainsFunc(text, invisibleOrControl) || utf8.RuneCountInString(text) > 80 || strings.ContainsAny(value, "\r\n") {
			t.Errorf("q(%q) = %s", raw, value)
		}
	}
}

func TestQCapsByCodePointsAndMarksTheCut(t *testing.T) {
	var value string
	if err := json.Unmarshal([]byte(q(strings.Repeat("\U0001F600", 100), 10)), &value); err != nil {
		t.Fatal(err)
	}
	if utf8.RuneCountInString(value) != 10 || !strings.HasSuffix(value, "...") {
		t.Fatalf("got %q", value)
	}
}

func TestPathOfDropsTheOriginQueryAndFragment(t *testing.T) {
	for raw, want := range map[string]string{
		"https://shop.example/reset?token=secret#frag": `"/reset"`,
		"/checkout?step=2":                `"/checkout"`,
		"https://shop.example":            `"/"`,
		"https://shop.example/caf%C3%A9":  `"/caf%C3%A9"`,
		"":                                `""`,
		"//shop.example/checkout?token=1": `"/checkout"`,
		"https://user:secret@shop.example/pay#%zz":    `"/pay"`,
		"https://user:secret@shop.example/%zz?step=2": `""`,
	} {
		if got := pathOf(raw); got != want {
			t.Errorf("pathOf(%q) = %s, want %s", raw, got, want)
		}
	}
}

const t0 = 1_794_651_600_000 // 2026-11-14T10:20:00.000Z

func viewOf(lines []string, masked bool) pageView {
	return pageView{lines: lines, totalLines: len(lines), masked: masked}
}

func TestPageAddsTheNotesThatQualifyIt(t *testing.T) {
	got := pageText(t0+3_125, t0+3_000, "/checkout", viewOf([]string{"main"}, true), false)
	want := `page 2026-11-14T10:20:03.125Z (--at +0.13s) url="/checkout" text masked coverage incomplete`
	if first, _, _ := strings.Cut(got, "\n"); first != want {
		t.Fatalf("got %q", first)
	}
	if got := offset(-1_234); got != "-1.23s" {
		t.Fatalf("offset = %s", got)
	}
}

func TestPageKeepsEachHTMLLineOneVisibleLine(t *testing.T) {
	var html []string
	for _, h := range hostile {
		html = append(html, "<p>"+h+"</p>")
	}
	lines := strings.Split(strings.TrimRight(pageText(t0, t0, "/", viewOf(html, false), true), "\n"), "\n")
	if len(lines) != 1+len(html) {
		t.Fatalf("%d lines", len(lines))
	}
	for _, line := range lines {
		if strings.ContainsFunc(line, invisibleOrControl) {
			t.Errorf("%q", line)
		}
	}
}
