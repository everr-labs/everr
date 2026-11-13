package query

import (
	"strings"
	"testing"
)

func TestRenderKeepsNumberDigitsAndSortsColumns(t *testing.T) {
	rows, err := ParseNDJSON("{\"b\":18446744073709551615,\"a\":\"x<y\"}\n\n{\"a\":null,\"b\":1.50}\n")
	if err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	if err := Render(&out, rows, FormatNDJSON); err != nil {
		t.Fatal(err)
	}
	if want := "{\"a\":\"x<y\",\"b\":18446744073709551615}\n{\"a\":null,\"b\":1.50}\n"; out.String() != want {
		t.Fatalf("ndjson = %q", out.String())
	}
	out.Reset()
	_ = Render(&out, rows, FormatTable)
	if want := "a | b\nx<y | 18446744073709551615\n | 1.50\n"; out.String() != want {
		t.Fatalf("table = %q", out.String())
	}
}

func TestRenderTableWithoutRows(t *testing.T) {
	var out strings.Builder
	_ = Render(&out, Rows{}, FormatTable)
	if out.String() != "(no rows)\n" {
		t.Fatalf("table = %q", out.String())
	}
}
