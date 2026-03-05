package main

import (
	"context"

	"go.uber.org/zap"
)

type installationEventForwarder struct {
	appURL     string
	httpClient HTTPDoer
	logger     *zap.Logger
}

// newInstallationEventForwarder builds a forwarder for installation-related webhooks.
func newInstallationEventForwarder(appURL string, httpClient HTTPDoer, logger *zap.Logger) *installationEventForwarder {
	if appURL == "" {
		return nil
	}
	return &installationEventForwarder{appURL: appURL, httpClient: httpClient, logger: logger}
}

// forwardEvent relays the original webhook request to the app install-events endpoint.
func (f *installationEventForwarder) forwardEvent(ctx context.Context, event webhookEvent) error {
	statusCode, err := forwardWebhook(
		ctx,
		f.httpClient,
		f.appURL,
		event.Headers,
		event.Body,
		"app",
		nil,
	)

	if err != nil {
		f.logger.Warn("installation event rejected",
			zap.String("event_id", event.EventID),
			zap.Int("status_code", statusCode),
			zap.Error(err),
		)
		return err
	}

	f.logger.Debug("installation event forwarded",
		zap.String("event_id", event.EventID),
		zap.Int("status_code", statusCode),
	)
	return nil
}
