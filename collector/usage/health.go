package usage

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const (
	discardedVolumeName     = "everr.usage.discarded.volume"
	publicationFailuresName = "everr.usage.publication.failed"
)

type health struct {
	discarded           metric.Int64Counter
	publicationFailures metric.Int64Counter
}

func newHealth(provider metric.MeterProvider) (*health, error) {
	meter := provider.Meter("github.com/everr-labs/everr/collector/usage")
	discarded, err := meter.Int64Counter(discardedVolumeName,
		metric.WithUnit("By"), metric.WithDescription("Accepted ingestion bytes excluded from usage accounting before publication"))
	if err != nil {
		return nil, err
	}
	failures, err := meter.Int64Counter(publicationFailuresName,
		metric.WithUnit("1"), metric.WithDescription("Failed usage publication attempts, including ambiguous writes; not proof of missing usage"))
	if err != nil {
		return nil, err
	}
	return &health{discarded: discarded, publicationFailures: failures}, nil
}

func (m *Meter) recordDiscarded(signal, reason string, bytes int64) {
	if m.health == nil || bytes <= 0 {
		return
	}
	m.health.discarded.Add(context.Background(), bytes, metric.WithAttributes(
		attribute.String("everr.ingestion.signal", signal), attribute.String("everr.usage.discard.reason", reason)))
}

// RecordPublicationFailure reports an unsuccessful attempt, not lost billable bytes:
// storage may have committed the snapshot before its acknowledgement was lost.
func (m *Meter) RecordPublicationFailure() {
	if m.health != nil {
		m.health.publicationFailures.Add(context.Background(), 1)
	}
}
