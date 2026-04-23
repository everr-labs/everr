package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRenderTableEmitsMarkdownTable(t *testing.T) {
	cols := []Column{
		{Name: "Timestamp", Type: "DateTime64(9)"},
		{Name: "Attributes", Type: "Map(LowCardinality(String), String)"},
		{Name: "SeverityText", Type: "LowCardinality(String)"},
	}
	got := RenderTable("otel_logs", cols)
	want := `## otel_logs

| column | type |
|---|---|
| Timestamp | DateTime64(9) |
| Attributes | Map(LowCardinality(String), String) |
| SeverityText | LowCardinality(String) |
`
	if got != want {
		t.Fatalf("diff:\nGOT:\n%s\nWANT:\n%s", got, want)
	}
}

func TestDescribeParsesJSONEachRow(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		_, _ = w.Write([]byte(
			`{"name":"Timestamp","type":"DateTime64(9)"}` + "\n" +
				`{"name":"Body","type":"String"}` + "\n",
		))
	}))
	defer srv.Close()

	cols, err := describe(srv.URL, "otel_logs")
	if err != nil {
		t.Fatalf("describe returned error: %v", err)
	}

	if len(cols) != 2 {
		t.Fatalf("len(cols) = %d, want 2", len(cols))
	}
	if cols[0].Name != "Timestamp" || cols[0].Type != "DateTime64(9)" {
		t.Fatalf("first column = %+v", cols[0])
	}
	if cols[1].Name != "Body" || cols[1].Type != "String" {
		t.Fatalf("second column = %+v", cols[1])
	}
}
