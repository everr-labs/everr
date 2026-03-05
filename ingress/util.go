package main

import (
	"math"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// retryDelay computes exponential backoff with bounded jitter for failed event retries.
func retryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	baseSeconds := math.Pow(2, float64(attempt))
	if baseSeconds > 900 {
		baseSeconds = 900
	}

	jitter := rand.Float64()*0.4 - 0.2 // +/-20%
	delay := time.Duration(baseSeconds*float64(time.Second)) + time.Duration(jitter*baseSeconds*float64(time.Second))
	if delay < time.Second {
		return time.Second
	}
	return delay
}

// isRetryableStatus reports whether an HTTP status should be retried by workers.
func isRetryableStatus(status int) bool {
	if status == http.StatusRequestTimeout || status == http.StatusTooManyRequests {
		return true
	}
	return status >= 500 && status <= 599
}

// stripHopHeaders removes hop-by-hop headers that must not be forwarded.
func stripHopHeaders(header http.Header) {
	hopByHop := []string{"Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization", "Te", "Trailer", "Transfer-Encoding", "Upgrade", "Host", "Content-Length"}
	for _, key := range hopByHop {
		header.Del(key)
	}
}

// truncateString caps a string to at most n bytes.
func truncateString(value string, n int) string {
	if len(value) <= n {
		return value
	}
	return value[:n]
}

// envString returns a trimmed environment value or fallback when unset.
func envString(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// envInt parses an integer environment value, returning fallback on parse failure.
func envInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

// envDuration parses a duration environment value, returning fallback on parse failure.
func envDuration(key string, fallback time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}
