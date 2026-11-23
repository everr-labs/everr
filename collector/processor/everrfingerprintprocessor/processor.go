package everrfingerprintprocessor

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/processor"
	"go.opentelemetry.io/collector/processor/processorhelper"
)

const (
	typeStr = "everr_fingerprint"

	// FingerprintKey is where the processor writes an Error's identity.
	FingerprintKey = "everr.error.fingerprint"
	// clientFingerprintKey lets an application choose the identity itself.
	clientFingerprintKey = "error.fingerprint"

	// SeverityNumber ERROR and above.
	minErrorSeverity = plog.SeverityNumberError
)

type Config struct{}

func NewFactory() processor.Factory {
	return processor.NewFactory(
		component.MustNewType(typeStr),
		func() component.Config { return &Config{} },
		processor.WithLogs(createLogs, component.StabilityLevelDevelopment),
	)
}

func createLogs(ctx context.Context, set processor.Settings, cfg component.Config, next consumer.Logs) (processor.Logs, error) {
	return processorhelper.NewLogs(ctx, set, cfg, next, processLogs,
		processorhelper.WithCapabilities(consumer.Capabilities{MutatesData: true}))
}

func processLogs(_ context.Context, ld plog.Logs) (plog.Logs, error) {
	for _, rl := range ld.ResourceLogs().All() {
		serviceName, hasService := rl.Resource().Attributes().Get("service.name")
		for _, sl := range rl.ScopeLogs().All() {
			for _, lr := range sl.LogRecords().All() {
				attrs := lr.Attributes()
				// Only the processor writes the key, so a client cannot
				// file its logs under another Error.
				attrs.Remove(FingerprintKey)
				if !hasService || lr.SeverityNumber() < minErrorSeverity {
					continue
				}
				_, hasType := attrs.Get("exception.type")
				_, hasMessage := attrs.Get("exception.message")
				if !hasType && !hasMessage {
					continue
				}
				attrs.PutStr(FingerprintKey, errorFingerprint(
					serviceName.AsString(),
					text(attrs, clientFingerprintKey),
					text(attrs, "exception.type"),
					text(attrs, "exception.message"),
				))
			}
		}
	}
	return ld, nil
}

// text reads an attribute the way the UDF's callers do with toString: typed
// values as their text, a missing key as ”.
func text(attrs pcommon.Map, key string) string {
	v, ok := attrs.Get(key)
	if !ok {
		return ""
	}
	return v.AsString()
}
