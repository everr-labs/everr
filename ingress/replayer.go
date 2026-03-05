package main

import (
	"context"
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
	statusCode, err := forwardWebhook(
		ctx,
		r.httpClient,
		r.collectorURL,
		event.Headers,
		event.Body,
		"collector",
		func(header http.Header) {
			header.Set(headerTenantID, strconv.FormatInt(tenantID, 10))
		},
	)
	if err != nil {
		r.logger.Warn("replay rejected",
			zap.String("event_id", event.EventID),
			zap.Int64("tenant_id", tenantID),
			zap.Int("status_code", statusCode),
			zap.Error(err),
		)
		return err
	}
	r.logger.Debug("replay accepted",
		zap.String("event_id", event.EventID),
		zap.Int64("tenant_id", tenantID),
		zap.Int("status_code", statusCode),
	)
	return nil
}
