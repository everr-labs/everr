package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"go.uber.org/zap"
)

type eventStore struct {
	db     *sql.DB
	cfg    config
	logger *zap.Logger
}

// newEventStore returns a Postgres-backed queue store for webhook events.
func newEventStore(db *sql.DB, cfg config, logger *zap.Logger) *eventStore {
	return &eventStore{db: db, cfg: cfg, logger: logger}
}

// enqueueEvent persists a validated webhook and resolves duplicate/conflict semantics by delivery ID.
func (s *eventStore) enqueueEvent(ctx context.Context, source, eventID, bodySHA string, headers map[string][]string, body []byte) (string, error) {
	headersJSON, err := json.Marshal(headers)
	if err != nil {
		return "", err
	}

	const insertQ = `
		INSERT INTO webhook_events (source, event_id, body_sha256, headers, body)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (source, event_id) DO NOTHING
	`
	res, err := s.db.ExecContext(ctx, insertQ, source, eventID, bodySHA, headersJSON, body)
	if err != nil {
		return "", err
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return "", err
	}
	if affected > 0 {
		return "inserted", nil
	}

	const existingQ = `SELECT body_sha256 FROM webhook_events WHERE source=$1 AND event_id=$2`
	var existingSHA string
	if err := s.db.QueryRowContext(ctx, existingQ, source, eventID).Scan(&existingSHA); err != nil {
		return "", err
	}
	if existingSHA == bodySHA {
		return "duplicate", nil
	}
	return "conflict", nil
}

// claimEvents leases the next batch of due events for worker processing.
func (s *eventStore) claimEvents(ctx context.Context) ([]webhookEvent, error) {
	const claimQ = `
		WITH cte AS (
			SELECT id
			FROM webhook_events
			WHERE status IN ('queued','failed')
			  AND next_attempt_at <= now()
			  AND (locked_until IS NULL OR locked_until <= now())
			ORDER BY received_at
			FOR UPDATE SKIP LOCKED
			LIMIT $1
		)
		UPDATE webhook_events e
		SET status = 'processing',
		    attempts = attempts + 1,
		    locked_until = now() + ($2 * interval '1 second')
		FROM cte
		WHERE e.id = cte.id
		RETURNING e.id, e.source, e.event_id, e.headers, e.body, e.attempts
	`

	s.logger.Debug("claiming events", zap.Int("batch_size", s.cfg.WorkerBatchSize), zap.Duration("lock_duration", s.cfg.LockDuration))

	lockSeconds := int64(s.cfg.LockDuration / time.Second)
	rows, err := s.db.QueryContext(ctx, claimQ, s.cfg.WorkerBatchSize, lockSeconds)
	if err != nil {
		s.logger.Error("claim events failed", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	events := make([]webhookEvent, 0, s.cfg.WorkerBatchSize)
	for rows.Next() {
		var e webhookEvent
		var headersRaw []byte
		if err := rows.Scan(&e.ID, &e.Source, &e.EventID, &headersRaw, &e.Body, &e.Attempts); err != nil {
			s.logger.Error("scan event failed", zap.Error(err))
			return nil, err
		}
		if err := json.Unmarshal(headersRaw, &e.Headers); err != nil {
			s.logger.Error("decode headers failed", zap.Error(err))
			return nil, fmt.Errorf("decode headers for id=%d: %w", e.ID, err)
		}
		events = append(events, e)
	}

	if err := rows.Err(); err != nil {
		s.logger.Error("claim events failed", zap.Error(err))
		return nil, err
	}

	return events, nil
}

// finalizeEvent transitions a claimed event into done, failed, or dead state.
func (s *eventStore) finalizeEvent(ctx context.Context, event webhookEvent, result eventResult, errorClass, lastError string) error {
	switch result {
	case eventDone:
		const q = `
			UPDATE webhook_events
			SET status='done', done_at=now(), locked_until=NULL, last_error=NULL, error_class=NULL
			WHERE id=$1
		`
		_, err := s.db.ExecContext(ctx, q, event.ID)
		return err
	case eventDead:
		const q = `
			UPDATE webhook_events
			SET status='dead', dead_at=now(), locked_until=NULL, next_attempt_at=now(), last_error=$2, error_class=$3
			WHERE id=$1
		`
		_, err := s.db.ExecContext(ctx, q, event.ID, truncateString(lastError, 1024), errorClass)
		return err
	case eventFail:
		delay := retryDelay(event.Attempts)
		const q = `
			UPDATE webhook_events
			SET status='failed', locked_until=NULL, next_attempt_at=now() + ($2 * interval '1 second'), last_error=$3, error_class=$4
			WHERE id=$1
		`
		_, err := s.db.ExecContext(ctx, q, event.ID, int64(delay/time.Second), truncateString(lastError, 1024), errorClass)
		return err
	default:
		return fmt.Errorf("unknown result %q", result)
	}
}

// cleanup deletes aged done and dead events according to configured retention windows.
func (s *eventStore) cleanup(ctx context.Context) error {
	if _, err := s.cleanupStatus(ctx, "done", "done_at", s.cfg.RetentionDoneDays); err != nil {
		s.logger.Error("cleanup done failed", zap.Error(err))
		return err
	}
	_, err := s.cleanupStatus(ctx, "dead", "dead_at", s.cfg.RetentionDeadDays)
	return err
}

// cleanupStatus deletes a bounded batch of old rows for one terminal status.
func (s *eventStore) cleanupStatus(ctx context.Context, status, timeField string, retentionDays int) (int64, error) {
	if retentionDays <= 0 {
		s.logger.Debug("cleanup status skipped", zap.String("status", status), zap.Int("retention_days", retentionDays))
		return 0, nil
	}

	q := fmt.Sprintf(`
		DELETE FROM webhook_events
		WHERE ctid IN (
			SELECT ctid
			FROM webhook_events
			WHERE status=$1
			  AND %s IS NOT NULL
			  AND %s < now() - ($2 * interval '1 day')
			LIMIT $3
		)
	`, timeField, timeField)
	res, err := s.db.ExecContext(ctx, q, status, retentionDays, cleanupBatchSize)
	if err != nil {
		s.logger.Error("cleanup status failed", zap.Error(err))
		return 0, err
	}
	return res.RowsAffected()
}
