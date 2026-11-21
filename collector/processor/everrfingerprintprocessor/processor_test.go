package everrfingerprintprocessor

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/consumer/consumertest"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/processor/processortest"
)

func newLog(t *testing.T, ld plog.Logs, severity plog.SeverityNumber, attrs map[string]any) {
	lr := ld.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().AppendEmpty()
	lr.SetSeverityNumber(severity)
	require.NoError(t, lr.Attributes().FromRaw(attrs))
}

func process(t *testing.T, ld plog.Logs) []plog.LogRecord {
	t.Helper()
	sink := &consumertest.LogsSink{}
	f := NewFactory()
	p, err := f.CreateLogs(t.Context(), processortest.NewNopSettings(f.Type()), f.CreateDefaultConfig(), sink)
	require.NoError(t, err)
	require.NoError(t, p.ConsumeLogs(t.Context(), ld))
	var out []plog.LogRecord
	for _, lr := range sink.AllLogs()[0].ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().All() {
		out = append(out, lr)
	}
	return out
}

func fingerprintOf(lr plog.LogRecord) (string, bool) {
	v, ok := lr.Attributes().Get(FingerprintKey)
	if !ok {
		return "", false
	}
	return v.Str(), true
}

func logsFor(service string) plog.Logs {
	ld := plog.NewLogs()
	rl := ld.ResourceLogs().AppendEmpty()
	if service != "" {
		rl.Resource().Attributes().PutStr("service.name", service)
	}
	rl.ScopeLogs().AppendEmpty()
	return ld
}

func TestFingerprintsErrorLogs(t *testing.T) {
	ld := logsFor("checkout")
	newLog(t, ld, plog.SeverityNumberError, map[string]any{"exception.type": "TypeError", "exception.message": "order 1234567 failed"})
	newLog(t, ld, plog.SeverityNumberFatal, map[string]any{"exception.type": "TypeError", "exception.message": "order 7654321 failed"})
	newLog(t, ld, plog.SeverityNumberError, map[string]any{"exception.message": "x", "error.fingerprint": "chosen-by-app"})

	out := process(t, ld)
	first, ok := fingerprintOf(out[0])
	require.True(t, ok)
	second, _ := fingerprintOf(out[1])
	require.Equal(t, first, second, "ids in the message do not split an Error")
	third, _ := fingerprintOf(out[2])
	require.Equal(t, "chosen-by-app", third)
}

func TestSkipsLogsThatAreNotErrors(t *testing.T) {
	ld := logsFor("checkout")
	newLog(t, ld, plog.SeverityNumberWarn, map[string]any{"exception.type": "TypeError"})
	newLog(t, ld, plog.SeverityNumberError, map[string]any{"http.route": "/"})
	newLog(t, ld, plog.SeverityNumberError, map[string]any{"exception.type": "TypeError", FingerprintKey: "forged"})
	noService := logsFor("")
	newLog(t, noService, plog.SeverityNumberError, map[string]any{"exception.type": "TypeError", FingerprintKey: "forged"})

	out := process(t, ld)
	for _, lr := range out[:2] {
		_, ok := fingerprintOf(lr)
		require.False(t, ok)
	}
	got, _ := fingerprintOf(out[2])
	require.NotEqual(t, "forged", got)

	_, ok := fingerprintOf(process(t, noService)[0])
	require.False(t, ok, "a client-sent fingerprint is removed")
}

// The usage meter runs before this processor and bills only what the exporter
// admits, so a rejected batch must come back as an error.
func TestReturnsTheExporterError(t *testing.T) {
	rejected := errors.New("queue full")
	f := NewFactory()
	p, err := f.CreateLogs(t.Context(), processortest.NewNopSettings(f.Type()), f.CreateDefaultConfig(), consumertest.NewErr(rejected))
	require.NoError(t, err)
	ld := logsFor("checkout")
	newLog(t, ld, plog.SeverityNumberError, map[string]any{"exception.type": "TypeError"})
	require.ErrorIs(t, p.ConsumeLogs(t.Context(), ld), rejected)
}
