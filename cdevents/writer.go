package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"go.uber.org/zap"
)

type rowInserter interface {
	Insert(context.Context, []eventRow) error
	Close() error
}

type bufferedWriter struct {
	inserter      rowInserter
	batchSize     int
	flushInterval time.Duration
	retryDelay    time.Duration
	logger        *zap.Logger

	mu     sync.Mutex
	rows   []eventRow
	closed bool

	flushNow chan struct{}
	stop     chan chan error
}

func newBufferedWriter(inserter rowInserter, cfg config, logger *zap.Logger) *bufferedWriter {
	w := &bufferedWriter{
		inserter:      inserter,
		batchSize:     cfg.BatchSize,
		flushInterval: cfg.FlushInterval,
		retryDelay:    cfg.FlushRetryDelay,
		logger:        logger,
		flushNow:      make(chan struct{}, 1),
		stop:          make(chan chan error),
	}
	go w.run()
	return w
}

func (w *bufferedWriter) WriteRows(rows []eventRow) error {
	if len(rows) == 0 {
		return nil
	}

	var flushRows []eventRow

	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return fmt.Errorf("writer closed")
	}
	w.rows = append(w.rows, rows...)
	if len(w.rows) >= w.batchSize {
		flushRows = append(flushRows, w.rows...)
		w.rows = nil
	}
	w.mu.Unlock()

	if len(flushRows) == 0 {
		return nil
	}

	if err := w.flush(context.Background(), flushRows); err != nil {
		w.requeue(flushRows)
		w.requestFlush()
		return err
	}

	return nil
}

func (w *bufferedWriter) Close() error {
	reply := make(chan error, 1)
	w.stop <- reply
	return <-reply
}

func (w *bufferedWriter) run() {
	timer := time.NewTimer(w.flushInterval)
	defer timer.Stop()

	delay := w.flushInterval

	for {
		select {
		case <-timer.C:
			err := w.flushPending()
			if err != nil {
				delay = w.retryDelay
			} else {
				delay = w.flushInterval
			}
			timer.Reset(delay)
		case <-w.flushNow:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			err := w.flushPending()
			if err != nil {
				delay = w.retryDelay
			} else {
				delay = w.flushInterval
			}
			timer.Reset(delay)
		case reply := <-w.stop:
			w.mu.Lock()
			w.closed = true
			rows := append([]eventRow(nil), w.rows...)
			w.rows = nil
			w.mu.Unlock()

			var err error
			if len(rows) > 0 {
				err = w.flush(context.Background(), rows)
				if err != nil {
					w.requeue(rows)
				}
			}
			closeErr := w.inserter.Close()
			if err == nil {
				err = closeErr
			}
			reply <- err
			return
		}
	}
}

func (w *bufferedWriter) flushPending() error {
	w.mu.Lock()
	rows := append([]eventRow(nil), w.rows...)
	w.rows = nil
	w.mu.Unlock()

	if len(rows) == 0 {
		return nil
	}

	if err := w.flush(context.Background(), rows); err != nil {
		w.requeue(rows)
		w.logger.Warn("flush cdevents rows failed", zap.Int("row_count", len(rows)), zap.Error(err))
		return err
	}

	return nil
}

func (w *bufferedWriter) flush(ctx context.Context, rows []eventRow) error {
	return w.inserter.Insert(ctx, rows)
}

func (w *bufferedWriter) requeue(rows []eventRow) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	w.rows = append(rows, w.rows...)
}

func (w *bufferedWriter) requestFlush() {
	select {
	case w.flushNow <- struct{}{}:
	default:
	}
}

type clickHouseInserter struct {
	conn driver.Conn
}

func newClickHouseInserter(cfg config) (*clickHouseInserter, error) {
	conn, err := clickhouse.Open(&clickhouse.Options{
		Addr: []string{cfg.ClickHouseAddr},
		Auth: clickhouse.Auth{
			Database: cfg.ClickHouseDatabase,
			Username: cfg.ClickHouseUsername,
			Password: cfg.ClickHousePassword,
		},
	})
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err != nil {
		_ = conn.Close()
		return nil, err
	}

	return &clickHouseInserter{conn: conn}, nil
}

func (i *clickHouseInserter) Insert(ctx context.Context, rows []eventRow) error {
	if len(rows) == 0 {
		return nil
	}

	batch, err := i.conn.PrepareBatch(ctx, "INSERT INTO "+cdeventsTableName)
	if err != nil {
		return err
	}

	for _, row := range rows {
		if err := batch.Append(
			row.TenantID,
			row.DeliveryID,
			row.EventKind,
			row.EventPhase,
			row.EventTime,
			row.SubjectID,
			row.SubjectName,
			row.SubjectURL,
			row.PipelineRunID,
			row.Repository,
			row.SHA,
			row.GitRef,
			row.Outcome,
			row.CDEventJSON,
		); err != nil {
			return err
		}
	}

	return batch.Send()
}

func (i *clickHouseInserter) Close() error {
	return i.conn.Close()
}
