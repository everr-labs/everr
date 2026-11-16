package wrap

import (
	"slices"
	"strings"
	"testing"
)

func recordedBodies(chunks ...string) []string {
	records := make(chan logRecord, 16)
	recorder := streamRecorder{stream: "stdout", records: records}
	for _, chunk := range chunks {
		recorder.record([]byte(chunk))
	}
	recorder.flush()
	close(records)
	var bodies []string
	for record := range records {
		bodies = append(bodies, record.body)
	}
	return bodies
}

func TestRecorderSplitsOutputIntoLines(t *testing.T) {
	got := recordedBodies("first\r\nsec", "ond\n\nthird")
	if want := []string{"first", "second", "", "third"}; !slices.Equal(got, want) {
		t.Fatalf("bodies = %q, want %q", got, want)
	}
}

func TestRecorderCapsLongLines(t *testing.T) {
	chunk := strings.Repeat("x", readBufferSize)
	got := recordedBodies(chunk, chunk, "tail\n")
	if len(got) != 2 || len(got[0]) != maxLogBodyBytes || got[1] != "tail" {
		t.Fatalf("got %d records with lengths %v", len(got), lengths(got))
	}
}

func TestLineBodyReplacesInvalidUTF8(t *testing.T) {
	if got := lineBody([]byte("ok \xff\n")); got != "ok �" {
		t.Fatalf("body = %q", got)
	}
}

func lengths(values []string) []int {
	var out []int
	for _, v := range values {
		out = append(out, len(v))
	}
	return out
}
