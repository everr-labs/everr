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

func isRetryableStatus(status int) bool {
	if status == http.StatusRequestTimeout || status == http.StatusTooManyRequests {
		return true
	}
	return status >= 500 && status <= 599
}

func cloneHeaders(h http.Header) map[string][]string {
	cloned := make(map[string][]string, len(h))
	for k, vals := range h {
		v := make([]string, len(vals))
		copy(v, vals)
		cloned[k] = v
	}
	return cloned
}

func firstHeader(headers map[string][]string, key string) string {
	for hk, values := range headers {
		if strings.EqualFold(hk, key) && len(values) > 0 {
			return strings.TrimSpace(values[0])
		}
	}
	return ""
}

func stripHopHeaders(header http.Header) {
	hopByHop := []string{"Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization", "Te", "Trailer", "Transfer-Encoding", "Upgrade", "Host", "Content-Length"}
	for _, key := range hopByHop {
		header.Del(key)
	}
}

func truncateString(value string, n int) string {
	if len(value) <= n {
		return value
	}
	return value[:n]
}

func envString(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

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
