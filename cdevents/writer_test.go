package main

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"
)

type fakeInserter struct {
	mu       sync.Mutex
	batches  [][]eventRow
	failures int
}

func (i *fakeInserter) Insert(_ context.Context, rows []eventRow) error {
	i.mu.Lock()
	defer i.mu.Unlock()

	if i.failures > 0 {
		i.failures--
		return errors.New("temporary failure")
	}

	batch := append([]eventRow(nil), rows...)
	i.batches = append(i.batches, batch)
	return nil
}

func (i *fakeInserter) Close() error { return nil }

func TestBufferedWriterFlushesOnBatchSize(t *testing.T) {
	t.Parallel()

	inserter := &fakeInserter{}
	writer := newBufferedWriter(inserter, config{
		BatchSize:       2,
		FlushInterval:   time.Hour,
		FlushRetryDelay: 10 * time.Millisecond,
	}, zap.NewNop())
	defer func() { _ = writer.Close() }()

	if err := writer.WriteRows([]eventRow{{DeliveryID: "1"}}); err != nil {
		t.Fatalf("write rows: %v", err)
	}
	if err := writer.WriteRows([]eventRow{{DeliveryID: "2"}}); err != nil {
		t.Fatalf("write rows: %v", err)
	}

	waitForBatches(t, inserter, 1)
}

func TestBufferedWriterFlushesOnTimer(t *testing.T) {
	t.Parallel()

	inserter := &fakeInserter{}
	writer := newBufferedWriter(inserter, config{
		BatchSize:       10,
		FlushInterval:   20 * time.Millisecond,
		FlushRetryDelay: 10 * time.Millisecond,
	}, zap.NewNop())
	defer func() { _ = writer.Close() }()

	if err := writer.WriteRows([]eventRow{{DeliveryID: "1"}}); err != nil {
		t.Fatalf("write rows: %v", err)
	}

	waitForBatches(t, inserter, 1)
}

func TestBufferedWriterRetriesAfterTransientFailure(t *testing.T) {
	t.Parallel()

	inserter := &fakeInserter{failures: 1}
	writer := newBufferedWriter(inserter, config{
		BatchSize:       10,
		FlushInterval:   15 * time.Millisecond,
		FlushRetryDelay: 10 * time.Millisecond,
	}, zap.NewNop())
	defer func() { _ = writer.Close() }()

	if err := writer.WriteRows([]eventRow{{DeliveryID: "1"}}); err != nil {
		t.Fatalf("write rows: %v", err)
	}

	waitForBatches(t, inserter, 1)
}

func TestBufferedWriterCloseFlushesPendingRows(t *testing.T) {
	t.Parallel()

	inserter := &fakeInserter{}
	writer := newBufferedWriter(inserter, config{
		BatchSize:       10,
		FlushInterval:   time.Hour,
		FlushRetryDelay: 10 * time.Millisecond,
	}, zap.NewNop())

	if err := writer.WriteRows([]eventRow{{DeliveryID: "1"}}); err != nil {
		t.Fatalf("write rows: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	waitForBatches(t, inserter, 1)
}

func waitForBatches(t *testing.T, inserter *fakeInserter, want int) {
	t.Helper()

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		inserter.mu.Lock()
		got := len(inserter.batches)
		inserter.mu.Unlock()
		if got >= want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	inserter.mu.Lock()
	defer inserter.mu.Unlock()
	t.Fatalf("expected at least %d batches, got %d", want, len(inserter.batches))
}
