package sqlhttp

import (
	"strings"
	"testing"
)

func TestSubstituteParamsString(t *testing.T) {
	got, err := substituteParams(
		"SELECT * WHERE x = {q:String}",
		map[string]string{"q": `"hello"`},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "SELECT * WHERE x = 'hello'" {
		t.Fatalf("unexpected sql: %q", got)
	}
}

func TestSubstituteParamsStringEscapes(t *testing.T) {
	got, err := substituteParams(
		"{q:String}",
		map[string]string{"q": `"o'\\reilly"`},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// JSON unescapes `\\` to `\`; ClickHouse-quoted result keeps `\\` and `\'`.
	if got != `'o\'\\reilly'` {
		t.Fatalf("unexpected sql: %q", got)
	}
}

func TestSubstituteParamsControlCharsHex(t *testing.T) {
	got, err := substituteParams(
		"{q:String}",
		map[string]string{"q": `"a\nb"`},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(got, `\x0a`) {
		t.Fatalf("expected newline to be hex-escaped, got %q", got)
	}
}

func TestSubstituteParamsArray(t *testing.T) {
	got, err := substituteParams(
		"levels IN {levels:Array(String)}",
		map[string]string{"levels": `["error","warn"]`},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "levels IN ['error','warn']" {
		t.Fatalf("unexpected sql: %q", got)
	}
}

func TestSubstituteParamsNumbers(t *testing.T) {
	got, err := substituteParams(
		"a = {a:UInt32} AND b = {b:Int64}",
		map[string]string{"a": "42", "b": "-17"},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "a = 42 AND b = -17" {
		t.Fatalf("unexpected sql: %q", got)
	}
}

func TestSubstituteParamsUIntRejectsNegative(t *testing.T) {
	_, err := substituteParams("{a:UInt32}", map[string]string{"a": "-1"})
	if err == nil || !strings.Contains(err.Error(), "non-negative") {
		t.Fatalf("expected non-negative error, got %v", err)
	}
}

func TestSubstituteParamsIntRejectsNonNumeric(t *testing.T) {
	_, err := substituteParams("{a:Int64}", map[string]string{"a": "true"})
	if err == nil || !strings.Contains(err.Error(), "integer") {
		t.Fatalf("expected integer error, got %v", err)
	}
}

func TestSubstituteParamsIntRejectsFloat(t *testing.T) {
	_, err := substituteParams("{a:Int64}", map[string]string{"a": "1.5"})
	if err == nil || !strings.Contains(err.Error(), "integer") {
		t.Fatalf("expected integer error, got %v", err)
	}
}

func TestSubstituteParamsMissing(t *testing.T) {
	_, err := substituteParams("{a:String}", map[string]string{})
	if err == nil || !strings.Contains(err.Error(), "missing parameter") {
		t.Fatalf("expected missing error, got %v", err)
	}
}

func TestSubstituteParamsUnknownType(t *testing.T) {
	_, err := substituteParams("{a:Float64}", map[string]string{"a": "1.5"})
	if err == nil || !strings.Contains(err.Error(), "unsupported parameter type") {
		t.Fatalf("expected unsupported type error, got %v", err)
	}
}

func TestSubstituteParamsTypeMismatch(t *testing.T) {
	_, err := substituteParams("{a:String}", map[string]string{"a": "42"})
	if err == nil || !strings.Contains(err.Error(), "expected JSON string") {
		t.Fatalf("expected type error, got %v", err)
	}
}
