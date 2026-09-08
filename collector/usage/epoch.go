package usage

import (
	"context"

	"go.opentelemetry.io/collector/client"
)

// EpochMetadataKey travels in the persistent queue's context, not in telemetry.
const EpochMetadataKey = "x-everr-usage-epoch"

// MarkEnqueued overwrites any client-supplied marker before durable admission.
func (m *Meter) MarkEnqueued(ctx context.Context) context.Context {
	info := client.FromContext(ctx)
	metadata := make(map[string][]string)
	for k := range info.Metadata.Keys() {
		metadata[k] = info.Metadata.Get(k)
	}
	metadata[EpochMetadataKey] = []string{m.instance}
	info.Metadata = client.NewMetadata(metadata)
	return client.NewContext(ctx, info)
}

// RecordConfirmed excludes replayed requests because an earlier process may
// already have published their usage before crashing ahead of queue deletion.
func (m *Meter) RecordConfirmed(ctx context.Context, signal string, bytes map[string]int64) {
	epoch := client.FromContext(ctx).Metadata.Get(EpochMetadataKey)
	if len(epoch) != 1 || epoch[0] != m.instance {
		return
	}
	m.Record(signal, bytes)
}
