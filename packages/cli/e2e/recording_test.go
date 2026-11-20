package e2e

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// pageEvents is the Body of a Segment holding a page with an h1, read at readMs.
func pageEvents(readMs int64, heading string) string {
	events, _ := json.Marshal([]any{
		map[string]any{"type": 4, "timestamp": readMs - 2_000, "data": map[string]any{"href": "https://shop.example/cart?id=7"}},
		map[string]any{"type": 2, "timestamp": readMs - 1_990, "data": map[string]any{"node": map[string]any{
			"type": 0, "id": 1, "childNodes": []any{
				map[string]any{"type": 2, "id": 2, "tagName": "body", "attributes": map[string]any{}, "childNodes": []any{
					map[string]any{"type": 2, "id": 3, "tagName": "h1", "attributes": map[string]any{}, "childNodes": []any{
						map[string]any{"type": 3, "id": 4, "textContent": heading},
					}},
				}},
			},
		}}},
	})
	return string(events)
}

func segmentRow(index int, body string) string {
	row, _ := json.Marshal(map[string]any{"segment_index": index, "Body": body, "event_index": "", "piece": "", "pieces": ""})
	return string(row)
}

// segmentsBody is a segments response: one Segment holding a page with an
// h1, read at readMs.
func segmentsBody(t *testing.T, readMs int64, heading string) string {
	t.Helper()
	return fmt.Sprintf("{\"format\":1,\"read_ms\":%d}\n%s\n{\"rows\":1}\n", readMs, segmentRow(0, pageEvents(readMs, heading)))
}

// 2026-11-14T10:21:42.480Z
const readMs = 1_794_651_702_480

// segmentsServer answers GET /api/cli/recordings/segments with status, body
// and headers, and records each request.
type segmentsServer struct {
	*httptest.Server
	mu   sync.Mutex
	seen []*http.Request
}

func newSegmentsServer(t *testing.T, status int, body []byte, headers map[string]string) *segmentsServer {
	t.Helper()
	s := &segmentsServer{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/cli/recordings/segments" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
			return
		}
		s.mu.Lock()
		s.seen = append(s.seen, r.Clone(r.Context()))
		s.mu.Unlock()
		for name, value := range headers {
			w.Header().Set(name, value)
		}
		w.WriteHeader(status)
		w.Write(body)
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *segmentsServer) requests() []*http.Request {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.seen
}

func recordingEnv(t *testing.T, srv *segmentsServer) *Env {
	env := NewEnv(t)
	env.WriteSession(srv.URL, "token-rec")
	return env
}

func TestRecordingShowSendsTheStreamAndEpochAtAsISOMillisAndPrintsThePage(t *testing.T) {
	srv := newSegmentsServer(t, 200, []byte(segmentsBody(t, readMs, "Cart")), map[string]string{"Content-Type": "application/x-ndjson"})

	res := recordingEnv(t, srv).Run("cloud", "recording", "show", "--stream", "a/b c", "--at", "1794651701730").Success(t)

	if want := "page 2026-11-14T10:21:42.480Z (--at +0.75s) url=\"/cart\"\nh1 \"Cart\"\n"; res.Stdout != want {
		t.Errorf("stdout:\n%s\nwant:\n%s", res.Stdout, want)
	}
	seen := srv.requests()
	if len(seen) != 1 {
		t.Fatalf("%d requests", len(seen))
	}
	r := seen[0]
	if got := r.URL.Query(); got.Get("stream") != "a/b c" || got.Get("at") != "2026-11-14T10:21:41.730Z" {
		t.Errorf("query = %v", got)
	}
	if r.Header.Get("Authorization") != "Bearer token-rec" || !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		t.Errorf("headers = %v", r.Header)
	}
}

func TestRecordingShowReadsSegmentsWithAnEmptyBodyAsNoEventsAndNoGap(t *testing.T) {
	// A Clip opens and closes with a Segment, which holds [] when nothing was unsent.
	body := fmt.Sprintf("{\"format\":1,\"read_ms\":%d}\n%s\n%s\n%s\n{\"rows\":3}\n",
		readMs, segmentRow(0, "[]"), segmentRow(1, pageEvents(readMs, "Cart")), segmentRow(2, "[]"))
	srv := newSegmentsServer(t, 200, []byte(body), nil)

	res := recordingEnv(t, srv).Run("cloud", "recording", "show", "--stream", "s", "--at", "1794651701730").Success(t)

	if want := "page 2026-11-14T10:21:42.480Z (--at +0.75s) url=\"/cart\"\nh1 \"Cart\"\n"; res.Stdout != want {
		t.Errorf("stdout:\n%s\nwant:\n%s", res.Stdout, want)
	}
}

func TestRecordingShowReadsAGzippedAnswerAndPrintsHTMLOnRequest(t *testing.T) {
	var gz bytes.Buffer
	w := gzip.NewWriter(&gz)
	io.WriteString(w, segmentsBody(t, readMs, "Cart"))
	w.Close()
	srv := newSegmentsServer(t, 200, gz.Bytes(), map[string]string{"Content-Encoding": "gzip"})

	res := recordingEnv(t, srv).Run("cloud", "recording", "show", "--stream", "s", "--at", "1794651701730", "--html").Success(t)

	if want := "page 2026-11-14T10:21:42.480Z (--at +0.75s) url=\"/cart\"\n<body>\n  <h1>Cart</h1>\n</body>\n"; res.Stdout != want {
		t.Errorf("stdout:\n%s\nwant:\n%s", res.Stdout, want)
	}
}

func TestRecordingPageTextNeverCarriesTerminalEscapes(t *testing.T) {
	srv := newSegmentsServer(t, 200, []byte(segmentsBody(t, readMs, "\x1b[31mred\x1b[0m clip\x1b]0;owned\x07")), nil)

	res := recordingEnv(t, srv).Run("cloud", "recording", "show", "--stream", "s", "--at", "1794651701730").Success(t)

	assertContains(t, res.Stdout, `h1 "[31mred[0m clip]0;owned"`)
	assertNotContains(t, res.Stdout, "\x1b", "\x07")
}

func TestRecordingShowRefusesAnAnswerCutShortOrInAnUnknownFormat(t *testing.T) {
	whole := segmentsBody(t, readMs, "Cart")
	cut := whole[:strings.LastIndex(strings.TrimRight(whole, "\n"), "\n")]
	for body, says := range map[string]string{
		cut: "cut short",
		strings.Replace(whole, `"format":1`, `"format":2`, 1): "upgrade`",
	} {
		srv := newSegmentsServer(t, 200, []byte(body), nil)
		res := recordingEnv(t, srv).Run("cloud", "recording", "show", "--stream", "s", "--at", "now").Failure(t, 1)
		if res.Stdout != "" {
			t.Errorf("stdout = %q", res.Stdout)
		}
		assertContains(t, res.Stderr, says)
	}
}

func TestRecordingErrors(t *testing.T) {
	for _, tc := range []struct {
		name           string
		status         int
		body           string
		want, unwanted []string
	}{
		{
			name:     "a JSON error prints the server's message, not the JSON",
			status:   404,
			body:     `{"error":"outside_clip","message":"No clip covers --at. Nearest: 2026-11-14T10:00:00.000Z to 2026-11-14T10:01:00.000Z."}`,
			want:     []string{"No clip covers --at. Nearest:"},
			unwanted: []string{`{"error"`, "outside_clip", "upgrade"},
		},
		{
			name:     "a 401 asks to log in again",
			status:   401,
			body:     `{"error":"unauthorized","message":"nope"}`,
			want:     []string{"cloud login"},
			unwanted: []string{"nope"},
		},
		{
			name:     "an HTML error page is left out, with a login hint",
			status:   500,
			body:     "<!DOCTYPE html><html>" + strings.Repeat("x", 36_000) + "</html>",
			want:     []string{"CLI recording request failed with 500", "an HTML error page (36", "run `everr cloud login`"},
			unwanted: []string{"xxxx", "upgrade"},
		},
		{
			name:     "a text error body is one bounded line",
			status:   502,
			body:     "bad\ngateway " + strings.Repeat("y", 1_000),
			want:     []string{"bad gateway yyy"},
			unwanted: []string{strings.Repeat("y", 400)},
		},
		{
			name:   "a 404 without a JSON body hints at an upgrade",
			status: 404,
			body:   "Not Found",
			want:   []string{"CLI recording request failed with 404", "may predate `everr cloud recording`", "upgrade it"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := newSegmentsServer(t, tc.status, []byte(tc.body), nil)
			res := recordingEnv(t, srv).Run("cloud", "recording", "show", "--stream", "s", "--at", "now").Failure(t, 1)
			assertContains(t, res.Stderr, tc.want...)
			assertNotContains(t, res.Stderr, tc.unwanted...)
		})
	}
}

func TestRecordingRefusesABadAtBeforeAnyRequest(t *testing.T) {
	for at, says := range map[string][]string{
		"2026-11-14 10:21:41": {"--at", "no time zone", "toUnixTimestamp64Milli(Timestamp)"},
		"12345":               {"--at", "13 digits"},
		"yesterday":           {"--at", "RFC 3339", "date math"},
	} {
		srv := newSegmentsServer(t, 200, nil, nil)
		res := recordingEnv(t, srv).Run("cloud", "recording", "show", "--stream", "s", "--at", at).Failure(t, 1)
		assertContains(t, res.Stderr, says...)
		if n := len(srv.requests()); n != 0 {
			t.Errorf("%s: %d requests", at, n)
		}
	}
}

func TestRecordingShowRequiresAStreamAndAMoment(t *testing.T) {
	env := NewEnv(t)
	for _, args := range [][]string{
		{"cloud", "recording", "show"},
		{"cloud", "recording", "show", "--stream", "s"},
		{"cloud", "recording", "show", "--at", "now"},
	} {
		res := env.Run(args...).Failure(t, 2)
		assertContains(t, res.Stderr, "the following required arguments were not provided")
	}
	for _, flag := range []string{"--clip", "--trace", "--session", "--limit"} {
		res := env.Run("cloud", "recording", "show", "--stream", "s", "--at", "now", flag).Failure(t, 2)
		assertContains(t, res.Stderr, "unexpected argument '"+flag+"'")
	}
	assertContains(t, env.Run("cloud", "recording", "list").Failure(t, 2).Stderr, "unrecognized subcommand 'list'")
	assertContains(t, env.Run("local", "recording", "show").Failure(t, 2).Stderr, "unrecognized subcommand 'recording'")
}

func TestRecordingHelp(t *testing.T) {
	env := NewEnv(t)
	assertContains(t, env.Run("cloud", "--help").Success(t).Stdout, "recording", "Read recordings of browser pages")
	assertContains(t, env.Run("cloud", "recording", "--help").Success(t).Stdout, "remote installation", "show")
	out := env.Run("cloud", "recording", "show", "--help").Success(t).Stdout
	assertContains(t, out, "--stream <STREAM>", "--at <AT>", "--html", "everr cloud query")
	assertNotContains(t, out, "--clip", "--limit")
}
