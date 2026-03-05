package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"go.uber.org/zap"
)

type collectorReplayer struct {
	collectorURL string
	httpClient   HTTPDoer
	logger       *zap.Logger
}

// newCollectorReplayer builds the client responsible for replaying workflow webhooks to the collector.
func newCollectorReplayer(collectorURL string, httpClient HTTPDoer, logger *zap.Logger) *collectorReplayer {
	return &collectorReplayer{collectorURL: collectorURL, httpClient: httpClient, logger: logger}
}

// replayEvent forwards the stored webhook payload to the collector with tenant attribution header.
func (r *collectorReplayer) replayEvent(ctx context.Context, event webhookEvent, tenantID int64) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.collectorURL, bytes.NewReader(event.Body))
	if err != nil {
		return err
	}

	for key, values := range event.Headers {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	stripHopHeaders(req.Header)
	req.Header.Set(headerTenantID, strconv.FormatInt(tenantID, 10))

	resp, err := r.httpClient.Do(req)
	if err != nil {
		r.logger.Warn("replay request failed",
			zap.String("event_id", event.EventID),
			zap.Int64("tenant_id", tenantID),
			zap.Error(err),
		)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		r.logger.Debug("replay accepted",
			zap.String("event_id", event.EventID),
			zap.Int64("tenant_id", tenantID),
			zap.Int("status_code", resp.StatusCode),
		)
		return nil
	}

	bodyPreview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	err = fmt.Errorf("collector status=%d body=%q", resp.StatusCode, string(bodyPreview))
	r.logger.Warn("replay rejected by collector",
		zap.String("event_id", event.EventID),
		zap.Int64("tenant_id", tenantID),
		zap.Int("status_code", resp.StatusCode),
	)
	if isRetryableStatus(resp.StatusCode) {
		return err
	}

	return &terminalError{Err: err}
}
