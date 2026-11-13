package wrap

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/everr-labs/everr/packages/cli/internal/build"
	"github.com/everr-labs/everr/packages/cli/internal/cmdutil"
)

const (
	batchSize            = 64
	readBufferSize       = 8 * 1024
	maxLogBodyBytes      = 16 * 1024
	flushInterval        = 200 * time.Millisecond
	exportTimeout        = 5 * time.Second
	exportDrainTimeout   = time.Second
	collectorUnavailable = "telemetry collector isn't running — run `everr local start`"
)

// NewCommand builds `everr wrap`.
func NewCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "wrap",
		Short: "Run a command and capture its output as local logs",
		RunE: func(cmd *cobra.Command, args []string) error {
			return run(cmd.Context(), args)
		},
	}
	// Everything from the first positional on belongs to the wrapped command,
	// flags included, so `everr wrap cargo test --foo` passes --foo through.
	cmd.Flags().SetInterspersed(false)
	cmdutil.Positionals(cmd, cmdutil.Arg{Name: "COMMAND", Help: "Command and arguments to run", Variadic: true})
	// stdout carries the wrapped command's output untouched.
	cmdutil.SetHumanStdout(cmd, func(*cobra.Command, bool) bool { return false })
	return cmd
}

func run(ctx context.Context, argv []string) error {
	command := newWrappedCommand(argv)
	exporter := newExporter(command)
	if err := exporter.probe(ctx); err != nil {
		fmt.Fprintln(os.Stderr, collectorUnavailable)
		return cmdutil.Exit(2)
	}

	// With a SIGPIPE handler installed, writes to a closed stdout return EPIPE
	// instead of killing wrap; the child still gets the default disposition.
	sigpipe := make(chan os.Signal, 1)
	signal.Notify(sigpipe, syscall.SIGPIPE)
	defer signal.Stop(sigpipe)

	stdoutR, stdoutW, err := os.Pipe()
	if err != nil {
		return fmt.Errorf("capture wrapped stdout: %w", err)
	}
	stderrR, stderrW, err := os.Pipe()
	if err != nil {
		stdoutR.Close()
		stdoutW.Close()
		return fmt.Errorf("capture wrapped stderr: %w", err)
	}
	child := exec.Command(command.program, command.args...)
	child.Stdin = os.Stdin
	child.Stdout, child.Stderr = stdoutW, stderrW
	startErr := child.Start()
	stdoutW.Close()
	stderrW.Close()
	if startErr != nil {
		stdoutR.Close()
		stderrR.Close()
		return fmt.Errorf("run wrapped command `%s`: %w", command.display, startErr)
	}
	stopRelay := relaySignals(child.Process)
	defer stopRelay()

	records := make(chan logRecord, batchSize*4)
	exported := make(chan error, 1)
	go func() { exported <- exportRecords(exporter, records) }()

	var forwarders sync.WaitGroup
	forwardErrs := make([]error, 2)
	forwarders.Go(func() { forwardErrs[0] = forwardStream(stdoutR, os.Stdout, "stdout", records) })
	forwarders.Go(func() { forwardErrs[1] = forwardStream(stderrR, os.Stderr, "stderr", records) })

	waitErr := child.Wait()
	forwarders.Wait()
	if _, exited := errors.AsType[*exec.ExitError](waitErr); waitErr != nil && !exited {
		return fmt.Errorf("wait for wrapped command: %w", waitErr)
	}
	if err := errors.Join(forwardErrs...); err != nil {
		return err
	}

	code := exitCode(child.ProcessState)
	tryQueue(records, exitRecord(code))
	close(records)

	select {
	case err := <-exported:
		if err != nil {
			fmt.Fprintf(os.Stderr, "everr wrap: failed to send some logs to the local collector: %v\n", err)
		}
	case <-time.After(exportDrainTimeout):
		fmt.Fprintln(os.Stderr, "everr wrap: timed out sending some logs to the local collector")
	}

	if code == 0 {
		return nil
	}
	return cmdutil.Exit(code)
}

// relaySignals keeps wrap alive until the child exits so its last logs and
// exit code are still reported. SIGINT and SIGQUIT come from the terminal,
// which already delivers them to the child's process group, so relaying them
// would signal the child twice; SIGTERM and SIGHUP are sent to wrap alone.
func relaySignals(process *os.Process) (stop func()) {
	signals := make(chan os.Signal, 4)
	signal.Notify(signals, os.Interrupt, syscall.SIGQUIT, syscall.SIGTERM, syscall.SIGHUP)
	done := make(chan struct{})
	go func() {
		for {
			select {
			case sig := <-signals:
				if sig == syscall.SIGTERM || sig == syscall.SIGHUP {
					_ = process.Signal(sig)
				}
			case <-done:
				return
			}
		}
	}()
	return func() {
		signal.Stop(signals)
		close(done)
	}
}

func exitCode(state *os.ProcessState) int {
	if code := state.ExitCode(); code >= 0 {
		return code
	}
	if status, ok := state.Sys().(syscall.WaitStatus); ok && status.Signaled() {
		return 128 + int(status.Signal())
	}
	return 1
}

func forwardStream(reader *os.File, writer io.Writer, stream string, records chan<- logRecord) error {
	defer reader.Close()
	recorder := streamRecorder{stream: stream, records: records}
	buf := make([]byte, readBufferSize)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			chunk := buf[:n]
			if _, werr := writer.Write(chunk); werr != nil {
				// The consumer went away (`everr wrap ... | head`). Closing the
				// read end lets the child hit SIGPIPE the way it would unwrapped.
				if errors.Is(werr, syscall.EPIPE) {
					return nil
				}
				return fmt.Errorf("write wrapped %s: %w", stream, werr)
			}
			recorder.record(chunk)
		}
		if err == io.EOF {
			recorder.flush()
			return nil
		}
		if err != nil {
			return fmt.Errorf("read wrapped %s: %w", stream, err)
		}
	}
}

type streamRecorder struct {
	stream  string
	records chan<- logRecord
	pending []byte
}

func (r *streamRecorder) record(chunk []byte) {
	for len(chunk) > 0 {
		end := bytes.IndexByte(chunk, '\n') + 1
		if end == 0 {
			end = len(chunk)
		}
		part := chunk[:end]
		chunk = chunk[end:]
		r.pending = append(r.pending, part...)
		if part[len(part)-1] == '\n' || len(r.pending) >= maxLogBodyBytes {
			r.flush()
		}
	}
}

func (r *streamRecorder) flush() {
	if len(r.pending) == 0 {
		return
	}
	tryQueue(r.records, lineRecord(r.stream, r.pending))
	r.pending = r.pending[:0]
}

// tryQueue drops the record when the exporter is behind, so a slow collector
// never throttles the wrapped command's output.
func tryQueue(records chan<- logRecord, record logRecord) {
	select {
	case records <- record:
	default:
	}
}

func exportRecords(exporter *exporter, records <-chan logRecord) error {
	batch := make([]logRecord, 0, batchSize)
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()
	var firstErr error
	flush := func() {
		if len(batch) == 0 {
			return
		}
		if err := exporter.send(batch); err != nil && firstErr == nil {
			firstErr = err
		}
		batch = make([]logRecord, 0, batchSize)
	}
	for {
		select {
		case record, ok := <-records:
			if !ok {
				flush()
				return firstErr
			}
			batch = append(batch, record)
			if len(batch) >= batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

type wrappedCommand struct {
	program string
	args    []string
	display string
}

func newWrappedCommand(argv []string) wrappedCommand {
	return wrappedCommand{program: argv[0], args: argv[1:], display: strings.Join(argv, " ")}
}

func (c wrappedCommand) serviceName() string {
	return "everr-wrap-" + c.program
}

type exporter struct {
	http     *http.Client
	endpoint string
	command  wrappedCommand
}

func newExporter(command wrappedCommand) *exporter {
	return &exporter{
		http:     &http.Client{Timeout: exportTimeout},
		endpoint: build.OTLPHTTPOrigin() + "/v1/logs",
		command:  command,
	}
}

func (e *exporter) probe(ctx context.Context) error {
	return e.post(ctx, otlpLogs{ResourceLogs: []resourceLogs{}})
}

func (e *exporter) send(records []logRecord) error {
	if len(records) == 0 {
		return nil
	}
	return e.post(context.Background(), e.payload(records))
}

func (e *exporter) post(ctx context.Context, payload otlpLogs) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("POST %s: %w", e.endpoint, err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.http.Do(req)
	if err != nil {
		return fmt.Errorf("POST %s: %w", e.endpoint, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode <= 299 {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	text, _ := io.ReadAll(resp.Body)
	return fmt.Errorf("collector returned %s: %s", resp.Status, text)
}

// OTLP/JSON log export request, limited to the fields wrap sends.
type otlpLogs struct {
	ResourceLogs []resourceLogs `json:"resourceLogs"`
}

type resourceLogs struct {
	Resource  otlpResource `json:"resource"`
	ScopeLogs []scopeLogs  `json:"scopeLogs"`
}

type otlpResource struct {
	Attributes []keyValue `json:"attributes"`
}

type scopeLogs struct {
	Scope      otlpScope    `json:"scope"`
	LogRecords []otlpRecord `json:"logRecords"`
}

type otlpScope struct {
	Name string `json:"name"`
}

type otlpRecord struct {
	TimeUnixNano         string     `json:"timeUnixNano"`
	ObservedTimeUnixNano string     `json:"observedTimeUnixNano"`
	SeverityText         string     `json:"severityText"`
	SeverityNumber       int        `json:"severityNumber"`
	Body                 anyValue   `json:"body"`
	Attributes           []keyValue `json:"attributes"`
}

type keyValue struct {
	Key   string   `json:"key"`
	Value anyValue `json:"value"`
}

type anyValue struct {
	StringValue string `json:"stringValue"`
}

func attr(key, value string) keyValue {
	return keyValue{Key: key, Value: anyValue{StringValue: value}}
}

func (e *exporter) payload(records []logRecord) otlpLogs {
	logRecords := make([]otlpRecord, 0, len(records))
	for _, record := range records {
		attrs := []keyValue{
			attr("everr.wrap.stream", record.stream),
			attr("everr.wrap.command", e.command.display),
			attr("everr.wrap.executable", e.command.program),
		}
		if record.exitCode != nil {
			attrs = append(attrs, attr("everr.wrap.exit_code", strconv.Itoa(*record.exitCode)))
		}
		logRecords = append(logRecords, otlpRecord{
			TimeUnixNano:         record.timeUnixNano,
			ObservedTimeUnixNano: record.timeUnixNano,
			SeverityText:         record.severityText,
			SeverityNumber:       record.severityNumber,
			Body:                 anyValue{StringValue: record.body},
			Attributes:           attrs,
		})
	}
	return otlpLogs{ResourceLogs: []resourceLogs{{
		Resource: otlpResource{Attributes: []keyValue{attr("service.name", e.command.serviceName())}},
		ScopeLogs: []scopeLogs{{
			Scope:      otlpScope{Name: "everr-cli.wrap"},
			LogRecords: logRecords,
		}},
	}}}
}

type logRecord struct {
	timeUnixNano   string
	stream         string
	severityText   string
	severityNumber int
	body           string
	exitCode       *int
}

func lineRecord(stream string, line []byte) logRecord {
	text, number := "INFO", 9
	if stream == "stderr" {
		text, number = "ERROR", 17
	}
	return logRecord{
		timeUnixNano:   nowUnixNano(),
		stream:         stream,
		severityText:   text,
		severityNumber: number,
		body:           lineBody(line),
	}
}

func exitRecord(code int) logRecord {
	text, number := "INFO", 9
	if code != 0 {
		text, number = "ERROR", 17
	}
	return logRecord{
		timeUnixNano:   nowUnixNano(),
		stream:         "exit",
		severityText:   text,
		severityNumber: number,
		body:           fmt.Sprintf("wrapped command exited with code %d", code),
		exitCode:       &code,
	}
}

func lineBody(line []byte) string {
	line = bytes.TrimSuffix(line, []byte("\n"))
	line = bytes.TrimSuffix(line, []byte("\r"))
	return strings.ToValidUTF8(string(line), "�")
}

func nowUnixNano() string {
	return strconv.FormatInt(time.Now().UnixNano(), 10)
}
