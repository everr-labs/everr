package recording

import (
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
)

func unlimited() *int {
	n := math.MaxInt
	return &n
}

func mustParse(t *testing.T, text string) Json {
	t.Helper()
	value, ok := parseJSON(text, unlimited())
	if !ok {
		t.Fatalf("not JSON: %.80s", text)
	}
	return value
}

func keysOf(value Json) []string {
	var keys []string
	for _, entry := range value.items {
		keys = append(keys, entry.key)
	}
	return keys
}

func TestParseKeepsKeyOrderAndTakesTheLastOfARepeatedKey(t *testing.T) {
	value := mustParse(t, `{"b":1,"a":2,"b":3}`)
	if got := keysOf(value); !reflect.DeepEqual(got, []string{"b", "a"}) {
		t.Fatalf("keys = %q", got)
	}
	if n, _ := value.get("b").num(); n != 3 {
		t.Fatalf("b = %v", n)
	}

	var long []string
	for i := range 40 {
		long = append(long, fmt.Sprintf(`"k%d":%d`, i, i))
	}
	value = mustParse(t, "{"+strings.Join(long, ",")+`,"k3":99}`)
	if len(value.items) != 40 || value.items[3].key != "k3" {
		t.Fatalf("entries = %d, fourth %q", len(value.items), value.items[3].key)
	}
	if n, _ := value.items[3].value.num(); n != 99 {
		t.Fatalf("k3 = %v", n)
	}
}

func TestParseReplacesLoneSurrogatesAndKeepsPairs(t *testing.T) {
	value := mustParse(t, `["a\ud800b", "\udc00", "\ud83d\ude00", "\\ud800", "\ud800\ud800", "\ud800\u0041"]`)
	var got []string
	for _, item := range value.items {
		s, _ := item.value.str()
		got = append(got, s)
	}
	want := []string{"a\uFFFDb", "\uFFFD", "\U0001F600", `\ud800`, "\uFFFD\uFFFD", "\uFFFDA"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestParseRefusesJSONDeeperThanTheBound(t *testing.T) {
	deep := func(n int) string { return strings.Repeat("[", n) + strings.Repeat("]", n) }
	nodes := func(n int) string {
		return strings.Repeat(`{"type":2,"childNodes":[`, n) + strings.Repeat("]}", n)
	}
	for _, tc := range []struct {
		text string
		ok   bool
	}{
		{deep(maxDepth), true},
		{nodes(maxDepth / 2), true},
		{deep(maxDepth + 1), false},
		{deep(1_000_000), false},
		// Brackets inside strings do not count.
		{`"` + strings.Repeat("[", 10_000) + `"`, true},
	} {
		if _, ok := parseJSON(tc.text, unlimited()); ok != tc.ok {
			t.Errorf("parse %.40s... = %v, want %v", tc.text, ok, tc.ok)
		}
	}
}

func TestParseReadsInvalidUTF8AsReplacementCharacters(t *testing.T) {
	value := mustParse(t, "[\"a\xffb\"]")
	if s, _ := value.items[0].value.str(); s != "a\uFFFDb" {
		t.Fatalf("got %q", s)
	}
}

func TestParseRefusesWhatJSONParseRefuses(t *testing.T) {
	for _, text := range []string{
		"", "not json", "[1,]", `{"a":1,}`, `{"a" 1}`, "[1 2]", "01", "1.", "-", ".5", "1e",
		`"a` + "\n" + `b"`, `"\x"`, `"\u12"`, "[1] x", "tru", "nul", `{1:2}`, `"abc`,
	} {
		if _, ok := parseJSON(text, unlimited()); ok {
			t.Errorf("parsed %q", text)
		}
	}
	for _, text := range []string{" [ 1 , -0.5e+2 , true , null , \"\\/\\b\" ] ", "{}", "[]", `""`, "1E400"} {
		if _, ok := parseJSON(text, unlimited()); !ok {
			t.Errorf("refused %q", text)
		}
	}
}

func TestJSStringIsJavaScriptsString(t *testing.T) {
	for text, want := range map[string]string{
		`null`:               "null",
		`true`:               "true",
		`120`:                "120",
		`-0`:                 "0",
		`0.1`:                "0.1",
		`1e21`:               "1e+21",
		`1.5e-7`:             "1.5e-7",
		`123456789012345`:    "123456789012345",
		`1E400`:              "Infinity",
		`"x"`:                "x",
		`[1,null,"a",[2,3]]`: "1,,a,2,3",
		`{"a":1}`:            "[object Object]",
	} {
		value := mustParse(t, text)
		if got := value.jsString(); got != want {
			t.Errorf("String(%s) = %q, want %q", text, got, want)
		}
	}
}

func TestParseStopsWhenTheBudgetIsSpentAcrossBodies(t *testing.T) {
	left := 5
	if _, ok := parseJSON(`[1,2]`, &left); !ok || left != 2 {
		t.Fatalf("first: ok %v, %d left", ok, left)
	}
	if _, ok := parseJSON(`[1,2]`, &left); ok {
		t.Fatal("a body over the budget parsed")
	}
	if _, ok := parseJSON(`7`, &left); ok {
		t.Fatal("a body with the budget spent parsed")
	}
}
