package smoke

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Exercise the shipped collector over OTLP and SQL HTTP, including its batch
// processor and real chDB storage. HTTP 200 alone does not prove persistence.
func TestOTLPSpanEventsAndLinksRoundTrip(t *testing.T) {
	binary := resolveCollectorBinary(t)
	if _, err := os.Stat(binary); err != nil {
		if os.Getenv("EVERR_COLLECTOR_BIN") != "" {
			t.Fatalf("configured collector binary unavailable: %v", err)
		}
		t.Skipf("collector binary not built: %v", err)
	}

	otlpPort, healthPort, sqlPort := freeTCPPort(t), freeTCPPort(t), freeTCPPort(t)
	dir := t.TempDir()
	logPath := filepath.Join(dir, "collector.log")
	output, err := os.Create(logPath)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(binary, gatewayArgs(filepath.Join(dir, "chdb"), otlpPort, healthPort, sqlPort)...)
	withChDBLibEnv(t, cmd)
	cmd.Stdout, cmd.Stderr = output, output
	if err := cmd.Start(); err != nil {
		_ = output.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		_ = output.Close()
		if t.Failed() {
			logs, _ := os.ReadFile(logPath)
			t.Logf("collector output:\n%s", logs)
		}
	})
	waitForHTTP(t, fmt.Sprintf("http://127.0.0.1:%d/", healthPort), 10*time.Second)

	payload := strings.ReplaceAll(spanEventsPayload, "$START", strconv.FormatInt(time.Now().UnixNano(), 10))
	payload = strings.ReplaceAll(payload, "$END", strconv.FormatInt(time.Now().Add(time.Millisecond).UnixNano(), 10))
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Post(fmt.Sprintf("http://127.0.0.1:%d/v1/traces", otlpPort), "application/json", strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("OTLP response: status=%d body=%s error=%v", response.StatusCode, body, err)
	}

	// All five spans arrive in one request. A malformed event/link must not
	// discard the control span that has neither events nor links.
	const query = "SELECT SpanName, `Events.Name` AS events, `Events.Attributes` AS event_attrs, `Links.Attributes` AS link_attrs FROM traces WHERE ServiceName = 'span-events-e2e' AND Timestamp > now() - INTERVAL 10 MINUTE ORDER BY SpanName LIMIT 10"
	var expected []map[string]any
	if err := json.Unmarshal([]byte(spanEventsExpected), &expected); err != nil {
		t.Fatal(err)
	}
	var lastBody string
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		response, err = client.Post(fmt.Sprintf("http://127.0.0.1:%d/sql", sqlPort), "text/plain", strings.NewReader(query))
		if err != nil {
			t.Fatal(err)
		}
		body, err = io.ReadAll(response.Body)
		_ = response.Body.Close()
		if err != nil || response.StatusCode != http.StatusOK {
			t.Fatalf("SQL response: status=%d body=%s error=%v", response.StatusCode, body, err)
		}
		lastBody = string(body)
		decoder := json.NewDecoder(strings.NewReader(lastBody))
		var actual []map[string]any
		for {
			var row map[string]any
			if err := decoder.Decode(&row); err == io.EOF {
				break
			} else if err != nil {
				t.Fatal(err)
			}
			actual = append(actual, row)
		}
		if len(actual) == len(expected) {
			if !reflect.DeepEqual(expected, actual) {
				t.Fatalf("stored events/links differ:\nexpected: %s\nactual: %s", spanEventsExpected, body)
			}
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("OTLP returned 200 but the five-span batch was not persisted: %s", lastBody)
}

const spanEventsPayload = `{
  "resourceSpans": [{
    "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "span-events-e2e"}}]},
    "scopeSpans": [{"spans": [
      {"traceId":"01000000000000000000000000000000","spanId":"0100000000000000","name":"control","startTimeUnixNano":"$START","endTimeUnixNano":"$END"},
      {"traceId":"01000000000000000000000000000000","spanId":"0200000000000000","name":"empty-event","startTimeUnixNano":"$START","endTimeUnixNano":"$END",
       "events":[{"name":"empty","timeUnixNano":"$START"}]},
      {"traceId":"01000000000000000000000000000000","spanId":"0300000000000000","name":"empty-link","startTimeUnixNano":"$START","endTimeUnixNano":"$END",
       "links":[{"traceId":"02000000000000000000000000000000","spanId":"0100000000000000"}]},
      {"traceId":"01000000000000000000000000000000","spanId":"0400000000000000","name":"event","startTimeUnixNano":"$START","endTimeUnixNano":"$END",
       "events":[{"name":"job completed","timeUnixNano":"$START","attributes":[
         {"key":"bullmq.job.id","value":{"stringValue":"test-job"}},
         {"key":"everr.test.attempt","value":{"intValue":"42"}},
         {"key":"everr.test.completed","value":{"boolValue":true}},
         {"key":"everr.test.progress","value":{"doubleValue":0.5}},
         {"key":"everr.test.result","value":{"stringValue":"{\"ok\":true}"}},
         {"key":"everr.test.tags","value":{"arrayValue":{"values":[{"stringValue":"done"}]}}}
       ]},{"name":"empty","timeUnixNano":"$START"}]},
      {"traceId":"01000000000000000000000000000000","spanId":"0500000000000000","name":"link","startTimeUnixNano":"$START","endTimeUnixNano":"$END",
       "links":[{"traceId":"02000000000000000000000000000000","spanId":"0100000000000000","attributes":[
         {"key":"everr.test.link","value":{"boolValue":true}}
       ]}]}
    ]}]
  }]
}`

const spanEventsExpected = `[
  {"SpanName":"control","events":[],"event_attrs":[],"link_attrs":[]},
  {"SpanName":"empty-event","events":["empty"],"event_attrs":[{}],"link_attrs":[]},
  {"SpanName":"empty-link","events":[],"event_attrs":[],"link_attrs":[{}]},
  {"SpanName":"event","events":["job completed","empty"],"event_attrs":[{"bullmq":{"job":{"id":"test-job"}},"everr":{"test":{"attempt":42,"completed":true,"progress":0.5,"result":"{\"ok\":true}","tags":["done"]}}},{}],"link_attrs":[]},
  {"SpanName":"link","events":[],"event_attrs":[],"link_attrs":[{"everr":{"test":{"link":true}}}]}
]`
