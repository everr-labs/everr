package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
)

// forwardWebhook relays a webhook request and classifies downstream failures as retryable vs terminal.
func forwardWebhook(
	ctx context.Context,
	httpClient HTTPDoer,
	targetURL string,
	headers http.Header,
	body []byte,
	errorPrefix string,
	mutateHeaders func(http.Header),
) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}

	req.Header = headers.Clone()
	if req.Header == nil {
		req.Header = make(http.Header)
	}
	stripHopHeaders(req.Header)
	if mutateHeaders != nil {
		mutateHeaders(req.Header)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return resp.StatusCode, nil
	}

	bodyPreview, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	err = fmt.Errorf("%s status=%d body=%q", errorPrefix, resp.StatusCode, string(bodyPreview))
	if isRetryableStatus(resp.StatusCode) {
		return resp.StatusCode, err
	}
	return resp.StatusCode, &terminalError{Err: err}
}
