package main

import (
	"context"
	"time"

	"go.uber.org/zap"
)

func (s *server) runWorker(ctx context.Context, workerID int) {
	ticker := time.NewTicker(s.cfg.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			events, err := s.store.claimEvents(ctx)
			if err != nil {
				s.logger.Error("worker claim failed", zap.Int("worker_id", workerID), zap.Error(err))
				continue
			}
			if len(events) > 0 {
				s.logger.Debug("worker claimed events", zap.Int("worker_id", workerID), zap.Int("count", len(events)))
			}

			for _, event := range events {
				if err := s.processor.processEvent(ctx, event); err != nil {
					s.logger.Error("worker process failed",
						zap.Int("worker_id", workerID),
						zap.Int64("event_pk", event.ID),
						zap.String("event_id", event.EventID),
						zap.Error(err),
					)
				}
			}
		}
	}
}

func (s *server) runCleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(s.cfg.CleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.store.cleanup(ctx); err != nil {
				s.logger.Error("cleanup failed", zap.Error(err))
			}
		}
	}
}
