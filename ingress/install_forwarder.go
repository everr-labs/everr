package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"

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
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, f.appURL, bytes.NewReader(event.Body))
	if err != nil {
		return err
	}

	for key, values := range event.Headers {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	stripHopHeaders(req.Header)

	resp, err := f.httpClient.Do(req)
	if err != nil {
		f.logger.Warn("installation event forward failed", zap.String("event_id", event.EventID), zap.Error(err))
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		f.logger.Debug("installation event forwarded", zap.String("event_id", event.EventID), zap.Int("status_code", resp.StatusCode))
		return nil
	}

	bodyPreview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	err = fmt.Errorf("app status=%d body=%q", resp.StatusCode, string(bodyPreview))
	f.logger.Warn("installation event rejected", zap.String("event_id", event.EventID), zap.Int("status_code", resp.StatusCode))
	if isRetryableStatus(resp.StatusCode) {
		return err
	}

	return &terminalError{Err: err}
}
