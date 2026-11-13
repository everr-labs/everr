package local

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/everr-labs/everr/packages/cli/internal/query"
)

// sqlClient queries the local collector's SQL endpoint.
type sqlClient struct {
	origin string
	http   *http.Client
}

func newSQLClient(origin string) *sqlClient {
	return &sqlClient{
		origin: origin,
		http:   &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Proxy: nil}},
	}
}

// Query runs sql with `param_<name>` substitutions. It retries once on 503,
// after the server's Retry-After.
func (c *sqlClient) Query(ctx context.Context, sql string, params map[string]json.RawMessage) (query.Rows, error) {
	endpoint := c.origin + "/sql"
	values := url.Values{}
	for name, value := range params {
		values.Set("param_"+name, string(value))
	}
	if len(values) > 0 {
		endpoint += "?" + values.Encode()
	}
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(sql))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "text/plain")
		// The collector refuses SQL without it, so web pages can't run any.
		req.Header.Set("X-Everr-Local", "1")
		resp, err := c.http.Do(req)
		if err != nil {
			return nil, fmt.Errorf("POST %s: %w", endpoint, err)
		}
		if resp.StatusCode == http.StatusServiceUnavailable && attempt == 0 {
			retry, err := strconv.ParseUint(resp.Header.Get("Retry-After"), 10, 64)
			if err != nil {
				retry = 1
			}
			resp.Body.Close()
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(retry) * time.Second):
			}
			continue
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("read collector query response: %w", err)
		}
		switch resp.StatusCode {
		case http.StatusOK:
			return query.ParseNDJSON(string(body))
		case http.StatusServiceUnavailable:
			return nil, errors.New("telemetry collector is busy — try again in a moment")
		case http.StatusBadRequest, http.StatusInternalServerError, http.StatusRequestEntityTooLarge:
			return nil, errors.New(errorMessage(body))
		}
		return nil, fmt.Errorf("unexpected status %s: %s", resp.Status, body)
	}
}

// errorMessage unwraps the collector's {"error": "..."} envelope.
func errorMessage(body []byte) string {
	var envelope struct {
		Error *string `json:"error"`
	}
	if json.Unmarshal(body, &envelope) == nil && envelope.Error != nil {
		return *envelope.Error
	}
	return string(body)
}

func isConnectError(err error) bool {
	var opErr *net.OpError
	return errors.As(err, &opErr) && opErr.Op == "dial"
}
