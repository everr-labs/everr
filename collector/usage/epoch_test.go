package usage

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/client"
	"go.uber.org/zap"
)

func TestReplayAndSpoofedEpochDoNotCount(t *testing.T) {
	m := newMeter(Config{MaxSeries: 10, RetentionDays: 1}, zap.NewNop())
	spoof := client.NewContext(context.Background(), client.Info{Metadata: client.NewMetadata(map[string][]string{EpochMetadataKey: {"client-guess"}, "preserve": {"value"}})})
	m.RecordConfirmed(spoof, "logs", map[string]int64{"a": 100})
	md, _ := m.Drain()
	require.Zero(t, md.DataPointCount())
	current := m.MarkEnqueued(spoof)
	require.Equal(t, []string{"value"}, client.FromContext(current).Metadata.Get("preserve"))
	m.RecordConfirmed(current, "logs", map[string]int64{"a": 100})
	md, _ = m.Drain()
	require.Equal(t, int64(100), totalValue(md))
	restarted := newMeter(m.cfg, zap.NewNop())
	restarted.RecordConfirmed(current, "logs", map[string]int64{"a": 100})
	md, _ = restarted.Drain()
	require.Zero(t, md.DataPointCount())
}
