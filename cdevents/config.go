package main

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

func loadConfig() (config, error) {
	cfg := config{
		ListenAddr:          envString("CDEVENTS_LISTEN_ADDR", defaultListenAddr),
		Path:                envString("CDEVENTS_PATH", defaultPath),
		ClickHouseAddr:      strings.TrimSpace(os.Getenv("CDEVENTS_CLICKHOUSE_ADDR")),
		ClickHouseDatabase:  envString("CDEVENTS_CLICKHOUSE_DATABASE", "otel"),
		ClickHouseUsername:  strings.TrimSpace(os.Getenv("CDEVENTS_CLICKHOUSE_USERNAME")),
		ClickHousePassword:  strings.TrimSpace(os.Getenv("CDEVENTS_CLICKHOUSE_PASSWORD")),
		BatchSize:           envInt("CDEVENTS_BATCH_SIZE", defaultBatchSize),
		FlushInterval:       envDuration("CDEVENTS_FLUSH_INTERVAL", defaultFlushPeriod),
		FlushRetryDelay:     envDuration("CDEVENTS_FLUSH_RETRY_DELAY", defaultRetryDelay),
		ShutdownGracePeriod: envDuration("CDEVENTS_SHUTDOWN_GRACE_PERIOD", 5*time.Second),
	}

	if cfg.ClickHouseAddr == "" {
		return config{}, errors.New("CDEVENTS_CLICKHOUSE_ADDR is required")
	}
	if cfg.ClickHouseUsername == "" {
		return config{}, errors.New("CDEVENTS_CLICKHOUSE_USERNAME is required")
	}
	if cfg.BatchSize <= 0 {
		return config{}, errors.New("CDEVENTS_BATCH_SIZE must be > 0")
	}
	if cfg.FlushInterval <= 0 {
		return config{}, errors.New("CDEVENTS_FLUSH_INTERVAL must be > 0")
	}
	if cfg.FlushRetryDelay <= 0 {
		return config{}, errors.New("CDEVENTS_FLUSH_RETRY_DELAY must be > 0")
	}
	if cfg.Path == "" || cfg.Path[0] != '/' {
		return config{}, errors.New("CDEVENTS_PATH must start with '/'")
	}

	return cfg, nil
}

func envString(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envDuration(name string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}

	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}
